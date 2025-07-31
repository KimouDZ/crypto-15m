const Binance = require('binance-api-node').default;
const TelegramBot = require('node-telegram-bot-api');
const technicalIndicators = require('technicalindicators');
const fs = require('fs');
const schedule = require('node-schedule');
const moment = require('moment-timezone');

// قراءة الرموز من ملف json
const SYMBOLS = JSON.parse(fs.readFileSync('./symbols.json')).symbols;

// إعداد التوكن والمعرفات للتليجرام
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS
  ? process.env.TELEGRAM_CHAT_IDS.split(',').map(id => id.trim())
  : ['1055739217','5178781562'];

const client = Binance();
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

let trades = {};

// الاستثمار الافتراضي لكل صفقة أو تدعيم (100 دولار)
const DUMMY_TRADE_AMOUNT = 100;

// احصائيات يومية تقديرية
let dailyStats = {
  date: moment().tz('Africa/Algiers').format('YYYY-MM-DD'),
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalInvested: 0,
  totalProfit: 0,
  netProfit: 0,
  openTrades: 0,
};

function algTime(date) {
  return moment(date).tz('Africa/Algiers').format('YYYY-MM-DD HH:mm:ss');
}

async function sendTelegram(message) {
  for (const chatId of TELEGRAM_CHAT_IDS) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      console.log(`تم إرسال رسالة إلى ${chatId}`);
    } catch (e) {
      console.error(`خطأ في إرسال رسالة إلى ${chatId}:`, e.message);
    }
  }
}

async function getKlines(symbol) {
  try {
    const candles = await client.candles({ symbol, interval: '15m', limit: 100 });
    return candles.map(c => ({
      openTime: c.openTime,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
      closeTime: c.closeTime,
    }));
  } catch (e) {
    console.error(`خطأ جلب بيانات الشموع لـ ${symbol}:`, e.message);
    return [];
  }
}

