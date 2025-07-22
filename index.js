import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('./coins.json'));
const tradeData = {};

function formatDate(date) {
  return date.toLocaleString('en-GB', { timeZone: 'Etc/GMT-2', hour12: false }).replace(',', '');
}

function sendTelegram(message) {
  return axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

async function analyze() {
  for (const symbol of coins) {
    try {
      const market = await exchange.loadMarkets();
      const symbolInfo = market[symbol];
      if (!symbolInfo) continue;

      const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 100);
      const closes = ohlcv.map(c => c[4]);
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);

      const rsi = technicalindicators.RSI.calculate({ values: closes, period: 14 });
      const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
      const macdBuy = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 1, slowPeriod: 2, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });
      const macdSell = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 1, slowPeriod: 10, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });

      const i = closes.length - 1;
      const price = closes[i];
      const date = new Date(ohlcv[i][0]);
      const dateStr = formatDate(date);

      const latestRSI = rsi[rsi.length - 1];
      const latestBB = bb[bb.length - 1];
      const percentB = (price - latestBB.lower) / (latestBB.upper - latestBB.lower);
      const macdNow = macdBuy[macdBuy.length - 1];
      const macdPrev = macdBuy[macdBuy.length - 2];
      const sellNow = macdSell[macdSell.length - 1];
      const sellPrev = macdSell[macdSell.length - 2];

      if (!tradeData[symbol]) tradeData[symbol] = { inTrade: false, buyPrice: null, buyTime: null, supports: [] };

      const t = tradeData[symbol];

      const macdCrossUp = macdPrev.MACD < macdPrev.signal && macdNow.MACD > macdNow.signal;
      const macdCrossDown = sellPrev.MACD > sellPrev.signal && sellNow.MACD < sellNow.signal;

      if (!t.inTrade && latestRSI < 40 && percentB < 0.4 && macdCrossUp) {
        t.inTrade = true;
        t.buyPrice = price;
        t.buyTime = date;
        t.supports = [];

        await sendTelegram(
`🔵 *إشارة شراء*

🪙 *العملة:* ${symbol}
💰 *سعر الشراء:* ${price.toFixed(4)}
📅 *وقت الشراء:* ${dateStr}`
        );
      }

      else if (t.inTrade && latestRSI < 40 && percentB < 0.4 && macdCrossUp && price < t.buyPrice * 0.985) {
        t.supports.push({ price, time: date });

        await sendTelegram(
`🟠 *إشارة تدعيم #${t.supports.length}*

🪙 *العملة:* ${symbol}
💰 *سعر التدعيم:* ${price.toFixed(4)}
📅 *وقت التدعيم:* ${dateStr}`
        );
      }

      else if (t.inTrade && latestRSI > 55 && macdCrossDown) {
        const totalSupport = t.supports.reduce((sum, s) => sum + s.price, 0);
        const totalPrice = t.buyPrice + totalSupport;
        const avgPrice = totalPrice / (t.supports.length + 1);
        const pnl = ((price - avgPrice) / avgPrice * 100).toFixed(2);
        const sellTime = dateStr;

        let supportLines = '';
        t.supports.forEach((s, idx) => {
          supportLines += `\n🟠 *سعر التدعيم ${idx + 1}:* ${s.price.toFixed(4)}\n📅 *وقت التدعيم ${idx + 1}:* ${formatDate(s.time)}`;
        });

        await sendTelegram(
`🔴 *إشارة بيع*

🪙 *العملة:* ${symbol}
💰 *سعر الشراء الأساسي:* ${t.buyPrice.toFixed(4)}
📅 *وقت الشراء:* ${formatDate(t.buyTime)}
${supportLines}
💸 *سعر البيع:* ${price.toFixed(4)}
📅 *وقت البيع:* ${sellTime}

📊 *الربح/الخسارة:* ${pnl}%`
        );

        if (!t.history) t.history = [];
        t.history.push({ pnl: parseFloat(pnl), date: new Date() });

        t.inTrade = false;
        t.buyPrice = null;
        t.buyTime = null;
        t.supports = [];
      }

    } catch (e) {
      console.error(`❌ خطأ مع ${symbol}:`, e.message);
    }
  }
}

// كل دقيقتين تحليل
cron.schedule('*/2 * * * *', analyze);

// ⏰ تقرير نهاية اليوم
cron.schedule('59 23 * * *', async () => {
  let msg = `📆 *تقرير أرباح اليوم*\n\n`;
  let total = 0;
  let count = 0;

  for (const symbol of Object.keys(tradeData)) {
    const history = tradeData[symbol]?.history || [];
    const todayTrades = history.filter(h => new Date(h.date).toDateString() === new Date().toDateString());

    todayTrades.forEach(h => {
      msg += `🪙 *${symbol}*: ${h.pnl.toFixed(2)}%\n`;
      total += h.pnl;
      count++;
    });
  }

  msg += `\n📊 *الربح الكلي:* ${total.toFixed(2)}%\n📈 *عدد الصفقات:* ${count}`;

  await sendTelegram(msg);
});
