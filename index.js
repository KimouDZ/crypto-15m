// index.js
import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import cron from 'node-cron';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('./coins.json'));
const stateFile = './state.json';
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

function log(message) {
  const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'UTC' });
  console.log(`[${timestamp}] ${message}`);
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const d = date.getUTCDate().toString().padStart(2, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const y = date.getUTCFullYear();
  const h = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  return `${d}/${m}/${y} - ${h}:${min}`;
}

async function sendTelegramMessage(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
  } catch (error) {
    log(`🔴 خطأ في إرسال رسالة تيليغرام: ${error.message}`);
  }
}

function calculateMACD(data, fast, slow, signal) {
  return technicalindicators.MACD.calculate({
    values: data,
    fastPeriod: fast,
    slowPeriod: slow,
    signalPeriod: signal,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
}

async function analyzeSymbol(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '4h');
    const closes = ohlcv.map(c => c[4]);
    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);

    if (closes.length < 50) return;

    const lastPrice = closes.at(-1);
    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
    const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const macdBuy = calculateMACD(closes, 1, 5, 30);
    const macdSell = calculateMACD(closes, 2, 10, 15);

    const prevMACD = macdBuy.at(-2);
    const currMACD = macdBuy.at(-1);

    const prevSellMACD = macdSell.at(-2);
    const currSellMACD = macdSell.at(-1);

    const bbLast = bb.at(-1);
    const percentB = (closes.at(-1) - bbLast.lower) / (bbLast.upper - bbLast.lower);

    const rsiVal = rsi.at(-1);

    if (!state[symbol]) {
      state[symbol] = { inTrade: false, entries: [] };
    }

    if (!state[symbol].inTrade) {
      const macdCrossUp = prevMACD && currMACD && prevMACD.MACD < prevMACD.signal && currMACD.MACD > currMACD.signal;
      if (rsiVal < 25 && percentB < 0 && macdCrossUp) {
        state[symbol].inTrade = true;
        state[symbol].entries.push({ price: lastPrice, time: new Date().toISOString() });
        sendTelegramMessage(`✅ <b>إشارة شراء (${symbol})</b>\nالسعر: ${lastPrice}\nالوقت: ${formatDate(new Date())}`);
      }
    } else {
      const lastEntry = state[symbol].entries.at(-1);
      const lastEntryPrice = lastEntry.price;
      const priceDrop = (lastPrice < lastEntryPrice * 0.99);
      const macdCrossUp = prevMACD && currMACD && prevMACD.MACD < prevMACD.signal && currMACD.MACD > currMACD.signal;

      if (priceDrop && rsiVal < 25 && percentB < 0 && macdCrossUp) {
        state[symbol].entries.push({ price: lastPrice, time: new Date().toISOString() });
        sendTelegramMessage(`📉 <b>دعم إضافي (${symbol})</b>\nالسعر: ${lastPrice}\nالوقت: ${formatDate(new Date())}`);
      }

      const sellCross = prevSellMACD && currSellMACD && prevSellMACD.MACD > prevSellMACD.signal && currSellMACD.MACD < currSellMACD.signal;
      if (rsiVal > 50 && sellCross) {
        const avgPrice = state[symbol].entries.reduce((sum, e) => sum + e.price, 0) / state[symbol].entries.length;
        const profit = ((lastPrice - avgPrice) / avgPrice * 100).toFixed(2);
        const entryDetails = state[symbol].entries.map((e, i) => `دعم ${i + 1}: ${formatDate(e.time)}`).join('\n');

        sendTelegramMessage(`🚨 <b>إشارة بيع (${symbol})</b>\nالسعر: ${lastPrice}\n${entryDetails}\n⏳ عدد الدعمات: ${state[symbol].entries.length}\n📊 متوسط السعر: ${avgPrice.toFixed(4)}\n💰 نسبة الربح/الخسارة: ${profit}%`);
        state[symbol] = { inTrade: false, entries: [] };
      }
    }
  } catch (e) {
    log(`❌ خطأ في ${symbol}: ${e.message}`);
  }
}

async function runBot() {
  for (const symbol of coins) {
    await analyzeSymbol(symbol);
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

cron.schedule('*/2 * * * *', runBot);
log('✅ البوت يعمل كل دقيقتين.');
