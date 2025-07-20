import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import cron from 'node-cron';
import { RSI, BollingerBands, MACD } from 'technicalindicators';

const TELEGRAM_TOKEN = '8196868477:AAGPMnAc1fFqJvQcJGk8HsC5AYAnRkvu3cM';
const CHAT_ID = '1055739217';

const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('./coins.json'));
let state = fs.existsSync('./state.json') ? JSON.parse(fs.readFileSync('./state.json')) : {};

const saveState = () => fs.writeFileSync('./state.json', JSON.stringify(state, null, 2));

async function sendTelegramMessage(msg) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: msg,
    parse_mode: 'HTML'
  });
}

function calculateIndicators(candles) {
  const closes = candles.map(c => c[4]);
  const highs = candles.map(c => c[2]);
  const lows = candles.map(c => c[3]);

  const rsi = RSI.calculate({ values: closes, period: 14 }).at(-1);
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }).at(-1);
  const percentB = (closes.at(-1) - bb.lower) / (bb.upper - bb.lower);

  const macdBuy = MACD.calculate({
    values: closes,
    fastPeriod: 1,
    slowPeriod: 10,
    signalPeriod: 4,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const macdSell = MACD.calculate({
    values: closes,
    fastPeriod: 1,
    slowPeriod: 100,
    signalPeriod: 8,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const prevMacdBuy = macdBuy.at(-2);
  const lastMacdBuy = macdBuy.at(-1);
  const macdCrossUp = prevMacdBuy.MACD < prevMacdBuy.signal && lastMacdBuy.MACD > lastMacdBuy.signal;

  const prevMacdSell = macdSell.at(-2);
  const lastMacdSell = macdSell.at(-1);
  const macdCrossDown = prevMacdSell.MACD > prevMacdSell.signal && lastMacdSell.MACD < lastMacdSell.signal;

  return { rsi, percentB, macdCrossUp, macdCrossDown };
}

async function analyzeSymbol(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 100);
    const indicators = calculateIndicators(ohlcv);
    const price = ohlcv.at(-1)[4];
    const s = state[symbol] || { inTrade: false };

    if (!s.inTrade) {
      if (indicators.rsi < 45 && indicators.percentB < 0.2 && indicators.macdCrossUp) {
        s.inTrade = true;
        await sendTelegramMessage(`✅ <b>إشارة شراء</b>
العملة: <b>${symbol}</b>
السعر: <b>${price}</b>
الوقت: ${new Date().toLocaleString()}`);
      }
    } else {
      if (indicators.macdCrossDown) {
        s.inTrade = false;
        await sendTelegramMessage(`🔴 <b>إشارة بيع</b>
العملة: <b>${symbol}</b>
السعر: <b>${price}</b>
الوقت: ${new Date().toLocaleString()}`);
      }
    }
    state[symbol] = s;
    saveState();
  } catch (e) {
    console.error(`خطأ في تحليل ${symbol}:`, e.message);
  }
}

cron.schedule('*/2 * * * *', async () => {
  for (const symbol of coins) await analyzeSymbol(symbol);
});
