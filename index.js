
import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';
import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid'; // تحتاج تثبيت uuid عبر npm install uuid

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_IDS = ['1055739217', '6430992956', '674606053'];
const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.017;

// معرف فريد لكل تشغيل للتمييز بين نسخ البرنامج المختلفة
const RUN_ID = uuidv4();
console.log(`🚀 بدء تشغيل البرنامج بمعرف ${RUN_ID}`);

function loadPositions() {
  try {
    const data = fs.readFileSync('positions.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function savePositions(data) {
  try {
    fs.writeFileSync('positions.json', JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`⚠️ [${RUN_ID}] خطأ في حفظ المراكز:`, error.message);
  }
}

let inPositions = loadPositions();
let percentBPassed = {};
let dailyProfits = {};

// تخزين وقت انتهاء صلاحية التنبيه لكل عملة
let alertSentUntil = {};

// مدة الكولداون (فاصل منع إرسال تنبيه مكرر)
const ALERT_COOLDOWN_MS = 60 * 1000; // 60 ثانية

function sendTelegramMessage(message) {
  for (const chatId of CHAT_IDS) {
    const nowIso = new Date().toISOString();
    console.log(`[${nowIso}] [${RUN_ID}] ⚡️ إرسال رسالة إلى ${chatId}`);
    axios
      .post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      })
      .then(() => {
        console.log(`[${nowIso}] [${RUN_ID}] ✅ تم إرسال الرسالة بنجاح إلى ${chatId}`);
      })
      .catch((error) => {
        console.error(`[${nowIso}] [${RUN_ID}] ❌ فشل إرسال الرسالة إلى ${chatId}:`, error.message);
      });
  }
}

function canSendAlert(symbol, currentTime) {
  if (alertSentUntil[symbol] && currentTime < alertSentUntil[symbol]) {
    console.log(
      `[${new Date(currentTime).toISOString()}] [${RUN_ID}] 🚫 تم منع التنبيه مؤقتًا لـ ${symbol} حتى ${new Date(alertSentUntil[symbol]).toISOString()}`
    );
    return false;
  }

  alertSentUntil[symbol] = currentTime + ALERT_COOLDOWN_MS;
  return true;
}

function formatDate(date) {
  // ضبط التوقيت +01 GMT
  const offsetDate = new Date(date.getTime() + 60 * 60 * 1000);
  return offsetDate.toISOString().replace('T', ' ').slice(0, 19);
}

