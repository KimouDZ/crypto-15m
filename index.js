import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.015;

let inPositions = {};

function sendTelegramMessage(message) {
  axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

function formatDate(date) {
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', ' -');
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

      const rsi = calculateRSI(closes, 14);
      const percentB = calculatePercentB(closes);
      const macdBuy = calculateMACD(closes, 1, 2, 2);
      const macdSell = calculateMACD(closes, 1, 10, 2);

      const lastIndex = closes.length - 1;
      const price = closes[lastIndex];
      const time = new Date(times[lastIndex]);
      const timeStr = formatDate(time);

      const rsiVal = rsi[rsi.length - 1];
      const pbVal = percentB[percentB.length - 1];
      const macdHistBuy = macdBuy[macdBuy.length - 1]?.MACD - macdBuy[macdBuy.length - 1]?.signal;
      const prevMacdHistBuy = macdBuy[macdBuy.length - 2]?.MACD - macdBuy[macdBuy.length - 2]?.signal;

      const macdHistSell = macdSell[macdSell.length - 1]?.MACD - macdSell[macdSell.length - 1]?.signal;
      const prevMacdHistSell = macdSell[macdSell.length - 2]?.MACD - macdSell[macdSell.length - 2]?.signal;

      const id = symbol;
      const position = inPositions[id];

      const buySignal = rsiVal < 40 && pbVal < 0.4 && prevMacdHistBuy < 0 && macdHistBuy > 0;
      const sellSignal = position && rsiVal > 55 && prevMacdHistSell > 0 && macdHistSell < 0;

      if (!position && buySignal) {
        inPositions[id] = {
          symbol,
          buyPrice: price,
          buyTime: time,
          supports: []
        };
        sendTelegramMessage(`🟢 *إشارة شراء جديدة*

🪙 العملة: ${symbol}
💰 السعر: ${price}
📅 الوقت: ${timeStr}`);

      } else if (position && sellSignal) {
        const avgBuy = [position.buyPrice, ...position.supports.map(s => s.price)].reduce((a, b) => a + b) / (1 + position.supports.length);
        const change = ((price - avgBuy) / avgBuy * 100).toFixed(2);
        let message = `🔴 *إشارة بيع*

🪙 العملة: ${symbol}
💰 سعر الشراء الأساسي: ${position.buyPrice}
📅 وقت الشراء: ${formatDate(position.buyTime)}

`;
        position.supports.forEach((s, i) => {
          message += `🟠 سعر التدعيم ${i + 1}: ${s.price}
📅 وقت التدعيم ${i + 1}: ${formatDate(s.time)}
`;
        });
        message += `
💸 سعر البيع: ${price}
📅 وقت البيع: ${timeStr}

📊 الربح/الخسارة: ${change > 0 ? '+' : ''}${change}%`;

        sendTelegramMessage(message);
        delete inPositions[id];

      } else if (position && price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) && buySignal) {
        const lastSupport = position.supports[position.supports.length - 1];
        const basePrice = lastSupport ? lastSupport.price : position.buyPrice;
        if (price <= basePrice * (1 - PRICE_DROP_SUPPORT)) {
          position.supports.push({ price, time });
          sendTelegramMessage(`🟠 *تدعيم للشراء*

🪙 العملة: ${symbol}
💰 السعر: ${price}
📅 الوقت: ${timeStr}`);
        }
      }
    } catch (err) {
      console.error(`❌ خطأ في تحليل ${symbol}:`, err.message);
    }
  }
}

cron.schedule('*/2 * * * *', async () => {
  console.log("جاري التحليل...");

analyze();
