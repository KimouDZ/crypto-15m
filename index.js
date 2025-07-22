import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.015;

const positions = {};
const lastSignalTimes = {}; // لمنع التنبيه المكرر

function percentB(closes, bb) {
  const lastClose = closes[closes.length - 1];
  const lower = bb.lower[bb.lower.length - 1];
  const upper = bb.upper[bb.upper.length - 1];
  return (lastClose - lower) / (upper - lower);
}

async function getohlcv(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
    
    if (!ohlcv || ohlcv.length < 50) {
      console.log(`❌ بيانات غير كافية لـ ${symbol}`);
      return;
    }
    const closes = ohlcv.map(c => c[4]);
    const times = ohlcv.map(c => c[0]);

    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
    const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const macdBuy = technicalindicators.MACD.calculate({ fastPeriod: 1, slowPeriod: 2, signalPeriod: 2, values: closes, SimpleMAOscillator: false, SimpleMASignal: false });
    const macdSell = technicalindicators.MACD.calculate({ fastPeriod: 1, slowPeriod: 10, signalPeriod: 2, values: closes, SimpleMAOscillator: false, SimpleMASignal: false });

    return {
      time: new Date(times[times.length - 1]),
      close: closes[closes.length - 1],
      rsi: rsi[rsi.length - 1],
      percentB: percentB(closes, bb),
      macdBuy: macdBuy[macdBuy.length - 1],
      macdBuyPrev: macdBuy[macdBuy.length - 2],
      macdSell: macdSell[macdSell.length - 1],
      macdSellPrev: macdSell[macdSell.length - 2]
    };
  } catch (err) {
    console.error(`❌ خطأ في جلب البيانات لـ ${symbol}:`, err.message);
    return null;
  }
}

function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  return axios.post(url, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

async function analyze(symbol) {
  const data = await getohlcv(symbol);
  if (!data) return;

  const { time, close: price, rsi, percentB, macdBuy, macdBuyPrev, macdSell, macdSellPrev } = data;
  const id = symbol.replace('/', '');
  const position = positions[id];

  const buySignal = rsi < 40 && percentB < 0.4 && macdBuy.MACD > macdBuy.signal && macdBuyPrev.MACD < macdBuyPrev.signal;
  const sellSignal = rsi > 55 && macdSell.MACD < macdSell.signal && macdSellPrev.MACD > macdSellPrev.signal;

  const nowTime = time.toISOString();

  if (!position && buySignal) {
    const lastTime = lastSignalTimes[id]?.buy;
    if (lastTime === nowTime) return;
    lastSignalTimes[id] = { ...(lastSignalTimes[id] || {}), buy: nowTime };

    positions[id] = { buyPrice: price, buyTime: time, supports: [] };
    const message = `🔵 *إشارة شراء*\nالعملة: *${symbol}*\nالسعر: *${price.toFixed(4)}*\nالوقت: *${formatDate(time)}*`;
    await sendTelegramMessage(message);
  } else if (position && price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) && buySignal) {
    const lastSupportTime = lastSignalTimes[id]?.support;
    if (lastSupportTime === nowTime) return;
    lastSignalTimes[id] = { ...(lastSignalTimes[id] || {}), support: nowTime };

    position.supports.push({ price, time });
    const message = `🟠 *دعم رقم ${position.supports.length}*\n${symbol}\nالسعر: *${price.toFixed(4)}*\nالوقت: *${formatDate(time)}*`;
    await sendTelegramMessage(message);
  } else if (position && sellSignal) {
    const lastTime = lastSignalTimes[id]?.sell;
    if (lastTime === nowTime) return;
    lastSignalTimes[id] = { ...(lastSignalTimes[id] || {}), sell: nowTime };

    const allPrices = [position.buyPrice, ...position.supports.map(s => s.price)];
    const avgPrice = allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;
    const profit = ((price - avgPrice) / avgPrice) * 100;

    let message = `🔴 *إشارة بيع*\n${symbol}\n`;
    message += `*السعر الأساسي:* ${position.buyPrice.toFixed(4)} | *${formatDate(position.buyTime)}*\n`;
    position.supports.forEach((s, i) => {
      message += `*دعم ${i + 1}:* ${s.price.toFixed(4)} | *${formatDate(s.time)}*\n`;
    });
    message += `*سعر البيع:* ${price.toFixed(4)} | *${formatDate(time)}*\n`;
    message += `*النتيجة:* ${profit.toFixed(2)}%`;

    await sendTelegramMessage(message);
    delete positions[id];
  }
}

function formatDate(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} - ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  const coins = JSON.parse(fs.readFileSync('./coins.json'));
  for (const symbol of coins) {
    await analyze(symbol);
  }
}

main();
setInterval(main, 2 * 60 * 1000); // كل دقيقتين
