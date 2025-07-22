// index.js
import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import { RSI, MACD, BollingerBands } from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const coins = JSON.parse(fs.readFileSync('./coins.json'));
const stateFile = './bot_state.json';

let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

async function sendTelegramMessage(message) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString('fr-FR').replace(',', ' -');
}

function calculateIndicators(closes) {
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const macdBuy = MACD.calculate({ values: closes, fastPeriod: 1, slowPeriod: 5, signalPeriod: 30, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdSell = MACD.calculate({ values: closes, fastPeriod: 2, slowPeriod: 10, signalPeriod: 15, SimpleMAOscillator: false, SimpleMASignal: false });
  return { rsi, bb, macdBuy, macdSell };
}

async function runBot() {
  const exchange = new ccxt.binance();
  for (const symbol of coins) {
    try {
      const market = symbol.replace('/', '');
      const ohlcv = await exchange.fetchOHLCV(symbol, '4h');
      if (!ohlcv || ohlcv.length < 50) throw new Error('بيانات غير كافية');
      const closes = ohlcv.map(c => c[4]);
      const { rsi, bb, macdBuy, macdSell } = calculateIndicators(closes);
      const lastClose = closes[closes.length - 1];
      const rsiLast = rsi.at(-1);
      const bbLast = bb.at(-1);
      const macdPrev = macdBuy.at(-2);
      const macdCurr = macdBuy.at(-1);
      const time = formatDate(ohlcv.at(-1)[0]);

      state[symbol] ||= { inTrade: false, buys: [] };

      if (!state[symbol].inTrade) {
        if (rsiLast < 25 && bbLast && bbLast.percentB < 0 && macdPrev.MACD < macdPrev.signal && macdCurr.MACD > macdCurr.signal) {
          const buy = { price: lastClose, time };
          state[symbol].inTrade = true;
          state[symbol].buys = [buy];
          await sendTelegramMessage(`✅ <b>شراء ${symbol}</b>\n📉 <b>السعر</b>: ${lastClose}\n🕒 <b>الوقت</b>: ${time}`);
        }
      } else {
        if (rsiLast < 25 && bbLast && bbLast.percentB < 0 && macdPrev.MACD < macdPrev.signal && macdCurr.MACD > macdCurr.signal) {
          const buy = { price: lastClose, time };
          state[symbol].buys.push(buy);
          await sendTelegramMessage(`🟡 <b>تدعيم ${symbol}</b>\n📉 <b>السعر</b>: ${lastClose}\n🕒 <b>الوقت</b>: ${time}`);
        }

        const macdSellPrev = macdSell.at(-2);
        const macdSellCurr = macdSell.at(-1);
        if (rsiLast > 50 && macdSellPrev.MACD > macdSellPrev.signal && macdSellCurr.MACD < macdSellCurr.signal) {
          const avgBuyPrice = state[symbol].buys.reduce((sum, b) => sum + b.price, 0) / state[symbol].buys.length;
          const profit = ((lastClose - avgBuyPrice) / avgBuyPrice * 100).toFixed(2);
          const buyDetails = state[symbol].buys.map((b, i) => `🟢 <b>${i === 0 ? 'شراء أساسي' : 'تدعيم'}:</b> ${b.price} 🕒 ${b.time}`).join('\n');

          await sendTelegramMessage(`🚨 <b>بيع ${symbol}</b>\n${buyDetails}\n🔴 <b>سعر البيع</b>: ${lastClose}\n📊 <b>الربح/الخسارة</b>: ${profit}%`);

          state[symbol].inTrade = false;
          state[symbol].buys = [];
        }
      }
    } catch (err) {
      console.log(`❌ خطأ في ${symbol}:`, err.message);
    }
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

cron.schedule('*/2 * * * *', runBot);