function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);

  const rsi = technicalIndicators.RSI.calculate({ values: closes, period: 14 });

  const bb = technicalIndicators.BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2,
  });

  const startIndex = closes.length - bb.length;
  const bPercents = bb.map((band, i) => {
    if (band.upper === band.lower) return 0;
    return (closes[startIndex + i] - band.lower) / (band.upper - band.lower);
  });

  const macdBuy = technicalIndicators.MACD.calculate({
    values: closes,
    fastPeriod: 1,
    slowPeriod: 2,
    signalPeriod: 2,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const macdSell = technicalIndicators.MACD.calculate({
    values: closes,
    fastPeriod: 1,
    slowPeriod: 10,
    signalPeriod: 2,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  return { rsi, bPercents, macdBuy, macdSell };
}

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

// رسائل التنبيهات - ترسل فقط بدون تنفيذ أوامر
async function alertBuy(symbol, price, dt) {
  const msg =
`🟢 <b>إشارة شراء (تنبيه فقط)</b>
💰 العملة: ${symbol}
💵 السعر: ${price}
💸 القيمة الافتراضية: 100 USDT
🕒 التاريخ والوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

async function alertSupport(symbol, price, dt, supportNum) {
  const msg =
`🔵 <b>إشارة تدعيم (تنبيه فقط) #${supportNum}</b>
💰 العملة: ${symbol}
💵 سعر التدعيم: ${price}
💸 قيمة التدعيم الافتراضية: 100 USDT
🕒 التاريخ والوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

async function alertSell(symbol, price, entryPrice, dt) {
  // حساب الربح كنسبة وتقدير الدولار بناءً على المبلغ الافتراضي فقط
  const percentProfit = ((price - entryPrice) / entryPrice) * 100;
  const dollarProfit = DUMMY_TRADE_AMOUNT * (price - entryPrice) / entryPrice;

  const msg =
`🔴 <b>إشارة بيع (تنبيه فقط)</b>
💰 العملة: ${symbol}
📈 سعر الشراء الافتراضي: ${entryPrice}
💵 سعر البيع الحالي: ${price}
📉 نسبة الربح المقدرة: ${percentProfit.toFixed(2)}%
💰 الأرباح المقدرة: ${dollarProfit.toFixed(2)} USDT
🕒 الوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

async function alertStopLoss(symbol, price, entryPrice, dt) {
  const percentProfit = ((price - entryPrice) / entryPrice) * 100;
  const dollarProfit = DUMMY_TRADE_AMOUNT * (price - entryPrice) / entryPrice;

  const msg =
`⛔️ <b>إشارة وقف خسارة (تنبيه فقط)</b>
💰 العملة: ${symbol}
📈 سعر الشراء الافتراضي: ${entryPrice}
💵 سعر البيع الحالي: ${price}
📉 نسبة الخسارة المقدرة: ${percentProfit.toFixed(2)}%
💰 الخسارة المقدرة: ${dollarProfit.toFixed(2)} USDT
🕒 الوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

async function alertDailyReport(stats, dateStr) {
  const profitPercent = stats.totalInvested > 0 ? (stats.netProfit / stats.totalInvested) * 100 : 0;

  const msg =
`📊 <b>تقرير الأرباح اليومية (تقديري) - ${dateStr}</b>
📈 عدد الإشارات: ${stats.totalTrades}
✅ إشارات ربح: ${stats.winningTrades}
❌ إشارات خسارة: ${stats.losingTrades}
💰 المبلغ المستثمر الافتراضي: ${stats.totalInvested.toFixed(2)} USDT
💹 الأرباح الكلية (تقديرية): ${stats.totalProfit.toFixed(2)} USDT
📉 الأرباح الصافية (تقديرية): ${stats.netProfit.toFixed(2)} USDT
📊 نسبة الأرباح: ${profitPercent.toFixed(2)}%
🔓 تنبيهات مفتوحة: ${stats.openTrades}`;
  await sendTelegram(msg);
}

async function checkTrading() {
  console.log('================= بدء فحص التداول =================');
  const now = moment().tz('Africa/Algiers').toDate();

  for (const symbol of SYMBOLS) {
    try {
      const candles = await getKlines(symbol);
      if (candles.length === 0) {
        console.log(`لا توجد بيانات شمعات لـ ${symbol}, تخطي`);
        continue;
      }

      const indicators = calculateIndicators(candles);
      if (indicators.rsi.length === 0 || indicators.bPercents.length === 0) {
        console.log(`نقص بيانات مؤشرات لـ ${symbol}, تخطي`);
        continue;
      }

      const rsi = indicators.rsi[indicators.rsi.length - 1];
      const bPercent = indicators.bPercents[indicators.bPercents.length - 1];
      const macdBuyCross = getMacdCross(indicators.macdBuy);
      const macdSellCross = getMacdCross(indicators.macdSell);
      const closePrice = candles[candles.length - 1].close;

      let trade = trades[symbol] || { status: 'none', supportAlertSent: false, supportCount: 0 };

      if (trade.status === 'none') {
        // شروط شراء - فقط ترصد وترسل تنبيه
        if (rsi < 40 && bPercent < 0.4 && macdBuyCross === 'positive') {
          await alertBuy(symbol, closePrice.toFixed(6), now);
          // نسجل كصفقة مفتوحة افتراضياً
          trades[symbol] = {
            entryPrice: closePrice,
            status: 'open',
            entryTime: now,
            supportCount: 0,
            supportAlertSent: false
          };
          dailyStats.totalTrades++;
          dailyStats.totalInvested += DUMMY_TRADE_AMOUNT;
          dailyStats.openTrades++;
        }
      } else if (trade.status === 'open') {
        // شرط الدعم (هبوط سعر 1.5%) مع تنبيه دعم واحد فقط حتى يتغير الشرط
        const supportCondition = closePrice <= trade.entryPrice * (1 - 0.015) && trade.supportCount < 3;

        if (supportCondition && !trade.supportAlertSent) {
          await alertSupport(symbol, closePrice.toFixed(6), now, trade.supportCount + 1);
          trade.supportCount++;
          trade.supportAlertSent = true; // تم إرسال تنبيه الدعم الآن
          dailyStats.totalTrades++;
          dailyStats.totalInvested += DUMMY_TRADE_AMOUNT;
        }

        // إعادة تفعيل تنبيه الدعم في حال ارتفاع السعر فوق مستوى دعم 1.5%
        if (closePrice > trade.entryPrice * (1 - 0.015)) {
          trade.supportAlertSent = false;
        }

        // بيع عند تحقق الشروط
        if (rsi > 55 && macdSellCross === 'negative') {
          await alertSell(symbol, closePrice.toFixed(6), trade.entryPrice, now);
          // تحديث الإحصائيات التقديرية
          const profit = DUMMY_TRADE_AMOUNT * (closePrice - trade.entryPrice) / trade.entryPrice;
          dailyStats.totalProfit += profit > 0 ? profit : 0;
          dailyStats.netProfit += profit;
          if (profit > 0) dailyStats.winningTrades++;
          else dailyStats.losingTrades++;
          trades[symbol].status = 'sold';
          dailyStats.openTrades = Math.max(0, dailyStats.openTrades - 1);
        }
        // وقف خسارة عند هبوط 8%
        if (closePrice <= trade.entryPrice * (1 - 0.08)) {
          await alertStopLoss(symbol, closePrice.toFixed(6), trade.entryPrice, now);
          const loss = DUMMY_TRADE_AMOUNT * (closePrice - trade.entryPrice) / trade.entryPrice;
          dailyStats.netProfit += loss;
          dailyStats.losingTrades++;
          trades[symbol].status = 'sold';
          dailyStats.openTrades = Math.max(0, dailyStats.openTrades - 1);
        }
      }

      trades[symbol] = trade; // تحديث بيانات الصفقة بعد التغييرات

    } catch (e) {
      console.error(`خطأ أثناء معالجة الرمز ${symbol}:`, e.message);
    }
  }

  console.log('================= انتهاء فحص التداول =================\n');
}

// إرسال تقرير الأرباح يومياً عند منتصف الليل بتوقيت الجزائر
schedule.scheduleJob({ hour: 0, minute: 0, tz: 'Africa/Algiers' }, () => {
  console.log("🔔 إرسال تقرير الأرباح اليومية...");
  alertDailyReport(dailyStats, dailyStats.date);

  // إعادة تعيين الإحصائيات
  dailyStats = {
    date: moment().tz('Africa/Algiers').format('YYYY-MM-DD'),
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalInvested: 0,
    totalProfit: 0,
    netProfit: 0,
    openTrades: Object.values(trades).filter(t => t.status === 'open').length,
  };
});

console.log("🚀 بدأ البوت...");

checkTrading();
schedule.scheduleJob('*/1 * * * *', () => { // كل 5 دقائق
  console.log('🕒 تنفيذ فحص التداول عند', algTime(new Date()));
  checkTrading();
});
