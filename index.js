import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('./coins.json'));
const stateFile = './state.json';

let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

async function sendTelegramMessage(message) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });
}

function calculatePercentB(close, bb) {
  return close.map((c, i) => (c - bb.lower[i]) / (bb.upper[i] - bb.lower[i]));
}

function getLastMACDCross(macd, signal) {
  const length = macd.length;
  if (length < 2) return null;
  const prev = macd[length - 2] - signal[length - 2];
  const curr = macd[length - 1] - signal[length - 1];
  if (prev < 0 && curr > 0) return 'bullish';
  if (prev > 0 && curr < 0) return 'bearish';
  return null;
}

async function analyzeSymbol(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '4h');
    const closes = ohlcv.map(c => c[4]);

    if (closes.length < 100) return;

    const rsi = technicalindicators.RSI.calculate({ values: closes, period: 14 });
    const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const percentB = calculatePercentB(closes.slice(-bb.length), bb);
    
    const macdBuy = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 5,
      signalPeriod: 30,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const macdSell = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 2,
      slowPeriod: 10,
      signalPeriod: 15,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const lastPrice = closes[closes.length - 1];
    const coinState = state[symbol] || { inTrade: false, buyPrice: 0 };

    const crossBuy = getLastMACDCross(macdBuy.map(x => x.MACD), macdBuy.map(x => x.signal));
    const crossSell = getLastMACDCross(macdSell.map(x => x.MACD), macdSell.map(x => x.signal));

    const lastRSI = rsi[rsi.length - 1];
    const lastPB = percentB[percentB.length - 1];

    const now = new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' });

    if (!coinState.inTrade && lastRSI < 25 && lastPB < 0 && crossBuy === 'bullish') {
      state[symbol] = { inTrade: true, buyPrice: lastPrice, buyTime: now };
      await sendTelegramMessage(
        `🟢 <b>إشارة شراء</b>\n` +
        `العملة: <b>${symbol}</b>\n` +
        `السعر: <b>${lastPrice}</b>\n` +
        `الوقت: <b>${now}</b>`
      );
    }

    if (coinState.inTrade && lastRSI > 50 && crossSell === 'bearish') {
      const profit = ((lastPrice - coinState.buyPrice) / coinState.buyPrice) * 100;
      await sendTelegramMessage(
        `🔴 <b>إشارة بيع</b>\n` +
        `العملة: <b>${symbol}</b>\n` +
        `سعر الشراء: <b>${coinState.buyPrice}</b>\n` +
        `سعر البيع: <b>${lastPrice}</b>\n` +
        `الربح/الخسارة: <b>${profit.toFixed(2)}%</b>\n` +
        `الوقت: <b>${now}</b>`
      );
      state[symbol] = { inTrade: false, buyPrice: 0 };
    }

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error(`❌ خطأ في ${symbol}:`, error.message);
  }
}

async function runBot() {
  for (let i = 0; i < coins.length; i++) {
    await analyzeSymbol(coins[i]);
    await new Promise(resolve => setTimeout(resolve, 1000)); // تأخير 1 ثانية بين كل عملة
  }
}

cron.schedule('*/2 * * * *', runBot); // كل دقيقتين
