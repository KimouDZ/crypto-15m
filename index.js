import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

// إعدادات تيليغرام
const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';

// تحميل قائمة العملات
const coins = JSON.parse(fs.readFileSync('./coins.json'));

// إعدادات المؤشرات
const RSI_PERIOD = 14;
const BB_PERIOD = 20;
const BB_STD_DEV = 2;

const MACD_BUY = { fastPeriod: 1, slowPeriod: 50, signalPeriod: 20 };
const MACD_SELL = { fastPeriod: 2, slowPeriod: 10, signalPeriod: 15 };

const exchange = new ccxt.binance();
const inTrade = {}; // لتجنب التكرار

async function sendTelegramMessage(message) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'HTML',
  });
}

async function analyzeSymbol(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '4h');

    if (!ohlcv || !Array.isArray(ohlcv) || ohlcv.length < 100 || !ohlcv[0]) {
      console.log(`❌ لا توجد بيانات كافية لـ ${symbol}`);
      return;
    }

    const closes = ohlcv.map(c => c[4]);
    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);

    const rsi = technicalindicators.RSI.calculate({ values: closes, period: RSI_PERIOD });
    const bb = technicalindicators.BollingerBands.calculate({
      period: BB_PERIOD,
      stdDev: BB_STD_DEV,
      values: closes,
    });
    const macdBuy = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: MACD_BUY.fastPeriod,
      slowPeriod: MACD_BUY.slowPeriod,
      signalPeriod: MACD_BUY.signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const macdSell = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: MACD_SELL.fastPeriod,
      slowPeriod: MACD_SELL.slowPeriod,
      signalPeriod: MACD_SELL.signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const lastPrice = closes[closes.length - 1];
    const coin = symbol.replace('/USDT', '');

    const rsiValue = rsi[rsi.length - 1];
    const bbValue = bb[bb.length - 1];
    const macdHistBuyPrev = macdBuy[macdBuy.length - 2]?.histogram;
    const macdHistBuy = macdBuy[macdBuy.length - 1]?.histogram;

    const macdHistSellPrev = macdSell[macdSell.length - 2]?.histogram;
    const macdHistSell = macdSell[macdSell.length - 1]?.histogram;

    // إشـارة شراء
    if (
      rsiValue < 25 &&
      bbValue && bbValue.percentB < 0 &&
      macdHistBuyPrev < 0 && macdHistBuy > 0 &&
      !inTrade[symbol]
    ) {
      inTrade[symbol] = {
        buyPrice: lastPrice,
        time: new Date().toLocaleString(),
      };

      await sendTelegramMessage(
        `✅ <b>شراء</b> ${coin}\nالسعر: <b>${lastPrice}</b>\nالوقت: ${inTrade[symbol].time}`
      );
    }

    // إشـارة بيع
    if (
      inTrade[symbol] &&
      rsiValue > 50 &&
      macdHistSellPrev > 0 && macdHistSell < 0
    ) {
      const entry = inTrade[symbol];
      const pnl = (((lastPrice - entry.buyPrice) / entry.buyPrice) * 100).toFixed(2);
      await sendTelegramMessage(
        `🔴 <b>بيع</b> ${coin}\nسعر الشراء: ${entry.buyPrice}\nسعر البيع: <b>${lastPrice}</b>\nالربح/الخسارة: <b>${pnl}%</b>\nالوقت: ${new Date().toLocaleString()}`
      );
      delete inTrade[symbol];
    }

  } catch (err) {
    console.log(`❌ خطأ في ${symbol}: ${err.message}`);
  }
}

async function runBot() {
  for (const symbol of coins) {
    await analyzeSymbol(symbol);
  }
}

// تشغيل البوت كل دقيقتين
cron.schedule('*/2 * * * *', runBot);
