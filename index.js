import ccxt from 'ccxt';
import axios from 'axios';
import cron from 'node-cron';
import fs from 'fs';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const INTERVAL = '15m'; // شارت 15 دقيقة
const ANALYSIS_INTERVAL_MINUTES = 2;

const exchange = new ccxt.binance();
const stateFile = './state.json';
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

const coins = [
  "BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT",
  "DOGE/USDT", "ADA/USDT", "AVAX/USDT", "DOT/USDT", "LINK/USDT"
];

function sendTelegramMessage(message) {
  return axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: "Markdown"
  });
}

function formatPercent(p) {
  return `${(p >= 0 ? '+' : '')}${(p * 100).toFixed(2)}%`;
}

function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const rsiPeriod = 10;
  const bbPeriod = 15;
  const bbMultiplier = 2;

  const gains = [];
  const losses = [];
  for (let i = 1; i <= rsiPeriod; i++) {
    const change = closes[closes.length - i] - closes[closes.length - i - 1];
    if (change >= 0) gains.push(change);
    else losses.push(-change);
  }

  const avgGain = gains.reduce((a, b) => a + b, 0) / rsiPeriod;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / rsiPeriod;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  const bbCloses = closes.slice(-bbPeriod);
  const bbAvg = bbCloses.reduce((a, b) => a + b, 0) / bbPeriod;
  const std = Math.sqrt(bbCloses.reduce((a, b) => a + Math.pow(b - bbAvg, 2), 0) / bbPeriod);
  const upper = bbAvg + bbMultiplier * std;
  const lower = bbAvg - bbMultiplier * std;
  const lastClose = closes[closes.length - 1];
  const percentB = (lastClose - lower) / (upper - lower);

  return { rsi, percentB, closes };
}

function calculateMACD(closes, fast, slow, signal) {
  function ema(length, data) {
    const k = 2 / (length + 1);
    let ema = data.slice(0, length).reduce((a, b) => a + b) / length;
    for (let i = length; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  const macdLine = ema(fast, closes) - ema(slow, closes);
  const signalLine = ema(signal, closes);
  return { macdLine, signalLine };
}

async function analyzeMarket() {
  for (const symbol of coins) {
    try {
      const market = await exchange.loadMarkets();
      const ohlcv = await exchange.fetchOHLCV(symbol, INTERVAL, undefined, 100);
      const candles = ohlcv.map(c => ({
        time: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5]
      }));

      const { rsi, percentB, closes } = calculateIndicators(candles);

      const macdBuy = calculateMACD(closes, 1, 10, 4);
      const macdSell = calculateMACD(closes, 1, 100, 8);
      const prevBuy = calculateMACD(closes.slice(0, -1), 1, 10, 4);
      const prevSell = calculateMACD(closes.slice(0, -1), 1, 100, 8);

      const inTrade = state[symbol];

      // شراء
      if (!inTrade && rsi < 45 && percentB < 0.2 && prevBuy.macdLine < prevBuy.signalLine && macdBuy.macdLine > macdBuy.signalLine) {
        const price = closes[closes.length - 1];
        state[symbol] = { buyPrice: price, time: Date.now() };
        await sendTelegramMessage(`🟢 *شراء ${symbol}*\nالوقت: ${new Date().toLocaleString()}\nالسعر: *${price.toFixed(4)} USDT*`);
        fs.writeFileSync(stateFile, JSON.stringify(state));
      }

      // بيع
      if (inTrade && prevSell.macdLine > prevSell.signalLine && macdSell.macdLine < macdSell.signalLine) {
        const sellPrice = closes[closes.length - 1];
        const profit = (sellPrice - inTrade.buyPrice) / inTrade.buyPrice;
        await sendTelegramMessage(`🔴 *بيع ${symbol}*\nالوقت: ${new Date().toLocaleString()}\nالسعر: *${sellPrice.toFixed(4)} USDT*\nالربح: *${formatPercent(profit)}*`);
        delete state[symbol];
        fs.writeFileSync(stateFile, JSON.stringify(state));
      }

    } catch (e) {
      console.log(`⚠️ خطأ في تحليل ${symbol}: ${e.message}`);
    }
  }
}

// يعمل كل دقيقتين
cron.schedule(`*/${ANALYSIS_INTERVAL_MINUTES} * * * *`, () => {
  console.log("⏳ بدء التحليل...");
  analyzeMarket();
});

// تحليل عند بداية التشغيل
analyzeMarket();
