import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';
import cron from 'node-cron';

const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID';
const exchange = new ccxt.binance();

let lastSignals = {};
let activeTrades = {};

const indicatorsConfig = {
  rsiPeriod: 14,
  bbPeriod: 20,
  bbStdDev: 2,
  macdBuy: { fast: 1, slow: 2, signal: 2 },
  macdSell: { fast: 1, slow: 10, signal: 2 },
  supportDrop: 0.015
};

async function fetchOHLCV(symbol) {
  try {
    const data = await exchange.fetchOHLCV(symbol, '4h', undefined, 100);
    return data.map(d => ({ time: d[0], open: d[1], high: d[2], low: d[3], close: d[4], volume: d[5] }));
  } catch (error) {
    return [];
  }
}

function calculateIndicators(data) {
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);

  const rsi = technicalindicators.rsi({ values: closes, period: indicatorsConfig.rsiPeriod });
  const bb = technicalindicators.bollingerbands({ period: indicatorsConfig.bbPeriod, values: closes, stdDev: indicatorsConfig.bbStdDev });
  const macdBuy = technicalindicators.macd({ values: closes, fastPeriod: indicatorsConfig.macdBuy.fast, slowPeriod: indicatorsConfig.macdBuy.slow, signalPeriod: indicatorsConfig.macdBuy.signal, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdSell = technicalindicators.macd({ values: closes, fastPeriod: indicatorsConfig.macdSell.fast, slowPeriod: indicatorsConfig.macdSell.slow, signalPeriod: indicatorsConfig.macdSell.signal, SimpleMAOscillator: false, SimpleMASignal: false });

  return { rsi, bb, macdBuy, macdSell };
}

function checkBuyCondition(i, rsi, bb, macd) {
  return rsi[i] < 40 && bb[i].percentB < 0.4 && macd[i - 1]?.MACD < macd[i - 1]?.signal && macd[i]?.MACD > macd[i]?.signal;
}

function checkSellCondition(i, rsi, macd) {
  return rsi[i] > 55 && macd[i - 1]?.MACD > macd[i - 1]?.signal && macd[i]?.MACD < macd[i]?.signal;
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} - ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

async function sendTelegram(message) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });
}

async function analyzeSymbol(symbol) {
  const data = await fetchOHLCV(symbol);
  if (data.length < 50) return;

  const { rsi, bb, macdBuy, macdSell } = calculateIndicators(data);
  const i = rsi.length - 1;
  const price = data[data.length - 1].close;
  const time = formatDate(data[data.length - 1].time);

  if (!activeTrades[symbol]) {
    if (checkBuyCondition(i, rsi, bb, macdBuy)) {
      activeTrades[symbol] = { base: { price, time }, supports: [] };
      await sendTelegram(`📈 <b>شراء</b>
عملة: <b>${symbol}</b>
السعر: <b>${price.toFixed(4)}</b>
الوقت: <b>${time}</b>`);
    }
  } else {
    const trade = activeTrades[symbol];
    const lastSupport = trade.supports[trade.supports.length - 1]?.price || trade.base.price;
    if (price <= lastSupport * (1 - indicatorsConfig.supportDrop) && checkBuyCondition(i, rsi, bb, macdBuy)) {
      trade.supports.push({ price, time });
      await sendTelegram(`🧱 <b>تدعيم</b>
عملة: <b>${symbol}</b>
السعر: <b>${price.toFixed(4)}</b>
الوقت: <b>${time}</b>`);
    } else if (checkSellCondition(i, rsi, macdSell)) {
      const allPrices = [trade.base.price, ...trade.supports.map(s => s.price)];
      const avgBuy = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
      const profit = ((price - avgBuy) / avgBuy) * 100;

      const supportDetails = trade.supports.map((s, idx) => `تدعيم ${idx + 1}: <b>${s.price.toFixed(4)}</b> (${s.time})`).join('\n');

      await sendTelegram(`💰 <b>بيع</b>
عملة: <b>${symbol}</b>
السعر: <b>${price.toFixed(4)}</b>
الوقت: <b>${time}</b>
— — — — —
<b>الشراء:</b> <b>${trade.base.price.toFixed(4)}</b> (${trade.base.time})
${supportDetails}
<b>الربح:</b> <b>${profit.toFixed(2)}%</b>`);

      delete activeTrades[symbol];
    }
  }
}

async function run() {
  const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']; // add more symbols as needed
  for (const symbol of symbols) {
    await analyzeSymbol(symbol);
  }
}

cron.schedule('*/2 * * * *', run);
