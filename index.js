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
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

const log = (msg) => {
  const timestamp = new Date().toLocaleString('en-GB', { hour12: false }).replace(',', '');
  console.log(`[${timestamp}] ${msg}`);
};

const sendTelegram = async (message) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
    log(`📩 تم إرسال تنبيه: ${message.split('\n')[0]}`);
  } catch (error) {
    log(`⚠️ فشل في إرسال التلغرام: ${error.message}`);
  }
};

const analyze = async () => {
  log(`🚀 بدأ تحليل ${coins.length} عملة`);
  for (const symbol of coins) {
    try {
      log(`🔍 تحليل ${symbol}`);
      const market = await exchange.fetchOHLCV(symbol, '4h', undefined, 100);
      if (!market || market.length === 0) throw new Error('لا توجد بيانات');
      const close = market.map(c => c[4]);
      const high = market.map(c => c[2]);
      const low = market.map(c => c[3]);

      const rsi = technicalindicators.RSI.calculate({ values: close, period: 14 });
      const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: close });
      const macdBuy = technicalindicators.MACD.calculate({ values: close, fastPeriod: 1, slowPeriod: 5, signalPeriod: 30, SimpleMAOscillator: false, SimpleMASignal: false });
      const macdSell = technicalindicators.MACD.calculate({ values: close, fastPeriod: 2, slowPeriod: 10, signalPeriod: 15, SimpleMAOscillator: false, SimpleMASignal: false });

      const lastRSI = rsi[rsi.length - 1];
      const lastBB = bb[bb.length - 1];
      const price = close[close.length - 1];

      const buyCond = lastRSI < 25 && ((price - lastBB.lower) / (lastBB.upper - lastBB.lower)) < 0;
      const justCrossedBuy = macdBuy[macdBuy.length - 2].MACD < macdBuy[macdBuy.length - 2].signal && macdBuy[macdBuy.length - 1].MACD > macdBuy[macdBuy.length - 1].signal;

      const justCrossedSell = macdSell[macdSell.length - 2].MACD > macdSell[macdSell.length - 2].signal && macdSell[macdSell.length - 1].MACD < macdSell[macdSell.length - 1].signal;
      const sellRSI = lastRSI > 50;

      const now = new Date();
      const timeStr = now.toLocaleString('fr-FR', { hour12: false }).replace(',', '');

      if (!state[symbol]) {
        if (buyCond && justCrossedBuy) {
          state[symbol] = {
            bought: true,
            buyPrice: price,
            buyTime: timeStr,
            reinforcements: []
          };
          await sendTelegram(`🟢 <b>شراء</b> ${symbol}\n💰 السعر: ${price}\n🕒 ${timeStr}`);
        }
      } else {
        if (buyCond && justCrossedBuy) {
          state[symbol].reinforcements.push({ price, time: timeStr });
          await sendTelegram(`🔄 <b>تدعيم</b> ${symbol}\n💰 السعر: ${price}\n🕒 ${timeStr}`);
        }

        if (sellRSI && justCrossedSell) {
          const { buyPrice, buyTime, reinforcements } = state[symbol];
          const allPrices = [buyPrice, ...reinforcements.map(r => r.price)];
          const avg = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
          const pnl = ((price - avg) / avg * 100).toFixed(2);
          let reinforcementInfo = reinforcements.map(r => `📍 ${r.price} في ${r.time}`).join('\n');
          reinforcementInfo = reinforcementInfo || 'لا يوجد';

          await sendTelegram(`🔴 <b>بيع</b> ${symbol}\n💰 السعر: ${price}\n⏱ الشراء الأول: ${buyPrice} في ${buyTime}\n🧱 التدعيمات:\n${reinforcementInfo}\n📊 الربح/الخسارة: ${pnl}%\n🕒 ${timeStr}`);
          delete state[symbol];
        }
      }
    } catch (error) {
      log(`❌ خطأ في ${symbol}: ${error.message}`);
    }
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
};

cron.schedule('*/2 * * * *', analyze);
log('🚀 البوت يعمل ويقوم بالتحليل كل دقيقتين');
