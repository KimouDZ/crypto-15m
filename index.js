import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';
import cron from 'node-cron';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();
const coins = JSON.parse(fs.readFileSync('coins.json'));
const interval = '15m';

let positions = {};

async function fetchOHLCV(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, interval, undefined, 150);
    return ohlcv.map(candle => ({
      time: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5],
    }));
  } catch (error) {
    console.error(`[ERROR] أثناء جلب بيانات ${symbol}: ${error.message}`);
    return [];
  }
}

function calculateIndicators(data) {
  const closePrices = data.map(c => c.close);
  const highs = data.map(c => c.high);
  const lows = data.map(c => c.low);

  const rsi = technicalindicators.RSI.calculate({ values: closePrices, period: 14 });
  const bb = technicalindicators.BollingerBands.calculate({ values: closePrices, period: 20, stdDev: 2.0 });
  const macdBuy = technicalindicators.MACD.calculate({
    values: closePrices,
    fastPeriod: 1,
    slowPeriod: 5,
    signalPeriod: 30,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const macdSell = technicalindicators.MACD.calculate({
    values: closePrices,
    fastPeriod: 2,
    slowPeriod: 10,
    signalPeriod: 15,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });

  return { rsi, bb, macdBuy, macdSell };
}

function isBuySignal(rsi, bb, macd) {
  const i = rsi.length - 1;
  const macdCurr = macd[macd.length - 1];
  const macdPrev = macd[macd.length - 2];
  return (
    rsi[i] < 25 &&
    bb[bb.length - 1].percentB < 0 &&
    macdPrev.MACD < macdPrev.signal &&
    macdCurr.MACD > macdCurr.signal
  );
}

function isSupportBuy(lastPrice, lastBuyPrice, rsi, bb, macd) {
  const i = rsi.length - 1;
  const droppedEnough = lastPrice <= lastBuyPrice * 0.95;
  const validIndicators =
    rsi[i] < 25 &&
    bb[bb.length - 1].percentB < 0 &&
    macd[macd.length - 2].MACD < macd[macd.length - 2].signal &&
    macd[macd.length - 1].MACD > macd[macd.length - 1].signal;
  return droppedEnough && validIndicators;
}

function isSellSignal(rsi, macd) {
  const i = rsi.length - 1;
  const macdCurr = macd[macd.length - 1];
  const macdPrev = macd[macd.length - 2];
  return (
    rsi[i] > 50 &&
    macdPrev.MACD > macdPrev.signal &&
    macdCurr.MACD < macdCurr.signal
  );
}

function formatDate(date) {
  return new Date(date).toLocaleString("ar-DZ");
}

async function analyze(symbol) {
  const data = await fetchOHLCV(symbol);
  if (data.length === 0) return;

  const { rsi, bb, macdBuy, macdSell } = calculateIndicators(data);
  const lastPrice = data[data.length - 1].close;
  const currentTime = new Date();

  if (!positions[symbol]) {
    if (isBuySignal(rsi, bb, macdBuy)) {
      positions[symbol] = {
        base: { price: lastPrice, time: currentTime },
        supports: []
      };
      const message = `🟢 إشارة شراء

🪙 العملة: ${symbol}
💰 السعر: ${lastPrice.toFixed(4)}
🕒 الوقت: ${formatDate(currentTime)}`;
      await sendTelegram(message);
    }
  } else {
    const position = positions[symbol];
    const lastSupport = position.supports.length
      ? position.supports[position.supports.length - 1]
      : position.base;

    if (isSupportBuy(lastPrice, lastSupport.price, rsi, bb, macdBuy)) {
      position.supports.push({ price: lastPrice, time: currentTime });
      const message = `🟠 تدعيم للشراء

🪙 العملة: ${symbol}
💰 السعر: ${lastPrice.toFixed(4)}
🕒 الوقت: ${formatDate(currentTime)}`;
      await sendTelegram(message);
    } else if (isSellSignal(rsi, macdSell)) {
      const allPrices = [position.base.price, ...position.supports.map(s => s.price)];
      const averageBuy = allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;
      const pnl = ((lastPrice - averageBuy) / averageBuy) * 100;

      let message = `🔴 إشارة بيع

🪙 العملة: ${symbol}
💰 سعر الشراء: ${position.base.price.toFixed(4)}
🕒 وقت الشراء: ${formatDate(position.base.time)}`;

      if (position.supports.length) {
        message += `\n📌 عدد التدعيمات: ${position.supports.length}`;
        position.supports.forEach((s, i) => {
          message += `\n🔸 تدعيم ${i + 1}: ${s.price.toFixed(4)} - ${formatDate(s.time)}`;
        });
      }

      message += `\n💸 سعر البيع: ${lastPrice.toFixed(4)}
📊 الربح/الخسارة: ${pnl.toFixed(2)}%
🕒 وقت البيع: ${formatDate(currentTime)}`;

      await sendTelegram(message);
      delete positions[symbol];
    }
  }

  console.log(`[CHECK] تحليل ${symbol} - ${formatDate(currentTime)}`);
}

async function sendTelegram(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error(`[ERROR] Telegram: ${error.message}`);
  }
}

cron.schedule('*/2 * * * *', async () => {
  console.log(`[START] بدء التحليل - ${new Date().toLocaleString("ar-DZ")}`);
  for (const symbol of coins) {
    await analyze(symbol);
  }
});
