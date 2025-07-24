
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
let lastAlertsTime = {}; // لتتبع آخر وقت إرسال تنبيه لكل عملة ونوع
let percentBPassed = {}; // لتتبع تجاوز %B حد 0.2 لكل عملة
let dailyProfits = {};   // تخزين الأرباح اليومية بالهيكل { totalProfit, wins, losses }

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

function canSendAlert(symbol, type, currentTime) {
  if (!lastAlertsTime[symbol]) {
    lastAlertsTime[symbol] = {};
  }
  const lastTime = lastAlertsTime[symbol][type];
  if (lastTime && (currentTime - lastTime) < 1000) { // منع التكرار خلال ثانية
    return false;
  }
  lastAlertsTime[symbol][type] = currentTime;
  return true;
}

function formatDate(date) {
  const offsetDate = new Date(date.getTime() + 60 * 60 * 1000); // GMT+1
  const day = String(offsetDate.getUTCDate()).padStart(2, '0');
  const month = String(offsetDate.getUTCMonth() + 1).padStart(2, '0');
  const year = offsetDate.getUTCFullYear();
  const hours = String(offsetDate.getUTCHours()).padStart(2, '0');
  const minutes = String(offsetDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(offsetDate.getUTCSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} - ${hours}:${minutes}:${seconds}`;
}

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

async function analyze() {
  const coins = JSON.parse(fs.readFileSync('coins.json'));
  for (const symbol of coins) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
      const closes = ohlcv.map(c => c[4]);
      const times = ohlcv.map(c => c[0]);
      if (closes.length < 20) continue;

      const rsi = calculateRSI(closes, 14);
      const percentB = calculatePercentB(closes);
      const macdBuy = calculateMACD(closes, 1, 2, 2);
      const macdSell = calculateMACD(closes, 1, 10, 2);

      const lastIndex = closes.length - 1;
      const price = closes[lastIndex];
      const time = new Date(times[lastIndex]);
      const timeStr = formatDate(time);
      const now = Date.now();

      const rsiVal = rsi[rsi.length - 1];
      const pbVal = percentB[percentB.length - 1];
      const macdHistBuy = macdBuy[macdBuy.length - 1]?.MACD - macdBuy[macdBuy.length - 1]?.signal;
      const prevMacdHistBuy = macdBuy[macdBuy.length - 2]?.MACD - macdBuy[macdBuy.length - 2]?.signal;
      const macdHistSell = macdSell[macdSell.length - 1]?.MACD - macdSell[macdSell.length - 1]?.signal;
      const prevMacdHistSell = macdSell[macdSell.length - 2]?.MACD - macdSell[macdSell.length - 2]?.signal;

      const id = symbol;
      const position = inPositions[id];

      if (percentBPassed[symbol] === undefined) {
        percentBPassed[symbol] = false;
      }
      percentBPassed[symbol] = pbVal > 0.2;

      const buySignal = !position && rsiVal < 40 && pbVal < 0.4 && prevMacdHistBuy < 0 && macdHistBuy > 0;

      const sellAfterSupportSignal = position &&
                                     position.supports.length > 0 &&
                                     percentBPassed[symbol] &&
                                     prevMacdHistSell > 0 &&
                                     macdHistSell < 0;

      const sellBasicSignal = position &&
                              position.supports.length === 0 &&
                              rsiVal > 55 &&
                              prevMacdHistSell > 0 &&
                              macdHistSell < 0;

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
      else if (sellAfterSupportSignal) {
        if (canSendAlert(symbol, 'sell', now)) {
          const avgBuy = [position.buyPrice, ...position.supports.map(s => s.price)].reduce((a,b) => a+b) / (1 + position.supports.length);
          const changePercent = ((price - avgBuy) / avgBuy * 100).toFixed(2);
          const profit = price - avgBuy;
          const dateStr = time.toISOString().slice(0,10);

          if (!dailyProfits[dateStr]) {
            dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
          }

          dailyProfits[dateStr].totalProfit += profit;
          if (profit > 0) dailyProfits[dateStr].wins++;
          else if (profit < 0) dailyProfits[dateStr].losses++;

          let message = `🔴 *إشارة بيع بعد تدعيم*\n\n🪙 العملة: ${symbol}\n💰 سعر البيع: ${price}\n📅 الوقت: ${timeStr}\n📊 الربح/الخسارة: ${changePercent}%`;
          sendTelegramMessage(message);
          delete inPositions[id];
        }
      }
      else if (sellBasicSignal) {
        if (canSendAlert(symbol, 'sell_basic', now)) {
          const avgBuy = position.buyPrice;
          const changePercent = ((price - avgBuy) / avgBuy * 100).toFixed(2);
          const profit = price - avgBuy;
          const dateStr = time.toISOString().slice(0,10);

          if (!dailyProfits[dateStr]) {
            dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
          }
          dailyProfits[dateStr].totalProfit += profit;
          if (profit > 0) dailyProfits[dateStr].wins++;
          else if (profit < 0) dailyProfits[dateStr].losses++;

          let message = `🔴 *إشارة بيع عادي*\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء الأساسي: ${position.buyPrice}\n📅 وقت الشراء: ${formatDate(position.buyTime)}\n💰 سعر البيع: ${price}\n📅 وقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent}%`;
          sendTelegramMessage(message);
          delete inPositions[id];
        }
      }
      else if (position &&
               price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) &&
               buySignal) {
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

// جدولة التحليل كل دقيقتين
cron.schedule('*/2 * * * *', async () => {
  console.log("جاري التحليل...");
  await analyze();
});

// إرسال تقرير الأرباح يوميًا عند منتصف الليل
cron.schedule('0 0 * * *', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  const report = dailyProfits[dateStr];
  if (report) {
    const message = `📊 تقرير الأرباح ليوم ${dateStr}:
💰 إجمالي الربح/الخسارة: ${report.totalProfit.toFixed(8)} وحدة نقدية
✅ عدد الصفقات الرابحة: ${report.wins}
❌ عدد الصفقات الخاسرة: ${report.losses}`;

    sendTelegramMessage(message);

    delete dailyProfits[dateStr];
  } else {
    sendTelegramMessage(`📊 تقرير الأرباح ليوم ${dateStr}:\nلم يتم تسجيل أي صفقة.`);
  }
});
