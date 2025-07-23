import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_IDS = ['1055739217', '674606053', '6430992956'];
const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.015;

let inPositions = {};
let lastAlertsTime = {}; // متابع آخر وقت إرسال التنبيه لكل عملة ونوع تنبيه
let percentBPassed = {}; // لتتبع تجاوز %B لقيمة 0.4 لكل عملة
let dailyProfits = {};   // لتخزين الأرباح اليومية، المفتاح هو تاريخ اليوم 'YYYY-MM-DD'

// دالة إرسال رسالة تليجرام
function sendTelegramMessage(message) {
  for (const chatId of CHAT_IDS) {
    axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    }).catch(error => {
      console.error(`❌ فشل إرسال الرسالة إلى ${chatId}:`, error.message);
    });
  }
}

// منع تكرار التنبيهات خلال أقل من ثانية لكل نوع ولهذا العملة
function canSendAlert(symbol, type, currentTime) {
  if (!lastAlertsTime[symbol]) {
    lastAlertsTime[symbol] = {};
  }

  const lastTime = lastAlertsTime[symbol][type];
  if (lastTime && (currentTime - lastTime) < 1000) { // 1000 مللي ثانية = 1 ثانية
    return false;
  }

  lastAlertsTime[symbol][type] = currentTime;
  return true;
}

