
import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8'; // ضع توكن البوت هنا
const CHAT_IDS = ['1055739217','6430992956','674606053']; // ضع أرقام الشات هنا
const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.015;

let inPositions = {};
let lastAlertsTime = {};
let lastAlertPrice = {};
let percentBPassed = {};
let dailyProfits = {};

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

function canSendAlert(symbol, type, currentTime, price) {
  const COOLDOWN = 5 * 60 * 1000; // 5 دقائق بالميلي ثانية
  if (!lastAlertsTime[symbol]) {
    lastAlertsTime[symbol] = {};
    lastAlertPrice[symbol] = {};
  }
  const lastTime = lastAlertsTime[symbol][type];
  const lastPrice = lastAlertPrice[symbol][type];

  if (lastTime && (currentTime - lastTime) < COOLDOWN && lastPrice === price) {
    return false; // نفس السعر ونفس النوع خلال فترة الكوولداون
  }
  lastAlertsTime[symbol][type] = currentTime;
  lastAlertPrice[symbol][type] = price;
  return true;
}

function formatDate(date) {
  const offsetDate = new Date(date.getTime() + 60 * 60 * 1000); // GMT+1
  return offsetDate.toISOString().replace('T', ' ').slice(0, 19);
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
      if (closes.length < 20) continue;

      const rsi = calculateRSI(closes, 14);
      const percentB = calculatePercentB(closes);
      const macdBuy = calculateMACD(closes, 1, 2, 2);
      const macdSell = calculateMACD(closes, 1, 10, 2);

      const lastIndex = closes.length - 1;
      const price = closes[lastIndex];
      const timeNow = new Date();
      const timeStr = formatDate(timeNow);
      const now = timeNow.getTime();

      const rsiVal = rsi[rsi.length - 1];
      const pbVal = percentB[percentB.length - 1];
      const macdHistBuy = macdBuy[macdBuy.length - 1]?.MACD - macdBuy[macdBuy.length - 1]?.signal;
      const prevMacdHistBuy = macdBuy[macdBuy.length - 2]?.MACD - macdBuy[macdBuy.length - 2]?.signal;
      const macdHistSell = macdSell[macdSell.length - 1]?.MACD - macdSell[macdSell.length - 1]?.signal;
      const prevMacdHistSell = macdSell[macdSell.length - 2]?.MACD - macdSell[macdSell.length - 2]?.signal;

      const position = inPositions[symbol];

      if (percentBPassed[symbol] === undefined) percentBPassed[symbol] = false;
      percentBPassed[symbol] = pbVal > 0.2;

      const buySignal = !position &&
        rsiVal < 40 && pbVal < 0.4 &&
        prevMacdHistBuy < 0 && macdHistBuy > 0;

      const sellSignal = position &&
        position.supports.length > 0 &&
        percentBPassed[symbol] &&
        prevMacdHistSell > 0 && macdHistSell < 0;

      const sellRegularSignal = position &&
        position.supports.length === 0 &&
        rsiVal > 55 &&
        prevMacdHistSell > 0 && macdHistSell < 0;

      if (buySignal) {
        if (canSendAlert(symbol, 'buy', now, price)) {
          inPositions[symbol] = { symbol, buyPrice: price, buyTime: timeNow, supports: [] };
          sendTelegramMessage(`🟢 إشارة شراء جديدة\nالعملة: ${symbol}\nالسعر: ${price}\nالوقت: ${timeStr}`);
        }
      }
      else if (sellSignal) {
        if (canSendAlert(symbol, 'sell', now, price)) {
          const avgBuy = [position.buyPrice, ...position.supports.map(s => s.price)].reduce((a, b) => a + b) / (1 + position.supports.length);
          const changePercent = ((price - avgBuy) / avgBuy * 100).toFixed(2);
          const profit = price - avgBuy;
          const dateStr = timeNow.toISOString().slice(0, 10);

          if (!dailyProfits[dateStr]) dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
          dailyProfits[dateStr].totalProfit += profit;
          if (profit > 0) dailyProfits[dateStr].wins++;
          else if (profit < 0) dailyProfits[dateStr].losses++;

          let message = `🔴 إشارة بيع\nالعملة: ${symbol}\nسعر الشراء الأساسي: ${position.buyPrice}\nوقت الشراء: ${formatDate(position.buyTime)}\n`;
          position.supports.forEach((s, i) => {
            message += `➕ سعر التدعيم ${i + 1}: ${s.price}\nوقت التدعيم ${i + 1}: ${formatDate(s.time)}\n`;
          });
          message += `\n💸 سعر البيع: ${price}\nوقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent}%`;

          sendTelegramMessage(message);
          delete inPositions[symbol];
        }
      }
      else if (sellRegularSignal) {
        if (canSendAlert(symbol, 'sellRegular', now, price)) {
          const changePercent = ((price - position.buyPrice) / position.buyPrice * 100).toFixed(2);
          const profit = price - position.buyPrice;
          const dateStr = timeNow.toISOString().slice(0, 10);

          if (!dailyProfits[dateStr]) dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
          dailyProfits[dateStr].totalProfit += profit;
          if (profit > 0) dailyProfits[dateStr].wins++;
          else if (profit < 0) dailyProfits[dateStr].losses++;

          let message = `🔴 إشارة بيع عادي\nالعملة: ${symbol}\nسعر الشراء: ${position.buyPrice}\nوقت الشراء: ${formatDate(position.buyTime)}\n\n💸 سعر البيع: ${price}\nوقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent}%`;

          sendTelegramMessage(message);
          delete inPositions[symbol];
        }
      }
      else if (position &&
        price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) &&
        buySignal
      ) {
        const lastSupport = position.supports[position.supports.length - 1];
        const basePrice = lastSupport ? lastSupport.price : position.buyPrice;
        if (price <= basePrice * (1 - PRICE_DROP_SUPPORT)) {
          if (canSendAlert(symbol, 'support', now, price)) {
            position.supports.push({ price, time: timeNow });
            sendTelegramMessage(`🟠 تدعيم للشراء\nالعملة: ${symbol}\nالسعر: ${price}\nالوقت: ${timeStr}`);
          }
        }
      }
    } catch (err) {
      console.error(`خطأ في تحليل ${symbol}:`, err.message);
    }
  }
}

let isAnalyzing = false;

cron.schedule('*/2 * * * *', async () => {
  if (isAnalyzing) {
    console.log("تحليل قيد التنفيذ، تخطي هذه الدورة.");
    return;
  }
  try {
    isAnalyzing = true;
    console.log("جاري التحليل...");
    await analyze();
  } catch (error) {
    console.error("خطأ أثناء التحليل:", error);
  } finally {
    isAnalyzing = false;
  }
});

cron.schedule('0 0 * * *', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  const report = dailyProfits[dateStr];
  if (report) {
    const message = `📊 تقرير الأرباح ليوم ${dateStr}:\n💰 إجمالي الربح/الخسارة: ${report.totalProfit.toFixed(8)} وحدة نقدية\n✅ عدد الصفقات الرابحة: ${report.wins}\n❌ عدد الصفقات الخاسرة: ${report.losses}`;
    sendTelegramMessage(message);
    delete dailyProfits[dateStr];
  } else {
    sendTelegramMessage(`📊 تقرير الأرباح ليوم ${dateStr}:\nلم يتم تسجيل أي صفقة.`);
  }
});
