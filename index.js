import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';

const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('./coins.json'));

let state = {};
const stateFile = './state.json';

// تحميل الحالة السابقة من الملف (لمنع التكرار)
if (fs.existsSync(stateFile)) {
  state = JSON.parse(fs.readFileSync(stateFile));
}

function saveState() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function sendTelegramMessage(message) {
  axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
  }).catch(err => console.error("Telegram Error:", err.message));
}

async function analyzeCoin(symbol) {
  try {
    const market = await exchange.loadMarkets();
    if (!market[symbol]) {
      console.log(`❌ العملة غير موجودة في Binance: ${symbol}`);
      return;
    }

    const ohlcv = await exchange.fetchOHLCV(symbol, '4h');
    if (!ohlcv || ohlcv.length < 100) {
      console.log(`❌ بيانات غير كافية لـ ${symbol}`);
      return;
    }

    const closes = ohlcv.map(c => c[4]);

    if (closes.length < 100) {
      console.log(`❌ بيانات غير كافية لحساب المؤشرات لـ ${symbol}`);
      return;
    }

    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
    const bb = technicalindicators.BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes,
    });

    const macdBuy = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 5,
      signalPeriod: 30,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const macdSell = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 2,
      slowPeriod: 10,
      signalPeriod: 15,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    if (
      rsi.length === 0 ||
      bb.length === 0 ||
      macdBuy.length < 2 ||
      macdSell.length < 2
    ) {
      console.log(`❌ المؤشرات غير مكتملة لـ ${symbol}`);
      return;
    }

    const lastRSI = rsi[rsi.length - 1];
    const lastBB = bb[bb.length - 1];
    const price = closes[closes.length - 1];

    const prevMACD = macdBuy[macdBuy.length - 2];
    const lastMACD = macdBuy[macdBuy.length - 1];

    const prevMACDSell = macdSell[macdSell.length - 2];
    const lastMACDSell = macdSell[macdSell.length - 1];

    const inTrade = state[symbol]?.inTrade || false;
    const entryPrice = state[symbol]?.entryPrice || 0;

    // ✅ شروط الشراء
    const buySignal =
      !inTrade &&
      lastRSI < 25 &&
      lastBB.percentB < 0 &&
      prevMACD.MACD < prevMACD.signal &&
      lastMACD.MACD > lastMACD.signal;

    // ✅ شروط البيع
    const sellSignal =
      inTrade &&
      lastRSI > 50 &&
      prevMACDSell.MACD > prevMACDSell.signal &&
      lastMACDSell.MACD < lastMACDSell.signal;

    if (buySignal) {
      state[symbol] = { inTrade: true, entryPrice: price };
      saveState();
      const msg = `📈 *إشارة شراء*\nالعملة: *${symbol}*\nالسعر: *${price.toFixed(4)}*\nالوقت: ${new Date().toLocaleString()}`;
      sendTelegramMessage(msg);
    }

    if (sellSignal) {
      const profit = ((price - entryPrice) / entryPrice) * 100;
      state[symbol] = { inTrade: false, entryPrice: 0 };
      saveState();
      const msg = `📉 *إشارة بيع*\nالعملة: *${symbol}*\nالشراء: *${entryPrice.toFixed(4)}*\nالبيع: *${price.toFixed(4)}*\nالربح/الخسارة: *${profit.toFixed(2)}%*\n🕒 ${new Date().toLocaleString()}`;
      sendTelegramMessage(msg);
    }

  } catch (err) {
    console.log(`❌ خطأ في ${symbol}: ${err.message}`);
  }
}

async function runBot() {
  for (const symbol of coins) {
    await analyzeCoin(symbol);
  }
}

cron.schedule('*/2 * * * *', runBot); // كل دقيقتين
