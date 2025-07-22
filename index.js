import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.015;

const positions = {};
const lastSignalTimes = {};

function calculatePercentB(closes, bb) {
  const lastClose = closes[closes.length - 1];
  const lower = bb.lower[bb.lower.length - 1];
  const upper = bb.upper[bb.upper.length - 1];
  return (lastClose - lower) / (upper - lower);
}

async function getOhlcv(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
    if (!ohlcv || ohlcv.length < 50) return null;

    const closes = ohlcv.map(c => c[4]);
    const times = ohlcv.map(c => c[0]);

    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
    const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const macdBuy = technicalindicators.MACD.calculate({ fastPeriod: 1, slowPeriod: 2, signalPeriod: 2, values: closes });
    const macdSell = technicalindicators.MACD.calculate({ fastPeriod: 1, slowPeriod: 10, signalPeriod: 2, values: closes });

    return {
      time: new Date(times[times.length - 1]),
      close: closes[closes.length - 1],
      rsi: rsi[rsi.length - 1],
      percentB: calculatePercentB(closes, bb),
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
  return axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

function formatDate(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} - ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function analyze(symbol) {
  const data = await getOhlcv(symbol);
  if (!data) return;

  const { time, close: price, rsi, percentB, macdBuy, macdBuyPrev, macdSell, macdSellPrev } = data;
  const id = symbol.replace('/', '');
  const position = positions[id];
  const nowTime = time.toISOString();

  const buySignal = rsi < 40 && percentB < 0.4 && macdBuyPrev.MACD < macdBuyPrev.signal && macdBuy.MACD > macdBuy.signal;
  const sellSignal = rsi > 55 && macdSellPrev.MACD > macdSellPrev.signal && macdSell.MACD < macdSell.signal;

  if (!position && buySignal) {
    if (lastSignalTimes[id]?.buy === nowTime) return;
    lastSignalTimes[id] = { ...(lastSignalTimes[id] || {}), buy: nowTime };

    positions[id] = { buyPrice: price, buyTime: time, supports: [] };

    const message = `🟢 *إشارة شراء جديدة*\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price.toFixed(4)}\n📅 الوقت: ${formatDate(time)}`;
    await sendTelegramMessage(message);
  }

  else if (position && price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) && buySignal) {
    if (lastSignalTimes[id]?.support === nowTime) return;
    lastSignalTimes[id] = { ...(lastSignalTimes[id] || {}), support: nowTime };

    position.supports.push({ price, time });

    const message = `🟠 *تدعيم للشراء*\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price.toFixed(4)}\n📅 الوقت: ${formatDate(time)}`;
    await sendTelegramMessage(message);
  }

  else if (position && sellSignal) {
    if (lastSignalTimes[id]?.sell === nowTime) return;
    lastSignalTimes[id] = { ...(lastSignalTimes[id] || {}), sell: nowTime };

    const avgBuy = [position.buyPrice, ...position.supports.map(s => s.price)].reduce((a, b) => a + b) / (1 + position.supports.length);
    const change = ((price - avgBuy) / avgBuy * 100).toFixed(2);

    let message = `🔴 *إشارة بيع*\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء الأساسي: ${position.buyPrice.toFixed(4)}\n📅 وقت الشراء: ${formatDate(position.buyTime)}\n\n`;

    position.supports.forEach((s, i) => {
      message += `🟠 سعر التدعيم ${i + 1}: ${s.price.toFixed(4)}\n📅 وقت التدعيم ${i + 1}: ${formatDate(s.time)}\n\n`;
    });

    message += `💸 سعر البيع: ${price.toFixed(4)}\n📅 وقت البيع: ${formatDate(time)}\n\n📊 الربح/الخسارة: ${change > 0 ? '+' : ''}${change}%`;

    await sendTelegramMessage(message);
    delete positions[id];
  }
}

async function main() {
  try {
    console.log("📊 جاري التحليل...");
    const coins = JSON.parse(fs.readFileSync('./coins.json'));
    for (const symbol of coins) {
      await analyze(symbol);
    }
  } catch (err) {
    console.error("❌ خطأ في main:", err.message);
  }
}

main();
setInterval(main, 2 * 60 * 1000); // كل دقيقتين
