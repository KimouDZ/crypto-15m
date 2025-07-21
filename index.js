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

const loadState = () => {
  if (fs.existsSync('./state.json')) {
    state = JSON.parse(fs.readFileSync('./state.json'));
  }
};

const saveState = () => {
  fs.writeFileSync('./state.json', JSON.stringify(state, null, 2));
};

const sendTelegramMessage = async (message) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('❌ فشل إرسال الرسالة:', err.message);
  }
};

const analyzeSymbol = async (symbol) => {
  try {
    const market = await exchange.loadMarkets();
    if (!market[symbol]) {
      console.warn(`⚠️ الزوج غير موجود على Binance: ${symbol}`);
      return;
    }

    const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 200);
    const closes = ohlcv.map(c => c[4]);

    // RSI
    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
    const lastRSI = rsi[rsi.length - 1];

    // Bollinger Bands
    const bb = technicalindicators.BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes
    });
    const lastBB = bb[bb.length - 1];
    const percentB = (closes[closes.length - 1] - lastBB.lower) / (lastBB.upper - lastBB.lower);

    // MACD Buy
    const macdBuy = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 2,
      signalPeriod: 2,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const macdSell = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 10,
      signalPeriod: 2,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const lastMACD_Buy = macdBuy[macdBuy.length - 1];
    const prevMACD_Buy = macdBuy[macdBuy.length - 2];
    const lastMACD_Sell = macdSell[macdSell.length - 1];
    const prevMACD_Sell = macdSell[macdSell.length - 2];

    const buySignal = (
      lastRSI < 45 &&
      percentB < 0.4 &&
      prevMACD_Buy.MACD < prevMACD_Buy.signal &&
      lastMACD_Buy.MACD > lastMACD_Buy.signal
    );

    const sellSignal = (
      state[symbol]?.hasPosition &&
      prevMACD_Sell.MACD > prevMACD_Sell.signal &&
      lastMACD_Sell.MACD < lastMACD_Sell.signal
    );

    const now = new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' });

    if (buySignal && !state[symbol]?.hasPosition) {
      const price = closes[closes.length - 1];
      state[symbol] = {
        hasPosition: true,
        entryPrice: price,
        entryTime: now
      };
      await sendTelegramMessage(`🟢 <b>إشارة شراء</b>\n\n🪙 العملة: <b>${symbol}</b>\n💰 السعر: <b>${price.toFixed(4)}</b>\n🕒 الوقت: <b>${now}</b>\n\n🔔 سيتم الانتظار لإشارة بيع...`);
    }

    if (sellSignal) {
      const price = closes[closes.length - 1];
      const entry = state[symbol];
      const profitPercent = ((price - entry.entryPrice) / entry.entryPrice) * 100;

      await sendTelegramMessage(`🔴 <b>إشارة بيع</b>\n\n🪙 العملة: <b>${symbol}</b>\n💰 سعر الشراء: <b>${entry.entryPrice.toFixed(4)}</b>\n🕒 وقت الشراء: <b>${entry.entryTime}</b>\n💸 سعر البيع: <b>${price.toFixed(4)}</b>\n📊 الربح/الخسارة: <b>${profitPercent.toFixed(2)}%</b>\n🕒 وقت البيع: <b>${now}</b>`);

      state[symbol] = {
        hasPosition: false
      };
    }
  } catch (err) {
    console.error(`⚠️ خطأ في تحليل ${symbol}: ${err.message}`);
  }
};

const runBot = async () => {
  console.log('✅ بدء التحليل...');
  for (const symbol of coins) {
    await analyzeSymbol(symbol);
  }
  saveState();
};

loadState();

// تشغيل كل دقيقتين
cron.schedule('*/2 * * * *', runBot);
