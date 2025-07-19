import ccxt from 'ccxt';
import axios from 'axios';
import cron from 'node-cron';
import { macd, rsi, bollingerbands } from 'technicalindicators';
import fs from 'fs';

// قراءة العملات من ملف coins.json
const coins = JSON.parse(fs.readFileSync('./coins.json', 'utf-8'));

// إعدادات التليجرام
const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';

// تهيئة Binance
const binance = new ccxt.binance();

// تخزين العملات المفتوحة مع سعر الشراء
let openPositions = {};

// محاولة تحميل المراكز المفتوحة من ملف (في حال الإعادة)
if (fs.existsSync('./positions.json')) {
  openPositions = JSON.parse(fs.readFileSync('./positions.json', 'utf-8'));
}

// حفظ المراكز المفتوحة إلى ملف
function savePositions() {
  fs.writeFileSync('./positions.json', JSON.stringify(openPositions, null, 2));
}

// إرسال رسالة إلى Telegram بتنسيق Markdown
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

// تحليل عملة واحدة
async function analyzeSymbol(symbol) {
  try {
    const market = symbol.replace('/', '');
    const ohlcv = await binance.fetchOHLCV(symbol, '15m', undefined, 100);

    const closes = ohlcv.map(c => c[4]);
    const last = closes[closes.length - 1];

    const rsiVal = rsi({ values: closes, period: 14 }).slice(-1)[0];
    const bb = bollingerbands({ period: 20, stdDev: 2, values: closes }).slice(-1)[0];
    const percentB = (last - bb.lower) / (bb.upper - bb.lower);

    const macdInputBuy = {
      values: closes,
      fastPeriod: 1,
      slowPeriod: 10,
      signalPeriod: 4,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    };
    const macdInputSell = {
      values: closes,
      fastPeriod: 1,
      slowPeriod: 100,
      signalPeriod: 8,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    };

    const macdBuyHist = macd(macdInputBuy).map(v => v.histogram);
    const macdSellHist = macd(macdInputSell).map(v => v.histogram);

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

    // إشعار الشراء
    if (hasBuySignal && !openPositions[symbol]) {
      openPositions[symbol] = last;
      savePositions();

      const message = `📈 *إشارة شراء*\n\n🪙 العملة: *${symbol}*\n💰 السعر: *${last}*\n🕐 الوقت: *${new Date().toLocaleString()}*`;
      await sendTelegramMessage(message);
    }

    // إشعار البيع
    if (hasSellSignal) {
      const buyPrice = openPositions[symbol];
      const profitPercent = (((last - buyPrice) / buyPrice) * 100).toFixed(2);
      delete openPositions[symbol];
      savePositions();

      const message = `📉 *إشارة بيع*\n\n🪙 العملة: *${symbol}*\n💰 السعر: *${last}*\n📊 ${profitPercent >= 0 ? 'ربح' : 'خسارة'}: *${profitPercent}%*\n🕐 الوقت: *${new Date().toLocaleString()}*`;
      await sendTelegramMessage(message);
    }
  } catch (err) {
    console.error(`❌ خطأ في ${symbol}:`, err.message);
  }
}

// تحليل كل العملات
async function runAnalysis() {
  console.log(`[${new Date().toLocaleTimeString()}] 🔍 بدء التحليل...`);
  for (const symbol of coins) {
    await analyzeSymbol(symbol);
  }
}

// جدول المهام كل دقيقة
cron.schedule('*/1 * * * *', runAnalysis);
