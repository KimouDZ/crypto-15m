import ccxt from 'ccxt';
import axios from 'axios';
import cron from 'node-cron';
import { macd, rsi, bollingerbands } from 'technicalindicators';
import fs from 'fs';

const coins = JSON.parse(fs.readFileSync('./coins.json', 'utf-8'));
const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';

const binance = new ccxt.binance();

// تحميل المراكز المفتوحة من الملف إن وجدت
let openPositions = {};
const positionsFile = './positions.json';
if (fs.existsSync(positionsFile)) {
  openPositions = JSON.parse(fs.readFileSync(positionsFile, 'utf-8'));
}

function savePositions() {
  fs.writeFileSync(positionsFile, JSON.stringify(openPositions, null, 2));
}

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, { chat_id: CHAT_ID, text: message });
}

async function analyzeSymbol(symbol) {
  try {
    const market = symbol.replace('/', '');
    const ohlcv = await binance.fetchOHLCV(symbol, '15m', undefined, 100);

    const closes = ohlcv.map(c => c[4]);
    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);
    const last = closes[closes.length - 1];

    const rsiVal = rsi({ values: closes, period: 14 }).slice(-1)[0];
    const bb = bollingerbands({ period: 20, stdDev: 2, values: closes }).slice(-1)[0];
    const percentB = (last - bb.lower) / (bb.upper - bb.lower);

    const macdBuy = macd({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 10,
      signalPeriod: 4,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    }).map(v => v.histogram);

    const macdSell = macd({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 100,
      signalPeriod: 8,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    }).map(v => v.histogram);

    const buyCross = macdBuy.slice(-2);
    const sellCross = macdSell.slice(-2);

    const hasBuySignal =
      rsiVal < 45 && percentB < 0.2 && buyCross[0] < 0 && buyCross[1] > 0;

    const hasSellSignal =
      openPositions[symbol] &&
      sellCross[0] > 0 &&
      sellCross[1] < 0;

    if (hasBuySignal && !openPositions[symbol]) {
      openPositions[symbol] = last;  // نخزن سعر الشراء
      savePositions();
      await sendTelegramMessage(`📈 شراء: ${symbol} بسعر ${last}`);
    }

    if (hasSellSignal) {
      const buyPrice = openPositions[symbol];
      const profitPercent = (((last - buyPrice) / buyPrice) * 100).toFixed(2);
      delete openPositions[symbol];
      savePositions();
      await sendTelegramMessage(`📉 بيع: ${symbol} بسعر ${last} ✅ ${profitPercent}%`);
    }
  } catch (err) {
    console.error(`خطأ في ${symbol}:`, err.message);
  }
}

async function runAnalysis() {
  console.log(`[${new Date().toLocaleTimeString()}] تحليل العملات...`);
  for (const symbol of coins) {
    await analyzeSymbol(symbol);
  }
}

cron.schedule('*/1 * * * *', runAnalysis);
