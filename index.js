import fetch from "node-fetch";
import cron from "node-cron";
import coins from "./coins.json" assert { type: "json" };

const TELEGRAM_TOKEN = "8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8";
const CHAT_ID = "1055739217"; // معرفك كما طلبت
const interval = "1h";
const limit = 50;

async function getCandles(symbol, interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => ({
    openTime: c[0],
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    closeTime: c[6],
  }));
}

function rsi(closes, period = 14) {
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / (avgLoss || 1);
  return 100 - 100 / (1 + rs);
}

function percentB(closes, period = 20, mult = 2.0) {
  const slice = closes.slice(-period);
  const sma =
    slice.reduce((sum, val) => sum + val, 0) / period;
  const std =
    Math.sqrt(slice.reduce((sum, val) => sum + (val - sma) ** 2, 0) / period);
  const upper = sma + mult * std;
  const lower = sma - mult * std;
  const lastClose = closes[closes.length - 1];
  return (lastClose - lower) / (upper - lower);
}

function macd(closes, fastLen, slowLen, signalLen) {
  const ema = (arr, len) => {
    const k = 2 / (len + 1);
    return arr.reduce((acc, val, i) => {
      if (i === 0) return [val];
      acc.push(val * k + acc[i - 1] * (1 - k));
      return acc;
    }, []);
  };

  const emaFast = ema(closes, fastLen);
  const emaSlow = ema(closes, slowLen);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine.slice(slowLen - 1), signalLen);
  return { macdLine: macdLine.slice(-2), signalLine: signalLine.slice(-2) };
}

function isBuySignal(closes) {
  const rsiVal = rsi(closes);
  const pb = percentB(closes);
  const { macdLine, signalLine } = macd(closes, 1, 50, 20);
  const crossUp = macdLine[0] < signalLine[0] && macdLine[1] > signalLine[1];
  return rsiVal < 45 && pb < 0.4 && crossUp;
}

function isSellSignal(closes) {
  const { macdLine, signalLine } = macd(closes, 1, 100, 8);
  const crossDown = macdLine[0] > signalLine[0] && macdLine[1] < signalLine[1];
  return crossDown;
}

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
    }),
  });
}

async function analyze() {
  for (const symbol of coins) {
    try {
      const candles = await getCandles(symbol, interval, limit);
      const closes = candles.map(c => c.close);
      if (closes.length < 100) continue;

      const buy = isBuySignal(closes);
      const sell = isSellSignal(closes);

      if (buy) {
        await sendTelegramMessage(`🔼 إشارة شراء على ${symbol}`);
      } else if (sell) {
        await sendTelegramMessage(`🔽 إشارة بيع على ${symbol}`);
      }
    } catch (err) {
      console.error(`❌ خطأ في ${symbol}: ${err.message}`);
    }
  }
}

// تحليل العملات كل 15 دقيقة
cron.schedule("*/15 * * * *", async () => {
  console.log("تشغيل التحليل كل 15 دقيقة");
  await analyzeCoins();
});

console.log("🚀 البوت يعمل الآن على فريم 15 دقيقة كل دقيقة");
