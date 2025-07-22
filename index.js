import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import { macd, rsi, bollingerbands } from 'technicalindicators';

const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID';
const exchange = new ccxt.binance();

let inPositions = {};
let supports = {};

const symbols = [
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'ADA/USDT', 'AVAX/USDT', 'XRP/USDT', 'DOGE/USDT'
];

function sendTelegramMessage(message) {
  return axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });
}

function calculateIndicators(closes) {
  const rsiVal = rsi({ period: 14, values: closes });
  const bb = bollingerbands({ period: 20, stdDev: 2, values: closes });
  const macdVal = macd({ values: closes, fastPeriod: 1, slowPeriod: 2, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });
  return { rsiVal, bb, macdVal };
}

function isMACDCrossUp(macd) {
  const len = macd.length;
  return len > 1 && macd[len - 2].MACD < macd[len - 2].signal && macd[len - 1].MACD > macd[len - 1].signal;
}

function isMACDCrossDown(macd) {
  const len = macd.length;
  return len > 1 && macd[len - 2].MACD > macd[len - 2].signal && macd[len - 1].MACD < macd[len - 1].signal;
}

async function analyzeSymbol(symbol) {
  try {
    const market = await exchange.fetchOHLCV(symbol, '4h');
    const closes = market.map(c => c[4]);
    const { rsiVal, bb, macdVal } = calculateIndicators(closes);

    const rsiNow = rsiVal[rsiVal.length - 1];
    const bbNow = bb[bb.length - 1];
    const macdNow = macdVal;
    const priceNow = closes[closes.length - 1];

    const inTrade = inPositions[symbol];
    const supportList = supports[symbol] || [];

    // شروط الشراء
    if (!inTrade && rsiNow < 40 && (priceNow - bbNow.lower) / (bbNow.upper - bbNow.lower) < 0.4 && isMACDCrossUp(macdNow)) {
      inPositions[symbol] = { price: priceNow, date: new Date(), supports: [] };
      await sendTelegramMessage(`📈 <b>شراء</b> لـ ${symbol}\n💵 السعر: ${priceNow.toFixed(4)}\n📅 الوقت: ${new Date().toLocaleString('ar-EG')}`);
      return;
    }

    // شرط التدعيم
    if (inTrade && rsiNow < 40 && (priceNow - bbNow.lower) / (bbNow.upper - bbNow.lower) < 0.4 && isMACDCrossUp(macdNow)) {
      const lastSupport = inTrade.supports.length > 0 ? inTrade.supports[inTrade.supports.length - 1].price : inTrade.price;
      if (priceNow <= lastSupport * 0.985) {
        inTrade.supports.push({ price: priceNow, date: new Date() });
        await sendTelegramMessage(`🧱 <b>تدعيم</b> لـ ${symbol}\n💵 السعر: ${priceNow.toFixed(4)}\n📅 الوقت: ${new Date().toLocaleString('ar-EG')}`);
        return;
      }
    }

    // شرط البيع
    const macdExit = macd({ values: closes, fastPeriod: 1, slowPeriod: 10, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });
    if (inTrade && rsiNow > 55 && isMACDCrossDown(macdExit)) {
      const entryPrices = [inTrade.price, ...inTrade.supports.map(s => s.price)];
      const avgPrice = entryPrices.reduce((a, b) => a + b, 0) / entryPrices.length;
      const profit = ((priceNow - avgPrice) / avgPrice) * 100;
      const dates = [inTrade.date.toLocaleString('ar-EG'), ...inTrade.supports.map(s => new Date(s.date).toLocaleString('ar-EG'))];

      await sendTelegramMessage(`📉 <b>بيع</b> لـ ${symbol}\n💵 السعر: ${priceNow.toFixed(4)}\n📅 الشراء: ${dates.join(' + ')}\n💰 الربح: ${profit.toFixed(2)}٪`);
      delete inPositions[symbol];
    }
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error);
  }
}

cron.schedule('*/2 * * * *', async () => {
  for (const symbol of symbols) {
    await analyzeSymbol(symbol);
  }
});
