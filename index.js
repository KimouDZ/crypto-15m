const TelegramBot = require('node-telegram-bot-api');
const technicalIndicators = require('technicalindicators');
const fs = require('fs');
const schedule = require('node-schedule');
const moment = require('moment-timezone');
const fetch = require('node-fetch'); // npm install node-fetch@2

// ملف حفظ الصفقات
const TRADES_FILE = './trades.json';

// قراءة الرموز من ملف JSON
const SYMBOLS = JSON.parse(fs.readFileSync('./symbols.json')).symbols;

// إعدادات التليغرام
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS
  ? process.env.TELEGRAM_CHAT_IDS.split(',').map(id => id.trim())
  : ['1055739217', '5178781562'];

// إعدادات التداول
const TRADE_AMOUNT = 100; // 100 دولار لكل صفقة أو تدعيم
const STOP_LOSS_DROP_PERCENT = 8 / 100; // 8%
const SUPPORT_DROP_PERCENT = 1.7 / 100; // 1.7% هبوط لتنفيذ التدعيم
const MAX_SUPPORTS = 3;

// إنشاء بوت تليغرام
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

function algTime(date) {
  return moment(date).tz('Africa/Algiers').format('YYYY-MM-DD HH:mm:ss');
}

// إرسال رسالة تليغرام لجميع الدردشات
async function sendTelegram(message) {
  for (const chatId of TELEGRAM_CHAT_IDS) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (e) {
      console.error(`Telegram send error to chat ${chatId}:`, e.message);
    }
  }
}

// تحميل الصفقات المحفوظة من الملف
function loadTrades() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const data = fs.readFileSync(TRADES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading trades file:', e);
  }
  return {}; // فارغ إذا لم توجد بيانات سابقة
}

// حفظ الصفقات في الملف
function saveTrades(trades) {
  try {
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
  } catch (e) {
    console.error('Error saving trades file:', e);
  }
}

