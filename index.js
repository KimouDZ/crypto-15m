import ccxt from 'ccxt';
import axios from 'axios';
import cron from 'node-cron';
import { macd, rsi, bollingerbands } from 'technicalindicators';
import fs from 'fs';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const POSITIONS_FILE = './openPositions.json';
const coins = JSON.parse(fs.readFileSync('./coins.json', 'utf-8'));

const binance = new ccxt.binance();
let openPositions = {};

if (fs.existsSync(POSITIONS_FILE)) {
  openPositions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf-8'));
}

function savePositions() {
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(openPositions, null, 2));
}

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

async function analyzeSymbol(symbol) {
  try {
    const market = symbol.replace('/', '');
    const ohlcv = await binance.fetchOHLCV(symbol, '4h', undefined, 100);

    const closes = ohlcv.map(c => c[4]);
    const last = closes[closes.length - 1];

    const rsiVal = rsi({ values: closes, period: 14 }).slice(-1)[0];
    const bb = bollingerbands({ period: 20, stdDev: 2, values: closes }).slice(-1)[0];
    const percentB = (last - bb.lower) / (bb.upper - bb.lower);

    const macdBuyHist = macd({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 10,
      signalPeriod: 4,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    }).map(v => v.histogram);

    const macdSellHist = macd({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 100,
      signalPeriod: 8,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    }).map(v => v.histogram);

    const macdBuySignal = macdBuyHist.slice(-2);
    const macdSellSignal = macdSellHist.slice(-2);

    const hasBuySignal =
      rsiVal < 45 &&
      percentB < 0.2 &&
      macdBuySignal[0] < 0 &&
      macdBuySignal[1] > 0;

    const hasSellSignal =
      openPositions[symbol] &&
      macdSellSignal[0] > 0 &&
      macdSellSignal[1] < 0;

    const time = new Date().toLocaleString('ar-DZ', { hour12: false });

    if (hasBuySignal) {
      if (!openPositions[symbol]) {
        openPositions[symbol] = { buyPrice: last, time };
        savePositions();
        await sendTelegramMessage(`🟢 *إشارة شراء جديدة*

📈 *${symbol}*
💰 *السعر:* ${last}
⏰ *الوقت:* ${time}`);
      } else {
        console.log(`[${symbol}] تم تجاهل شراء مكرر`);
      }
    }

    if (hasSellSignal) {
      const buyPrice = openPositions[symbol].buyPrice;
      const change = (((last - buyPrice) / buyPrice) * 100).toFixed(2);
      delete openPositions[symbol];
      savePositions();
      await sendTelegramMessage(`🔴 *إشارة بيع*

📉 *${symbol}*
💰 *السعر:* ${last}
📊 *الربح:* ${change}%
⏰ *الوقت:* ${time}`);
    }

  } catch (err) {
    console.error(`⚠️ خطأ في تحليل ${symbol}:`, err.message);
  }
}

async function runAnalysis() {
  console.log(`[${new Date().toLocaleTimeString()}] ✅ بدء تحليل العملات`);
  for (const symbol of coins) {
    await analyzeSymbol(symbol);
  }
}

cron.schedule('*/2 * * * *', runAnalysis); // كل 15 دقيقة
