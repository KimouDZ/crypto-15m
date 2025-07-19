import ccxt from 'ccxt';
import axios from 'axios';
import cron from 'node-cron';
import { macd, rsi, bollingerbands } from 'technicalindicators';
import fs from 'fs';

const coins = JSON.parse(fs.readFileSync('./coins.json', 'utf-8'));

// إعدادات التليجرام
const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';

// تهيئة البورصة
const binance = new ccxt.binance();

let openPositions = {}; // المفتاح: العملة، القيمة: سعر الشراء

// تحميل الحالة من ملف في حال إعادة التشغيل
const STATE_FILE = './state.json';
if (fs.existsSync(STATE_FILE)) {
  openPositions = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message
  });
}

async function analyzeSymbol(symbol) {
  try {
    const ohlcv = await binance.fetchOHLCV(symbol, '15m', undefined, 100);
    const closes = ohlcv.map(c => c[4]);
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

    const macdBuySignal = macdBuy.slice(-2);
    const macdSellSignal = macdSell.slice(-2);

    const hasBuySignal =
      rsiVal < 45 &&
      percentB < 0.2 &&
      macdBuySignal[0] < 0 &&
      macdBuySignal[1] > 0;

    const hasSellSignal =
      openPositions[symbol] &&
      macdSellSignal[0] > 0 &&
      macdSellSignal[1] < 0;

    if (hasBuySignal && !openPositions[symbol]) {
      openPositions[symbol] = last;
      await sendTelegramMessage(`📈 شراء: ${symbol} بسعر ${last.toFixed(4)} USDT`);
    }

    if (hasSellSignal) {
      const buyPrice = openPositions[symbol];
      const profitPercent = ((last - buyPrice) / buyPrice) * 100;
      await sendTelegramMessage(`📉 بيع: ${symbol} بسعر ${last.toFixed(4)} USDT\n📊 ${profitPercent.toFixed(2)}% ${profitPercent >= 0 ? 'ربح ✅' : 'خسارة ❌'}`);
      delete openPositions[symbol];
    }

    // حفظ الحالة
    fs.writeFileSync(STATE_FILE, JSON.stringify(openPositions, null, 2));
  } catch (err) {
    console.error(`❌ خطأ في ${symbol}:`, err.message);
  }
}

async function runAnalysis() {
  console.log(`[${new Date().toLocaleTimeString()}] تحليل العملات...`);
  for (const symbol of coins) {
    await analyzeSymbol(symbol);
  }
}

// كل دقيقة
cron.schedule('*/1 * * * *', runAnalysis);