// ضبط الوقت حسب توقيت الجزائر GMT+1
function formatDate(date) {
  const offsetDate = new Date(date.getTime() + 60 * 60 * 1000); // +1 ساعة

  const day = String(offsetDate.getUTCDate()).padStart(2, '0');
  const month = String(offsetDate.getUTCMonth() + 1).padStart(2, '0');
  const year = offsetDate.getUTCFullYear();
  const hours = String(offsetDate.getUTCHours()).padStart(2, '0');
  const minutes = String(offsetDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(offsetDate.getUTCSeconds()).padStart(2, '0');

  return `${day}/${month}/${year} - ${hours}:${minutes}:${seconds}`;
}

// الحسابات الفنية
function calculateMACD(values, fastPeriod, slowPeriod, signalPeriod) {
  return technicalindicators.MACD.calculate({
    values,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
}

function calculateRSI(values, period) {
  return technicalindicators.RSI.calculate({ values, period });
}

function calculatePercentB(closes, period = 20, stdDev = 2) {
  const bb = technicalindicators.BollingerBands.calculate({
    period,
    stdDev,
    values: closes
  });
  return closes.slice(period - 1).map((close, i) => {
    const band = bb[i];
    return band ? (close - band.lower) / (band.upper - band.lower) : 0;
  });
}

// التحليل لكل عملة
async function analyze() {
  const coins = JSON.parse(fs.readFileSync('coins.json'));
  for (const symbol of coins) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
      const closes = ohlcv.map(c => c[4]);
      const times = ohlcv.map(c => c[0]);

      if (closes.length < 20) continue; // للتأكد من وجود بيانات كافية للمؤشرات

      const rsi = calculateRSI(closes, 14);
      const percentB = calculatePercentB(closes);
      const macdBuy = calculateMACD(closes, 1, 2, 2);
      const macdSell = calculateMACD(closes, 1, 10, 2);

      const lastIndex = closes.length - 1;
      const price = closes[lastIndex];
      const time = new Date(times[lastIndex]);
      const timeStr = formatDate(time);
      const now = time.getTime();

      const rsiVal = rsi[rsi.length - 1];
      const pbVal = percentB[percentB.length - 1];
      const macdHistBuy = macdBuy[macdBuy.length - 1]?.MACD - macdBuy[macdBuy.length - 1]?.signal;
      const prevMacdHistBuy = macdBuy[macdBuy.length - 2]?.MACD - macdBuy[macdBuy.length - 2]?.signal;

      const macdHistSell = macdSell[macdSell.length - 1]?.MACD - macdSell[macdSell.length - 1]?.signal;
      const prevMacdHistSell = macdSell[macdSell.length - 2]?.MACD - macdSell[macdSell.length - 2]?.signal;

      const id = symbol;
      const position = inPositions[id];

      // تحديث تتبع حالة %B لكل عملة
      if (percentBPassed[symbol] === undefined) {
        percentBPassed[symbol] = false;
      }
      if (pbVal > 0.4) {
        percentBPassed[symbol] = true;
      } else {
        percentBPassed[symbol] = false;
      }

      // شروط الشراء
      const buySignal = !position &&
        rsiVal < 40 &&
        pbVal < 0.4 &&
        prevMacdHistBuy < 0 &&
        macdHistBuy > 0;

      // شروط البيع بعد التدعيم فقط
      const sellSignal = position &&
        position.supports.length > 0 &&
        percentBPassed[symbol] &&
        prevMacdHistSell > 0 &&
        macdHistSell < 0;

      // شراء جديد
      if (buySignal) {
        if (canSendAlert(symbol, 'buy', now)) {
          inPositions[id] = {
            symbol,
            buyPrice: price,
            buyTime: time,
            supports: []
          };

          sendTelegramMessage(`🟢 *إشارة شراء جديدة*\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n📅 الوقت: ${timeStr}`);
        }
      }
      // بيع بعد التدعيم
      else if (sellSignal) {
        if (canSendAlert(symbol, 'sell', now)) {
          const avgBuy = [position.buyPrice, ...position.supports.map(s => s.price)]
            .reduce((a, b) => a + b) / (1 + position.supports.length);
          const changePercent = ((price - avgBuy) / avgBuy * 100).toFixed(2);
          const profit = price - avgBuy; // الحجم ثابت 1، عدل حسب حاجتك

          // حساب تاريخ اليوم بالصيغة YYYY-MM-DD
          const dateStr = time.toISOString().slice(0, 10);
          dailyProfits[dateStr] = (dailyProfits[dateStr] || 0) + profit;

          let message = `🔴 *إشارة بيع*\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء الأساسي: ${position.buyPrice}\n📅 وقت الشراء: ${formatDate(position.buyTime)}\n`;

          position.supports.forEach((s, i) => {
            message += `➕ سعر التدعيم ${i + 1}: ${s.price}\n📅 وقت التدعيم ${i + 1}: ${formatDate(s.time)}\n`;
          });

          message += `\n💸 سعر البيع: ${price}\n📅 وقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent}%`;

          sendTelegramMessage(message);
          delete inPositions[id];
        }
      }
      // تدعيم شراء
      else if (position &&
        price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) &&
        buySignal // شرط buySignal موجود في الكود لضمان تدعيم متسق مع إشارة شراء
      ) {
        const lastSupport = position.supports[position.supports.length - 1];
        const basePrice = lastSupport ? lastSupport.price : position.buyPrice;

        if (price <= basePrice * (1 - PRICE_DROP_SUPPORT)) {
          if (canSendAlert(symbol, 'support', now)) {
            position.supports.push({ price, time });

            sendTelegramMessage(`🟠 *تدعيم للشراء*\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n📅 الوقت: ${timeStr}`);
          }
        }
      }



    } catch (err) {
      console.error(`❌ خطأ في تحليل ${symbol}:`, err.message);
    }
  }
}

// جدولة التحليل كل دقيقتين كما كان
cron.schedule('*/2 * * * *', async () => {
  console.log("جاري التحليل...");
  await analyze();
});

// إرسال تقرير الأرباح اليومية يوميًا عند منتصف الليل
cron.schedule('0 0 * * *', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0,10);

  const profit = dailyProfits[dateStr] || 0;

  const message = `📊 تقرير الأرباح ليوم ${dateStr}:\n💰 الأرباح الكلية: ${profit.toFixed(8)} وحدة نقدية`;

  sendTelegramMessage(message);

  // تنظيف الأرباح لليوم السابق بعد الإرسال
  delete dailyProfits[dateStr];
});