// جلب الشموع من API بينانس (15 دقيقة، 100 شمعة)
async function getKlines(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=100`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.map(c => ({
      openTime: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      closeTime: c[6],
    }));
  } catch (err) {
    console.error(`Error fetching klines for ${symbol}:`, err.message);
    await sendTelegram(
      `⚠️ <b>خطأ في جلب بيانات الشموع للرمز ${symbol}</b>\n${err.message || err}`
    );
    return [];
  }
}

// حساب المؤشرات الفنية
function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);

  const rsi = technicalIndicators.RSI.calculate({ values: closes, period: 14 });
  const bb = technicalIndicators.BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const bPercents = bb.map((band, i) => {
    if (band.upper === band.lower) return 0;
    return (closes[i + (closes.length - bb.length)] - band.lower) / (band.upper - band.lower);
  });

  const macdBuy = technicalIndicators.MACD.calculate({
    values: closes, fastPeriod: 1, slowPeriod: 2, signalPeriod: 2,
    SimpleMAOscillator: false, SimpleMASignal: false
  });

  const macdSell = technicalIndicators.MACD.calculate({
    values: closes, fastPeriod: 1, slowPeriod: 10, signalPeriod: 2,
    SimpleMAOscillator: false, SimpleMASignal: false
  });

  return { rsi, bPercents, macdBuy, macdSell };
}

// اكتشاف تقاطعات MACD
function getMacdCross(macd) {
  if (macd.length < 2) return null;
  const prev = macd[macd.length - 2];
  const curr = macd[macd.length - 1];
  const prevDiff = prev.MACD - prev.signal;
  const currDiff = curr.MACD - curr.signal;

  if (prevDiff < 0 && currDiff > 0) return 'positive';
  if (prevDiff > 0 && currDiff < 0) return 'negative';
  return null;
}

// تنبيهات التليغرام

async function alertBuy(symbol, price, amount, dt) {
  const msg = 
`🟢 <b>إشــارة شــراء</b>
💰 العملة: ${symbol}
💵 السعر: ${price.toFixed(6)}
💸 القيمة: ${amount} USD
🕒 التاريخ والوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

// تعديل دالة التنبيه على البيع لحساب الربح بدقة
async function alertSell(symbol, sellPrice, trade, sellTime) {
  const initialQuantity = TRADE_AMOUNT / trade.entryPrice;
  let totalQuantity = initialQuantity;
  let totalCost = TRADE_AMOUNT;

  for (const support of trade.supports) {
    const supportQuantity = support.amount / support.price;
    totalQuantity += supportQuantity;
    totalCost += support.amount;
  }

  const averagePrice = totalCost / totalQuantity;

  const profitPercent = ((sellPrice - averagePrice) / averagePrice) * 100;
  const netProfit = totalCost * (profitPercent / 100);

  const msg = 
`🔴 <b>إشــارة بيع</b>
💰 العملة: ${symbol}
📈 متوسط سعر الشراء: ${averagePrice.toFixed(6)}
💵 سعر البيع: ${sellPrice.toFixed(6)}
🕒 وقت البيع: ${algTime(sellTime)}
📉 نسبة الأرباح: ${profitPercent.toFixed(2)}%
💰 صافي الربح: ${netProfit.toFixed(2)} USD`;

  await sendTelegram(msg);

  dailyStats.totalTrades++;
  if (netProfit > 0) dailyStats.winningTrades++;
  else dailyStats.losingTrades++;
  dailyStats.netProfit += netProfit;
  dailyStats.totalInvested += totalCost;
}

async function alertStopLoss(symbol, price, dt) {
  const msg = 
`⛔️ <b>إشــارة وقف خسارة</b>
💰 العملة: ${symbol}
💵 السعر: ${price.toFixed(6)}
🕒 التاريخ والوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

async function alertSupport(symbol, price, amount, dt, supportNumber) {
  const msg = 
`🟠 <b>تنبيه تدعيم</b>
💰 العملة: ${symbol}
💵 السعر: ${price.toFixed(6)}
💸 قيمة التدعيم: ${amount} USD
🔢 رقم التدعيم: ${supportNumber}
🕒 التاريخ والوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

// إحصاءات يومية لتقرير الأرباح
let dailyStats = {
  date: moment().tz('Africa/Algiers').format('YYYY-MM-DD'),
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalInvested: 0,
  netProfit: 0,
};

// تحميل الصفقات عند بدء التشغيل
let trades = loadTrades();

// حفظ تلقائي بعد تحديث الصفقات
function updateTrades() {
  saveTrades(trades);
}

// دالة الفحص والتحليل مع التدعيم والبيع وحفظ البيانات
async function checkTrading() {
  const now = moment().tz('Africa/Algiers').toDate();

  try {
    for (const symbol of SYMBOLS) {
      try {
        const candles = await getKlines(symbol);
        if (candles.length === 0) continue;
        
        const indicators = calculateIndicators(candles);
        const rsiLen = indicators.rsi.length;
        const bPercentLen = indicators.bPercents.length;
        if (rsiLen === 0 || bPercentLen === 0) continue;

        const rsi = indicators.rsi[rsiLen - 1];
        const bPercent = indicators.bPercents[bPercentLen - 1]; // القيمة الأصلية، ليست مضروبة في 100
        const macdBuyCross = getMacdCross(indicators.macdBuy);
        const macdSellCross = getMacdCross(indicators.macdSell);
        const closePrice = candles[candles.length - 1].close;

        // طباعة المؤشرات (B% مضروبة 100 فقط للعرض)
        console.log(`\n📊 مؤشرات فنية - ${symbol}`);
        console.log(`🕒 الوقت: ${algTime(now)}`);
        console.log(`💵 السعر الحالي: ${closePrice.toFixed(6)}`);
        console.log(`🔹 RSI: ${rsi.toFixed(2)}`);
        console.log(`🔹 نسبة البراينجر باند (bPercent): ${(bPercent * 100).toFixed(2)}%`);
        console.log(`🔹 تقاطع MACD شراء: ${macdBuyCross || 'لا يوجد'}`);
        console.log(`🔹 تقاطع MACD بيع: ${macdSellCross || 'لا يوجد'}`);

        let trade = trades[symbol];

        if (!trade || trade.status === 'closed') {
          if (!trade) {
            trades[symbol] = {
              status: 'waiting',
              refPrice: closePrice,
              priceDropped: false,
              supports: [],
              quantity: 0,
              tradeMoney: 0,
              entryTime: null,
              entryPrice: null,
            };
            trade = trades[symbol];
          }

          // شرط استخدام القيمة الأصلية لـbPercent (مثلاً <0.4 بدلاً من <40)
          if (!trade.priceDropped && closePrice <= trade.refPrice * (1 - SUPPORT_DROP_PERCENT)) {
            trade.priceDropped = true;
            console.log(`${symbol}: السعر هبط بنسبة 1.7% من السعر المرجعي.`);
          }

          if (trade.priceDropped && macdBuyCross === 'positive') {
            trade.status = 'open';
            trade.entryPrice = closePrice;
            trade.tradeMoney = TRADE_AMOUNT;
            trade.quantity = TRADE_AMOUNT / closePrice;
            trade.entryTime = now;
            trade.supports = [];
            trade.priceDropped = false;
            console.log(`${symbol}: تمت عملية شراء أولى عند السعر ${closePrice}.`);
            await alertBuy(symbol, closePrice, TRADE_AMOUNT, now);
            updateTrades();
          }

        } else if (trade.status === 'open') {
          let lastSupportPrice = trade.supports.length > 0 
                                  ? trade.supports[trade.supports.length - 1].price 
                                  : trade.entryPrice;

          if (!trade.priceDropped && closePrice <= lastSupportPrice * (1 - SUPPORT_DROP_PERCENT)) {
            trade.priceDropped = true;
            console.log(`${symbol}: السعر هبط 1.7% عن آخر دعم.`);
          }

          if (trade.priceDropped && trade.supports.length < MAX_SUPPORTS && macdBuyCross === 'positive') {
            const supportAmount = TRADE_AMOUNT;
            const addedQty = supportAmount / closePrice;

            trade.supports.push({ price: closePrice, time: now, amount: supportAmount });
            trade.quantity += addedQty;
            trade.tradeMoney += supportAmount;
            trade.priceDropped = false;

            console.log(`${symbol}: تنفيذ تدعيم رقم ${trade.supports.length} عند السعر ${closePrice}.`);
            await alertSupport(symbol, closePrice, supportAmount, now, trade.supports.length);
            updateTrades();
          }

          else if (macdSellCross === 'negative') {
            await alertSell(symbol, closePrice, trade, now);
            trade.status = 'closed';
            trade.priceDropped = false;
            trade.supports = [];
            trade.quantity = 0;
            trade.tradeMoney = 0;
            trade.entryTime = null;
            trade.entryPrice = null;
            console.log(`${symbol}: تم تنفيذ بيع الصفقة.`);
            updateTrades();
          }

          else if (closePrice <= trade.entryPrice * (1 - STOP_LOSS_DROP_PERCENT)) {
            await alertStopLoss(symbol, closePrice, now);
            trade.status = 'closed';
            trade.priceDropped = false;
            console.log(`${symbol}: تم تنفيذ وقف خسارة.`);
            updateTrades();
          }
        }
      } catch (analysisError) {
        console.error(`Error analyzing symbol ${symbol}:`, analysisError);
        await sendTelegram(
          `⚠️ <b>خطأ أثناء تحليل الرمز ${symbol}</b>\n` +
          `الخطأ: ${analysisError.message || analysisError}`
        );
      }
    }
  } catch (e) {
    console.error('Error in checkTrading main loop:', e);
    await sendTelegram(`⚠️ <b>خطأ في الدالة الرئيسية للتحليل</b>\n${e.message || e}`);
  }
}

// تقرير الأرباح اليومية في منتصف الليل
schedule.scheduleJob({ hour: 0, minute: 0, tz: 'Africa/Algiers' }, async () => {
  try {
    const profitPercent = dailyStats.totalInvested > 0 ? (dailyStats.netProfit / dailyStats.totalInvested) * 100 : 0;
    const report = 
`📊 <b>تقرير الأرباح اليومية - ${dailyStats.date}</b>
📈 عدد الصفقات: ${dailyStats.totalTrades}
✅ الصفقات الرابحة: ${dailyStats.winningTrades}
❌ الصفقات الخاسرة: ${dailyStats.losingTrades}
💰 المبلغ المستثمر: ${dailyStats.totalInvested.toFixed(2)} USD
📉 صافي الربح: ${dailyStats.netProfit.toFixed(2)} USD
📊 نسبة الأرباح: ${profitPercent.toFixed(2)}%`;
    await sendTelegram(report);

    dailyStats = {
      date: moment().tz('Africa/Algiers').format('YYYY-MM-DD'),
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalInvested: 0,
      netProfit: 0,
    };
  } catch (e) {
    console.error('Error sending daily report:', e);
    await sendTelegram(`⚠️ <b>خطأ في إرسال تقرير الأرباح اليومية</b>\n${e.message || e}`);
  }
});

console.log('Trading alert bot started with persistent trades and original bPercent logic.');

checkTrading();
schedule.scheduleJob('*/2 * * * *', () => {
  console.log('Checking alerts at', algTime(new Date()));
  checkTrading();
});
