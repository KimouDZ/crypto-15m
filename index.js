import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('./coins.json'));
const stateFile = './state.json';

// تحميل الحالة السابقة
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

const sendTelegramMessage = async (message) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('فشل إرسال رسالة تيليغرام:', err.message);
  }
};

const getIndicators = async (symbol) => {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '4h', undefined, 200);
    if (!ohlcv || ohlcv.length < 100) {
      throw new Error('بيانات غير كافية');
    }

    const closes = ohlcv.map(c => c[4]);
    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);

    const rsi = technicalindicators.RSI.calculate({ values: closes, period: 14 });
    const bb = technicalindicators.BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes
    });

    const macdBuy = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 50,
      signalPeriod: 20,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const macdSell = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 100,
      signalPeriod: 8,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    return {
      rsi: rsi[rsi.length - 1],
      percentB: bb.length > 0 ? (closes[closes.length - 1] - bb[bb.length - 1].lower) / (bb[bb.length - 1].upper - bb[bb.length - 1].lower) : null,
      macdBuyNow: macdBuy[macdBuy.length - 1],
      macdBuyPrev: macdBuy[macdBuy.length - 2],
      macdSellNow: macdSell[macdSell.length - 1],
      price: closes[closes.length - 1]
    };
  } catch (err) {
    console.log(`❌ خطأ في ${symbol}: ${err.message}`);
    return null;
  }
};

const runBot = async () => {
  for (const symbol of coins) {
    const id = symbol.replace('/', '_');
    const data = await getIndicators(symbol);
    if (!data) continue;

    const { rsi, percentB, macdBuyNow, macdBuyPrev, macdSellNow, price } = data;
    const now = new Date().toLocaleString('ar-EG');

    if (!state[id]) state[id] = { inTrade: false, entryPrice: 0, entryTime: '' };

    // 📈 شرط الشراء
    if (!state[id].inTrade &&
        rsi < 25 &&
        percentB < 0 &&
        macdBuyPrev.MACD < macdBuyPrev.signal &&
        macdBuyNow.MACD > macdBuyNow.signal) {
      state[id] = { inTrade: true, entryPrice: price, entryTime: now };
      await sendTelegramMessage(`✅ *إشارة شراء لـ ${symbol}*\nالوقت: ${now}\nالسعر: ${price.toFixed(4)}`);
    }

    // 📉 شرط البيع
    if (state[id].inTrade &&
        rsi > 50 &&
        macdSellNow.MACD < macdSellNow.signal) {
      const entryPrice = state[id].entryPrice;
      const pnl = ((price - entryPrice) / entryPrice * 100).toFixed(2);
      await sendTelegramMessage(`🔻 *إشارة بيع لـ ${symbol}*\nالوقت: ${now}\nسعر الشراء: ${entryPrice.toFixed(4)}\nسعر البيع: ${price.toFixed(4)}\n📊 الربح/الخسارة: ${pnl}%`);
      state[id] = { inTrade: false, entryPrice: 0, entryTime: '' };
    }
  }

  // حفظ الحالة
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
};

// ⏱️ تنفيذ كل دقيقتين
cron.schedule('*/2 * * * *', runBot);