function calculateMACD(values, fastPeriod, slowPeriod, signalPeriod) {
  return technicalindicators.MACD.calculate({
    values,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
}

function calculateRSI(values, period) {
  return technicalindicators.RSI.calculate({ values, period });
}

function calculatePercentB(closes, period = 20, stdDev = 2) {
  const bb = technicalindicators.BollingerBands.calculate({
    period,
    stdDev,
    values: closes,
  });
  return closes.slice(period - 1).map((close, i) => {
    const band = bb[i];
    return band ? (close - band.lower) / (band.upper - band.lower) : 0;
  });
}

// قفل لمنع تداخل استدعاءات التحليل
let isAnalyzing = false;

async function analyze() {
  if (isAnalyzing) {
    console.log('📌 تحليل جاري، يتم تجاهل استدعاء analyze جديد');
    return;
  }
  isAnalyzing = true;

  try {
    const coins = JSON.parse(fs.readFileSync('coins.json'));
    console.log(`🚀 بدء تحليل العملات: ${coins.join(', ')}`);

    const now = Date.now();

    for (const symbol of coins) {
      console.log(`🔍 جاري تحليل العملة: ${symbol}`);

      let alertSentForSymbol = false; // لمنع إرسال أكثر من تنبيه خلال نفس دورة التحليل

      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
        const closes = ohlcv.map((c) => c[4]);
        if (closes.length < 20) continue;

        const rsi = calculateRSI(closes, 14);
        const percentB = calculatePercentB(closes);
        const macdBuy = calculateMACD(closes, 1, 2, 2);
        const macdSell = calculateMACD(closes, 1, 10, 2);

        const lastIndex = closes.length - 1;
        const priceRaw = closes[lastIndex];
        const price = priceRaw; // السعر الخام بدون تقريب
        const timeNow = new Date();
        const timeStr = formatDate(timeNow);

        const rsiVal = rsi[rsi.length - 1];
        const pbVal = percentB[percentB.length - 1];
        const macdHistBuy =
          macdBuy[macdBuy.length - 1]?.MACD - macdBuy[macdBuy.length - 1]?.signal;
        const prevMacdHistBuy =
          macdBuy[macdBuy.length - 2]?.MACD - macdBuy[macdBuy.length - 2]?.signal;
        const macdHistSell =
          macdSell[macdSell.length - 1]?.MACD - macdSell[macdSell.length - 1]?.signal;
        const prevMacdHistSell =
          macdSell[macdSell.length - 2]?.MACD - macdSell[macdSell.length - 2]?.signal;

        const position = inPositions[symbol];

        if (percentBPassed[symbol] === undefined) percentBPassed[symbol] = false;
        percentBPassed[symbol] = pbVal > 0.2;

        const buySignal =
          !position &&
          rsiVal < 40 &&
          pbVal < 0.4 &&
          prevMacdHistBuy < 0 &&
          macdHistBuy > 0;

        const sellSignal =
          position &&
          position.supports.length > 0 &&
          percentBPassed[symbol] &&
          prevMacdHistSell > 0 &&
          macdHistSell < 0;

        const sellRegularSignal =
          position &&
          position.supports.length === 0 &&
          rsiVal > 55 &&
          prevMacdHistSell > 0 &&
          macdHistSell < 0;

        if (!alertSentForSymbol && buySignal) {
          if (canSendAlert(symbol, now)) {
            console.log(`💚 [${timeStr}] إشارة شراء للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
            inPositions[symbol] = {
              symbol,
              buyPrice: price,
              buyTime: timeNow,
              supports: [],
            };
            savePositions(inPositions);
            sendTelegramMessage(
              `🟢 إشــارة شــراء جديدة\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n📅 الوقت: ${timeStr}`
            );
            alertSentForSymbol = true;
          }
        } else if (!alertSentForSymbol && sellSignal) {
          if (canSendAlert(symbol, now)) {
            console.log(`🔴 [${timeStr}] إشارة بيع تدعيم للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
            const avgBuy =
              [position.buyPrice, ...position.supports.map((s) => s.price)].reduce(
                (a, b) => a + b
              ) /
              (1 + position.supports.length);
            const changePercent = ((price - avgBuy) / avgBuy * 100).toFixed(2);
            const profit = price - avgBuy;
            const dateStr = timeNow.toISOString().slice(0, 10);

            if (!dailyProfits[dateStr])
              dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
            dailyProfits[dateStr].totalProfit += profit;
            if (profit > 0) dailyProfits[dateStr].wins++;
            else if (profit < 0) dailyProfits[dateStr].losses++;

            let message = `🔴 إشــارة بيـع\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء الأساسي: ${position.buyPrice.toLocaleString(
              undefined,
              { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            )}\n📅 وقت الشراء: ${formatDate(position.buyTime)}\n\n`;

            position.supports.forEach((s, i) => {
              message += `➕ سعر التدعيم ${i + 1}: ${s.price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}\n📅 وقت التدعيم ${i + 1}: ${formatDate(s.time)}\n\n`;
            });

            message += `💸 سعر البيع: ${price}\n📅 وقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${
              changePercent > 0 ? '+' : ''
            }${changePercent}%`;
            sendTelegramMessage(message);
            delete inPositions[symbol];
            savePositions(inPositions);
            alertSentForSymbol = true;
          }
        } else if (!alertSentForSymbol && sellRegularSignal) {
          if (canSendAlert(symbol, now)) {
            console.log(`🔴 [${timeStr}] إشارة بيع عادي للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
            const changePercent = (
              ((price - position.buyPrice) / position.buyPrice) *
              100
            
