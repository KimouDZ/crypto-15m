const TelegramBot = require('node-telegram-bot-api');
const technicalIndicators = require('technicalindicators');
const fs = require('fs');
const schedule = require('node-schedule');
const moment = require('moment-timezone');

// قراءة العملات من ملف JSON
const SYMBOLS = JSON.parse(fs.readFileSync('./symbols.json')).symbols;

// إعدادات التليغرام
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS
  ? process.env.TELEGRAM_CHAT_IDS.split(',').map(id => id.trim())
  : ['1055739217', '5178781562'];

// إعدادات التداول الافتراضية لحساب الأرباح
const TRADE_AMOUNT = 100; // 100 دولار لكل صفقة شراء/بيع
const STOP_LOSS_DROP_PERCENT = 8 / 100; // 8%

// إنشاء بوت التليغرام
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

function algTime(date) {
  return moment(date).tz('Africa/Algiers').format('YYYY-MM-DD HH:mm:ss');
}

// إرسال رسالة إلى كل Chat ID في القائمة
async function sendTelegram(message) {
  for (const chatId of TELEGRAM_CHAT_IDS) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (e) {
      console.error(`Telegram send error to chat ${chatId}:`, e.message);
    }
  }
}

// وظيفة وهمية لجلب الشموع (تحتاج لاستبدالها ببيانات حقيقية من مصدر موثوق)
// حالياً ترجع مصفوفة فارغة، استبدل هذه الدالة لتعطي بيانات فعليّة
async function getKlines(symbol) {
  // مثال: هنا يمكنك إدخال طريقة لجلب البيانات من مصدر موثوق بدون Binance API التداولي
  return [];
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

// تنبيهات جاهزة
async function alertBuy(symbol, price, amount, dt) {
  const msg = 
`🟢 <b>إشــارة شــراء</b>
💰 العملة: ${symbol}
💵 السعر: ${price.toFixed(6)}
💸 القيمة: ${amount} USD
🕒 التاريخ والوقت: ${algTime(dt)}`;
  await sendTelegram(msg);
}

async function alertSell(symbol, sellPrice, buyPrice, buyTime, sellTime) {
  const profitPercent = ((sellPrice - buyPrice) / buyPrice) * 100;
  const netProfit = TRADE_AMOUNT * (profitPercent / 100);
  const msg = 
`🔴 <b>إشــارة بيع</b>
💰 العملة: ${symbol}
📈 سعر الشراء: ${buyPrice.toFixed(6)}
🕒 وقت الشراء: ${algTime(buyTime)}
💵 سعر البيع: ${sellPrice.toFixed(6)}
🕒 وقت البيع: ${algTime(sellTime)}
📉 نسبة الأرباح: ${profitPercent.toFixed(2)}%
💰 صافي الربح: ${netProfit.toFixed(2)} USD`;
  await sendTelegram(msg);
  // تحديث الإحصائيات اليومية
  dailyStats.totalTrades++;
  if (netProfit > 0) dailyStats.winningTrades++;
  else dailyStats.losingTrades++;
  dailyStats.netProfit += netProfit;
  dailyStats.totalInvested += TRADE_AMOUNT;
}

async function alertStopLoss(symbol, price, dt) {
  const msg = 
`⛔️ <b>إشــارة وقف خسارة</b>
💰 العملة: ${symbol}
💵 السعر: ${price.toFixed(6)}
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

// المنطق الرئيسي مع تتبع الأخطاء أثناء التحليل
async function checkTrading() {
  const now = moment().tz('Africa/Algiers').toDate();

  try {
    for (const symbol of SYMBOLS) {
      try {
        const candles = await getKlines(symbol);
        if (candles.length === 0) continue;

        const indicators = calculateIndicators(candles);
        const lenInd = indicators.rsi.length;
        if (lenInd === 0) continue;

        const rsi = indicators.rsi[lenInd - 1];
        const bPercent = indicators.bPercents[lenInd - 1];
        const macdBuyCross = getMacdCross(indicators.macdBuy);
        const macdSellCross = getMacdCross(indicators.macdSell);
        const closePrice = candles[candles.length - 1].close;

        // إرسال التنبيهات حسب الشروط:

        if (rsi < 40 && bPercent < 0.4 && macdBuyCross === 'positive') {
          await alertBuy(symbol, closePrice, TRADE_AMOUNT, now);
        }

        if (rsi > 55 && macdSellCross === 'negative') {
          const buyPrice = closePrice * 0.95; // نفترض أن الشراء كان بسعر أقل 5%
          await alertSell(symbol, closePrice, buyPrice, now, now);
        }

        if (closePrice <= closePrice * (1 - STOP_LOSS_DROP_PERCENT)) {
          await alertStopLoss(symbol, closePrice, now);
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

// إرسال تقرير الأرباح اليومية في منتصف الليل (توقيت الجزائر)
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

    // إعادة تعيين الإحصائيات لليوم التالي
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

console.log('Trading alert bot started without Binance API, with error logging.');

// بدء التشغيل وجدولة الفحص كل 15 دقيقة
checkTrading();
schedule.scheduleJob('*/2 * * * *', () => {
  console.log('Checking alerts at', algTime(new Date()));
  checkTrading();
});
