import express from 'express';
import fs from 'fs-extra';
import axios from 'axios';
import ccxt from 'ccxt';
import cron from 'node-cron';
import { RSI, BollingerBands, MACD } from 'technicalindicators';

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';

const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('./coins.json'));
let state = fs.readJsonSync('./state.json', { throws: false }) || {};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendTelegramMessage(msg) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: msg,
    parse_mode: 'Markdown'
  });
}

function formatPercent(p) {
  return \`\${(p >= 0 ? '+' : '')}\${(p * 100).toFixed(2)}%\`;
}

async function analyzeCoin(symbol) {
  const market = symbol.replace('/', '');
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 150);
    const closes = ohlcv.map(c => c[4]);
    const time = new Date(ohlcv.at(-1)[0]).toLocaleString('ar-DZ');
    const price = closes.at(-1);

    const rsi = RSI.calculate({ values: closes, period: 14 }).at(-1);
    const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 }).at(-1);
    const percentB = (price - bb.lower) / (bb.upper - bb.lower);

    const macdBuy = MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 10,
      signalPeriod: 4,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const macdSell = MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 100,
      signalPeriod: 8,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const macdBuyPrev = macdBuy.at(-2), macdBuyCurr = macdBuy.at(-1);
    const macdSellPrev = macdSell.at(-2), macdSellCurr = macdSell.at(-1);

    if (!state[market] && rsi < 45 && percentB < 0.2 && macdBuyPrev.MACD < macdBuyPrev.signal && macdBuyCurr.MACD > macdBuyCurr.signal) {
      state[market] = { buyPrice: price, time };
      await sendTelegramMessage(\`✅ *إشارة شراء \${symbol}*\n🕒 \${time}\n💰 السعر: *\${price} USDT*\`);
      console.log(\`✅ شراء \${symbol} عند \${price}\`);
    }

    if (state[market] && macdSellPrev.MACD > macdSellPrev.signal && macdSellCurr.MACD < macdSellCurr.signal) {
      const buyPrice = state[market].buyPrice;
      const profit = (price - buyPrice) / buyPrice;
      await sendTelegramMessage(\`🔻 *إشارة بيع \${symbol}*\n🕒 \${time}\n💰 السعر: *\${price} USDT*\n📊 \${formatPercent(profit)} \${(profit >= 0) ? 'ربح' : 'خسارة'}\`);
      delete state[market];
      console.log(\`🔻 بيع \${symbol} عند \${price} بنسبة \${formatPercent(profit)}\`);
    }
  } catch (err) {
    console.log(\`⚠️ خطأ في \${symbol}: \${err.message}\`);
  }
}

async function run() {
  for (let symbol of coins) {
    await analyzeCoin(symbol);
    await sleep(1200);
  }
  fs.writeJsonSync('./state.json', state, { spaces: 2 });
}

cron.schedule('*/2 * * * *', run);

app.get('/', (req, res) => {
  res.send('✅ البوت يعمل...');
});

app.listen(PORT, () => {
  console.log(\`🚀 السيرفر يعمل على المنفذ \${PORT}\`);
});
