import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import { RSI, BollingerBands, MACD } from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();

// قراءة العملات من ملف coins.json
const coins = JSON.parse(fs.readFileSync('./coins.json'));

let activeTrades = {};

async function fetchOHLCV(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '4h', undefined, 100);
    return ohlcv.map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
  } catch (e) {
    console.log(`خطأ في جلب بيانات ${symbol}:`, e.message);
    return null;
  }
}

function calculateIndicators(data) {
  const close = data.map(d => d.close);

  const rsi = RSI.calculate({ values: close, period: 14 });
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: close });
  const macdBuy = MACD.calculate({ values: close, fastPeriod: 1, slowPeriod: 2, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdSell = MACD.calculate({ values: close, fastPeriod: 1, slowPeriod: 10, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });

  return { rsi, bb, macdBuy, macdSell };
}

function getLast(values) {
  return values[values.length - 1];
}

async function analyze(symbol) {
  const data = await fetchOHLCV(symbol);
  if (!data) return;

  const { rsi, bb, macdBuy, macdSell } = calculateIndicators(data);
  if (rsi.length < 1 || bb.length < 1 || macdBuy.length < 1 || macdSell.length < 1) return;

  const last = data[data.length - 1];
  const lastRSI = getLast(rsi);
  const lastBB = getLast(bb);
  const lastMACD = getLast(macdBuy);
  const lastMACDSell = getLast(macdSell);

  const percentB = (last.close - lastBB.lower) / (lastBB.upper - lastBB.lower);
  const inPosition = activeTrades[symbol] !== undefined;

  console.log(`تحليل العملة: ${symbol}`);

  if (!inPosition && lastRSI < 40 && percentB < 0.4 && lastMACD.MACD > lastMACD.signal) {
    activeTrades[symbol] = {
      entryPrice: last.close,
      supports: [],
      time: new Date().toLocaleString('ar-EG')
    };
    sendTelegram(`✅ شراء ${symbol}\n💰 السعر: ${last.close}\n📅 التاريخ: ${activeTrades[symbol].time}`);
    console.log(`شراء: تحقق الشروط - ${symbol} بسعر ${last.close}`);
  }

  if (inPosition) {
    const trade = activeTrades[symbol];
    const lastSupport = trade.supports.length > 0 ? trade.supports[trade.supports.length - 1] : { price: trade.entryPrice };
    const supportPrice = lastSupport.price * 0.985;

    if (last.close < supportPrice && lastRSI < 40 && percentB < 0.4 && lastMACD.MACD > lastMACD.signal) {
      trade.supports.push({ price: last.close, time: new Date().toLocaleString('ar-EG') });
      sendTelegram(`📉 تدعيم ${symbol}\n💰 السعر: ${last.close}\n📅 ${trade.supports[trade.supports.length - 1].time}`);
      console.log(`دعم: ${symbol} بسعر ${last.close}`);
    }

    if (lastRSI > 55 && lastMACDSell.MACD < lastMACDSell.signal) {
      const allPrices = [trade.entryPrice, ...trade.supports.map(s => s.price)];
      const avgPrice = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
      const pnl = ((last.close - avgPrice) / avgPrice * 100).toFixed(2);
      const supportsText = trade.supports.map((s, i) => `🔹 دعم ${i + 1}: ${s.price} (${s.time})`).join('\n');
      sendTelegram(`🚨 بيع ${symbol}\n💰 سعر الشراء: ${trade.entryPrice}\n${supportsText}\n💸 سعر البيع: ${last.close}\n📊 الربح/الخسارة: ${pnl}%`);
      console.log(`بيع: ${symbol} بسعر ${last.close} - الربح: ${pnl}%`);
      delete activeTrades[symbol];
    }
  }
}

function sendTelegram(msg) {
  axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    params: {
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: 'HTML'
    }
  });
}

cron.schedule('*/2 * * * *', async () => {
  for (const symbol of coins) {
    await analyze(symbol);
  }
});
