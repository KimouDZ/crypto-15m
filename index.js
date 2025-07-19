// index.js
import axios from "axios";
import ccxt from "ccxt";
import cron from "node-cron";
import fs from "fs";

const coins = JSON.parse(fs.readFileSync("./coins.json"));
const TELEGRAM_TOKEN = "8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8"; // ضع توكن البوت هنا
const CHAT_ID = "1055739217"; // معرف الدردشة الخاص بك
const timeframe = "15m";
const exchange = new ccxt.binance();

let lastSignals = {};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchData(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
    const closes = ohlcv.map(c => c[4]);
    return closes;
  } catch (err) {
    console.error(`فشل في جلب بيانات ${symbol}:`, err.message);
    return null;
  }
}

function calculateIndicators(closes) {
  const rsiPeriod = 14;
  const bbPeriod = 20;
  const bbStdDev = 2.0;
  const macdBuy = { fast: 1, slow: 10, signal: 4 };
  const macdSell = { fast: 1, slow: 100, signal: 8 };

  const slice = closes.slice(-Math.max(100, bbPeriod + 2));
  const close = slice[slice.length - 1];

  // RSI
  let gains = 0, losses = 0;
  for (let i = slice.length - rsiPeriod - 1; i < slice.length - 1; i++) {
    const diff = slice[i + 1] - slice[i];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const rs = gains / (losses || 1);
  const rsi = 100 - 100 / (1 + rs);

  // Bollinger Bands %B
  const bbSlice = slice.slice(-bbPeriod);
  const sma = bbSlice.reduce((a, b) => a + b, 0) / bbPeriod;
  const variance = bbSlice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / bbPeriod;
  const stdDev = Math.sqrt(variance);
  const upper = sma + bbStdDev * stdDev;
  const lower = sma - bbStdDev * stdDev;
  const percentB = (close - lower) / (upper - lower);

  // MACD
  function calcEMA(period, values) {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  function calcMACD({ fast, slow, signal }, values) {
    const fastEMA = calcEMA(fast, values);
    const slowEMA = calcEMA(slow, values);
    const macdLine = fastEMA - slowEMA;
    const signalLine = calcEMA(signal, [ ...values.slice(-signal), macdLine ]);
    return { macdLine, signalLine };
  }

  const macdBuyResult = calcMACD(macdBuy, slice);
  const macdSellResult = calcMACD(macdSell, slice);

  return { rsi, percentB, macdBuy: macdBuyResult, macdSell: macdSellResult };
}

async function analyzeSymbol(symbol) {
  const closes = await fetchData(symbol);
  if (!closes) return;

  const { rsi, percentB, macdBuy, macdSell } = calculateIndicators(closes);

  const last = lastSignals[symbol] || "NONE";
  const isBuy = rsi < 45 && percentB < 0.2 && macdBuy.macdLine > macdBuy.signalLine;
  const wasBuy = last === "BUY";
  const isSell = wasBuy && macdSell.macdLine < macdSell.signalLine;

  if (isBuy && last !== "BUY") {
    await sendTelegram(`🔔 شراء على ${symbol}\nRSI = ${rsi.toFixed(2)}\n%B = ${percentB.toFixed(2)}`);
    lastSignals[symbol] = "BUY";
  } else if (isSell && last !== "SELL") {
    await sendTelegram(`⚠️ بيع على ${symbol}`);
    lastSignals[symbol] = "SELL";
  }
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message
  });
}

cron.schedule("*/1 * * * *", async () => {
  console.log("🔄 جاري التحليل...");
  for (const coin of coins) {
    await analyzeSymbol(coin.symbol);
    await sleep(250);
  }
});
