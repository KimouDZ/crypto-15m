import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];

const state = {};

function log(msg) {
  const time = new Date().toLocaleString("en-GB", { timeZone: "UTC" });
  console.log(`[${time}] ${msg}`);
}

async function getOHLCV(symbol) {
  const ohlcv = await exchange.fetchOHLCV(symbol, '4h', undefined, 100);
  const close = ohlcv.map(c => c[4]);
  const high = ohlcv.map(c => c[2]);
  const low = ohlcv.map(c => c[3]);
  return { close, high, low, currentPrice: close[close.length - 1] };
}

function calculateIndicators(close, high, low) {
  const rsi = technicalindicators.RSI.calculate({ values: close, period: 14 });
  const bb = technicalindicators.BollingerBands.calculate({ period: 20, values: close, stdDev: 2 });
  const macd = technicalindicators.MACD.calculate({ values: close, fastPeriod: 1, slowPeriod: 2, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });
  return { rsi, bb, macd };
}

function checkBuyConditions(rsi, bb, macd) {
  const i = rsi.length - 1;
  const lastMACD = macd[macd.length - 1];
  return rsi[i] < 40 && bb[bb.length - 1].percentB < 0.4 && lastMACD.MACD > lastMACD.signal;
}

function checkSellConditions(rsi, macd) {
  const i = rsi.length - 1;
  const lastMACD = macd[macd.length - 1];
  return rsi[i] > 55 && lastMACD.MACD < lastMACD.signal;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('fr-FR', { hour12: false }).replace(',', ' -');
}

async function sendTelegramMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML'
  });
}

async function analyzeSymbol(symbol) {
  try {
    const { close, high, low, currentPrice } = await getOHLCV(symbol);
    const { rsi, bb, macd } = calculateIndicators(close, high, low);
    const key = symbol.replace('/', '');

    if (!state[key]) state[key] = { inTrade: false, buyPrice: 0, supports: [], buyTime: null };
    const coin = state[key];

    // شراء أساسي
    if (!coin.inTrade && checkBuyConditions(rsi, bb, macd)) {
      coin.inTrade = true;
      coin.buyPrice = currentPrice;
      coin.supports = [];
      coin.buyTime = new Date();
      log(`🔵 شراء ${symbol} عند ${currentPrice}`);
      await sendTelegramMessage(`🔵 <b>شراء ${symbol}</b>
📈 السعر: <b>${currentPrice}$</b>
⏰ التاريخ: <b>${formatDate(coin.buyTime)}</b>`);
      return;
    }

    // دعم متعدد
    if (coin.inTrade) {
      const lastSupportPrice = coin.supports.length ? coin.supports[coin.supports.length - 1].price : coin.buyPrice;
      const dropPercent = ((lastSupportPrice - currentPrice) / lastSupportPrice) * 100;
      if (dropPercent >= 1.5 && checkBuyConditions(rsi, bb, macd)) {
        coin.supports.push({ price: currentPrice, time: new Date() });
        log(`🟡 تدعيم ${symbol} عند ${currentPrice}`);
        await sendTelegramMessage(`🟡 <b>تدعيم ${symbol}</b>
📉 السعر: <b>${currentPrice}$</b>
⏰ التاريخ: <b>${formatDate(Date.now())}</b>`);
        return;
      }
    }

    // بيع
    if (coin.inTrade && checkSellConditions(rsi, macd)) {
      const totalPrices = [coin.buyPrice, ...coin.supports.map(s => s.price)];
      const avgPrice = totalPrices.reduce((a, b) => a + b, 0) / totalPrices.length;
      const pnl = (((currentPrice - avgPrice) / avgPrice) * 100).toFixed(2);
      let message = `🔴 <b>بيع ${symbol}</b>\n`;
      message += `💵 السعر الحالي: <b>${currentPrice}$</b>\n`;
      message += `📆 شراء: <b>${formatDate(coin.buyTime)}</b> بسعر <b>${coin.buyPrice}$</b>\n`;
      if (coin.supports.length > 0) {
        coin.supports.forEach((s, i) => {
          message += `📍 دعم ${i + 1}: <b>${s.price}$</b> بتاريخ <b>${formatDate(s.time)}</b>\n`;
        });
      }
      message += `📊 متوسط السعر: <b>${avgPrice.toFixed(4)}$</b>\n`;
      message += `📈 الربح/الخسارة: <b>${pnl}%</b>`;
      log(`🔴 بيع ${symbol} عند ${currentPrice} | PnL: ${pnl}%`);
      await sendTelegramMessage(message);
      coin.inTrade = false;
      coin.supports = [];
    }
  } catch (err) {
    log(`خطأ في ${symbol}: ${err.message}`);
  }
}

async function runBot() {
  for (const symbol of SYMBOLS) {
    await analyzeSymbol(symbol);
  }
}

setInterval(runBot, 2 * 60 * 1000); // كل دقيقتين
