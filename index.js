import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import cron from 'node-cron';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance({ enableRateLimit: true });

const coins = JSON.parse(fs.readFileSync('./coins.json'));
const state = {};

const RSI_PERIOD = 14;
const BB_PERIOD = 20;
const BB_MULT = 2;
const MACD_BUY = { fast: 1, slow: 5, signal: 30 };
const MACD_SELL = { fast: 2, slow: 10, signal: 15 };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  }).catch(console.error);
}

function formatDate(date) {
  return new Date(date).toLocaleString('fr-DZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).replace(',', ' -');
}

async function analyzeCoin(symbol) {
  try {
    const market = symbol.replace('/', '');
    const ohlcv = await exchange.fetchOHLCV(symbol, '15m');

    if (!ohlcv || ohlcv.length < 100) return;

    const closes = ohlcv.map(c => c[4]);
    const rsi = technicalindicators.rsi({ period: RSI_PERIOD, values: closes });
    const bb = technicalindicators.bollingerbands({ period: BB_PERIOD, values: closes, stdDev: BB_MULT });
    const macdBuy = technicalindicators.macd({
      values: closes,
      fastPeriod: MACD_BUY.fast,
      slowPeriod: MACD_BUY.slow,
      signalPeriod: MACD_BUY.signal,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const macdSell = technicalindicators.macd({
      values: closes,
      fastPeriod: MACD_SELL.fast,
      slowPeriod: MACD_SELL.slow,
      signalPeriod: MACD_SELL.signal,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const lastClose = closes.at(-1);
    const lastRSI = rsi.at(-1);
    const lastBB = bb.at(-1);
    const lastMACD_Buy = macdBuy.at(-1);
    const prevMACD_Buy = macdBuy.at(-2);
    const lastMACD_Sell = macdSell.at(-1);
    const prevMACD_Sell = macdSell.at(-2);

    if (!lastBB || !lastMACD_Buy || !prevMACD_Buy || !lastMACD_Sell || !prevMACD_Sell) return;

    const percentB = (lastClose - lastBB.lower) / (lastBB.upper - lastBB.lower);
    const dateNow = formatDate(ohlcv.at(-1)[0]);

    if (!state[symbol]) state[symbol] = { inTrade: false, supports: [] };

    const info = state[symbol];

    // ✅ إشــارة شــراء
    if (!info.inTrade &&
        lastRSI < 25 &&
        percentB < 0 &&
        prevMACD_Buy.MACD < prevMACD_Buy.signal &&
        lastMACD_Buy.MACD > lastMACD_Buy.signal
    ) {
      info.inTrade = true;
      info.buyPrice = lastClose;
      info.buyTime = dateNow;
      info.supports = [];

      await sendMessage(`🔵 *إشارة شراء*\n\nالعملة: *${symbol}*\nالسعر: *${lastClose.toFixed(4)}*\nالوقت: ${dateNow}`);
      return;
    }

    // 🟠 إشـارة تدعيم
    if (info.inTrade &&
        lastClose < info.buyPrice * 0.95 &&
        lastRSI < 25 &&
        percentB < 0 &&
        prevMACD_Buy.MACD < prevMACD_Buy.signal &&
        lastMACD_Buy.MACD > lastMACD_Buy.signal
    ) {
      info.supports.push({ price: lastClose, time: dateNow });
      info.buyPrice = lastClose; // تحديث آخر نقطة دعم
      await sendMessage(`🟠 *إشارة تدعيم*\n\nالعملة: *${symbol}*\nرقم التدعيم: ${info.supports.length}\nالسعر: *${lastClose.toFixed(4)}*\nالوقت: ${dateNow}`);
      return;
    }

    // 🔴 إشارة بيع
    if (info.inTrade &&
        lastRSI > 50 &&
        prevMACD_Sell.MACD > prevMACD_Sell.signal &&
        lastMACD_Sell.MACD < lastMACD_Sell.signal
    ) {
      const allPrices = [info.buyPrice, ...info.supports.map(s => s.price)];
      const avgPrice = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
      const profit = ((lastClose - avgPrice) / avgPrice) * 100;

      let msg = `🔴 *إشارة بيع*\n\nالعملة: *${symbol}*\n`;
      msg += `السعر المتوسط: *${avgPrice.toFixed(4)}*\n`;
      msg += `سعر البيع: *${lastClose.toFixed(4)}*\n`;
      msg += `الربح/الخسارة: *${profit.toFixed(2)}%*\n`;
      msg += `الوقت: ${dateNow}\n`;

      if (info.supports.length > 0) {
        msg += `\n📌 *تفاصيل التدعيمات:*`;
        info.supports.forEach((s, i) => {
          msg += `\n- تدعيم ${i + 1}: *${s.price.toFixed(4)}* في ${s.time}`;
        });
      }

      await sendMessage(msg);
      state[symbol] = null;
    }
  } catch (err) {
    console.error(`❌ خطأ في جلب البيانات لـ ${symbol}: ${err.message}`);
  }
}

async function run() {
  for (const symbol of coins) {
    await analyzeCoin(symbol);
    await sleep(1200); // لتجنب الحظر من Binance
  }
}

// كل دقيقتين
cron.schedule('*/2 * * * *', run);
