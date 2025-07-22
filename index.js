import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';

const exchange = new ccxt.binance({ enableRateLimit: true });
const coins = JSON.parse(fs.readFileSync('coins.json'));

let positions = {}; // { SYMBOL: { entries: [{price, time}], state: 'buy'|'sell' } }

function formatDate(date) {
  return new Date(date).toLocaleString('ar-EG', {
    hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).replace(',', '');
}

async function fetchOHLCV(symbol) {
  try {
    const data = await exchange.fetchOHLCV(symbol, '15m', undefined, 100);
    return data.map(c => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));
  } catch (err) {
    console.error(`❌ خطأ في جلب البيانات لـ ${symbol}:`, err.message);
    return null;
  }
}

function calculateIndicators(data) {
  const closes = data.map(c => c.close);

  const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
  const bb = technicalindicators.BollingerBands.calculate({
    period: 20,
    stdDev: 2,
    values: closes
  });
  const macdBuy = technicalindicators.MACD.calculate({
    fastPeriod: 1,
    slowPeriod: 2,
    signalPeriod: 2,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
    values: closes
  });
  const macdSell = technicalindicators.MACD.calculate({
    fastPeriod: 1,
    slowPeriod: 10,
    signalPeriod: 2,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
    values: closes
  });

  return { rsi, bb, macdBuy, macdSell };
}

function shouldBuy({ rsi, bb, macdBuy }, i) {
  return (
    rsi[i] < 40 &&
    bb[i]?.pb < 0.4 &&
    macdBuy[i - 1]?.MACD < macdBuy[i - 1]?.signal &&
    macdBuy[i]?.MACD > macdBuy[i]?.signal
  );
}

function shouldSell({ rsi, macdSell }, i) {
  return (
    rsi[i] > 55 &&
    macdSell[i - 1]?.MACD > macdSell[i - 1]?.signal &&
    macdSell[i]?.MACD < macdSell[i]?.signal
  );
}

async function sendMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'Markdown'
  });
}

async function analyze(symbol) {
  const data = await fetchOHLCV(symbol);
  if (!data || data.length < 50) return;

  const indicators = calculateIndicators(data);
  const i = indicators.rsi.length - 1;
  const price = data[data.length - 1].close;
  const now = formatDate(data[data.length - 1].time);

  const state = positions[symbol];

  if (!state && shouldBuy(indicators, i)) {
    positions[symbol] = { entries: [{ price, time: now }], state: 'buy' };
    await sendMessage(`🟢 *إشارة شراء*\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n🕒 الوقت: ${now}`);
    return;
  }

  if (state?.state === 'buy') {
    const lastEntry = state.entries[state.entries.length - 1];
    const drop = ((lastEntry.price - price) / lastEntry.price) * 100;

    if (drop >= 1.5 && shouldBuy(indicators, i)) {
      state.entries.push({ price, time: now });
      await sendMessage(`🟠 *تدعيم صفقة*\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n🕒 الوقت: ${now}`);
      return;
    }

    if (shouldSell(indicators, i)) {
      const buyPrices = state.entries.map(e => e.price);
      const avgPrice = buyPrices.reduce((a, b) => a + b, 0) / buyPrices.length;
      const pnl = ((price - avgPrice) / avgPrice * 100).toFixed(2);
      const entryText = state.entries.map((e, idx) => `📍 دعم ${idx + 1}: ${e.time}`).join('\n');

      await sendMessage(`🔴 *إشارة بيع*\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء: ${avgPrice.toFixed(4)}\n${entryText}\n💸 سعر البيع: ${price}\n📊 الربح/الخسارة: ${pnl}%\n🕒 وقت البيع: ${now}`);
      delete positions[symbol];
    }
  }
}

cron.schedule('*/2 * * * *', async () => {
  console.log(`✅ التحليل جارٍ (${new Date().toLocaleTimeString('ar-EG')})...`);
  for (const symbol of coins) {
    await analyze(symbol);
  }
});
