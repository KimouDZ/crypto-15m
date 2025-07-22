import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import { RSI, MACD, BollingerBands } from 'technicalindicators';

// إعدادات تيليغرام
const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();

// تحميل العملات من ملف coins.json
const coins = JSON.parse(fs.readFileSync('./coins.json'));
const stateFile = './state.json';
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

function calculateIndicators(closes) {
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  return { rsi, bb };
}

function calculateMACD(closes, fast, slow, signal) {
  return MACD.calculate({
    values: closes,
    fastPeriod: fast,
    slowPeriod: slow,
    signalPeriod: signal,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
}

async function runBot() {
  for (const symbol of coins) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, '4h');

      if (!ohlcv || ohlcv.length < 100) {
        console.log(`❌ لا توجد بيانات كافية لـ ${symbol}`);
        continue;
      }

      const closes = ohlcv.map(c => c[4]);
      const lastClose = closes[closes.length - 1];
      const timestamp = new Date(ohlcv[ohlcv.length - 1][0]).toLocaleString('ar-DZ');

      const { rsi, bb } = calculateIndicators(closes);
      const macdBuy = calculateMACD(closes, 1, 5, 30);
      const macdSell = calculateMACD(closes, 2, 10, 15);

      const lastRSI = rsi[rsi.length - 1];
      const lastBB = bb[bb.length - 1];
      const lastMACD = macdBuy[macdBuy.length - 1];
      const prevMACD = macdBuy[macdBuy.length - 2];

      const lastMACD_sell = macdSell[macdSell.length - 1];
      const prevMACD_sell = macdSell[macdSell.length - 2];

      const coin = symbol.replace('/USDT', '');

      // شروط الشراء
      if (
        lastRSI < 25 &&
        lastBB &&
        (lastClose < lastBB.lower) &&
        prevMACD.MACD < prevMACD.signal &&
        lastMACD.MACD > lastMACD.signal &&
        !state[coin]
      ) {
        const msg = `🟢 *إشارة شراء*\nالعملة: *${symbol}*\nالسعر: *${lastClose}*\nالوقت: *${timestamp}*`;
        await sendTelegramMessage(msg);
        state[coin] = { boughtAt: lastClose, time: timestamp };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
        console.log(`✅ تم إرسال تنبيه شراء لـ ${symbol}`);
      }

      // شروط البيع
      else if (
        state[coin] &&
        lastRSI > 50 &&
        prevMACD_sell.MACD > prevMACD_sell.signal &&
        lastMACD_sell.MACD < lastMACD_sell.signal
      ) {
        const buyPrice = state[coin].boughtAt;
        const profit = (((lastClose - buyPrice) / buyPrice) * 100).toFixed(2);
        const msg = `🔴 *إشارة بيع*\nالعملة: *${symbol}*\nالشراء: *${buyPrice}*\nالبيع: *${lastClose}*\nالربح/الخسارة: *${profit}%*\nالوقت: *${timestamp}*`;
        await sendTelegramMessage(msg);
        delete state[coin];
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
        console.log(`🚨 تم إرسال تنبيه بيع لـ ${symbol}`);
      }

    } catch (error) {
      console.log(`❌ خطأ في ${symbol}: ${error.message}`);
    }
  }
}

// تشغيل البوت كل دقيقتين
cron.schedule('*/2 * * * *', runBot);
