import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();

let inPosition = {};
let buyData = {};

const coins = JSON.parse(fs.readFileSync('./coins.json'));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sendTelegramMessage = async (message) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });
};

const calculateIndicators = (closes) => {
  const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
  const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const macdBuy = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 1, slowPeriod: 5, signalPeriod: 30, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdSell = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 2, slowPeriod: 10, signalPeriod: 15, SimpleMAOscillator: false, SimpleMASignal: false });
  return { rsi, bb, macdBuy, macdSell };
};

const get15mOHLCV = async (symbol) => {
  const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
  return ohlcv.map(candle => candle[4]);
};

const shouldBuy = (rsi, bb, macd, index) => {
  if (index < 1 || rsi.length <= index || bb.length <= index || macd.length <= index) return false;
  return (
    rsi[index] < 25 &&
    bb[index].pb < 0 &&
    macd[index - 1].MACD < macd[index - 1].signal &&
    macd[index].MACD > macd[index].signal
  );
};

const shouldSell = (rsi, macd, index) => {
  if (index < 1 || rsi.length <= index || macd.length <= index) return false;
  return (
    rsi[index] > 50 &&
    macd[index - 1].MACD > macd[index - 1].signal &&
    macd[index].MACD < macd[index].signal
  );
};

const getTodayProfit = () => {
  try {
    const profits = JSON.parse(fs.readFileSync('./profits.json'));
    const today = new Date().toISOString().split('T')[0];
    const todayProfits = profits.filter(p => p.date.startsWith(today));
    const total = todayProfits.reduce((sum, p) => sum + parseFloat(p.profit), 0);
    return total.toFixed(2);
  } catch (e) {
    console.error("خطأ في حساب أرباح اليوم:", e);
    return "0.00";
  }
};

cron.schedule('59 23 * * *', async () => {
  const todayProfit = getTodayProfit();
  const message = `📊 <b>تقرير الأرباح اليومية</b>\n💰 <b>ربح اليوم:</b> ${todayProfit} USDT`;
  await sendTelegramMessage(message);
});

const runAnalysis = async () => {
  for (const coin of coins) {
    try {
      const symbol = coin;
      const prices = await get15mOHLCV(symbol);
      const { rsi, bb, macdBuy, macdSell } = calculateIndicators(prices);
      const index = rsi.length - 1;
      const price = prices[prices.length - 1];

      if (!inPosition[symbol] && shouldBuy(rsi, bb, macdBuy, index)) {
        inPosition[symbol] = true;
        buyData[symbol] = { price, time: new Date(), supports: [] };
        const msg = `🚀 <b>شراء</b>\n<b>العملة:</b> ${symbol.replace('/USDT', '')}\n💵 <b>السعر:</b> ${price}\n⏰ <b>الوقت:</b> ${buyData[symbol].time.toLocaleString('ar-EG')}`;
        await sendTelegramMessage(msg);
      } else if (inPosition[symbol] && shouldSell(rsi, macdSell, index)) {
        const entry = buyData[symbol];
        const profit = ((price - entry.price) / entry.price) * 100;
        const msg = `💰 <b>بيع</b>\n<b>العملة:</b> ${symbol.replace('/USDT', '')}\n🛒 <b>سعر الشراء:</b> ${entry.price}\n📈 <b>سعر البيع:</b> ${price}\n📅 <b>تاريخ الشراء:</b> ${entry.time.toLocaleString('ar-EG')}\n📊 <b>الربح:</b> ${profit.toFixed(2)}٪`;
        await sendTelegramMessage(msg);

        // حفظ الربح
        try {
          const profitsPath = './profits.json';
          if (!fs.existsSync(profitsPath)) {
            fs.writeFileSync(profitsPath, '[]');
          }
          const profits = JSON.parse(fs.readFileSync(profitsPath));
          profits.push({ symbol, profit: profit.toFixed(2), date: new Date().toISOString() });
          fs.writeFileSync(profitsPath, JSON.stringify(profits, null, 2));
        } catch (e) {
          console.error(`خطأ في تسجيل الربح: ${e}`);
        }

        delete inPosition[symbol];
        delete buyData[symbol];
      } else if (inPosition[symbol] && price <= buyData[symbol].price * 0.95 && shouldBuy(rsi, bb, macdBuy, index)) {
        buyData[symbol].supports.push({ price, time: new Date() });
        const msg = `📉 <b>دعم إضافي</b>\n<b>العملة:</b> ${symbol.replace('/USDT', '')}\n💵 <b>السعر:</b> ${price}\n📅 <b>الوقت:</b> ${new Date().toLocaleString('ar-EG')}`;
        await sendTelegramMessage(msg);
      }
    } catch (e) {
      console.error(`فشل في تحليل ${coin}:`, e);
    }
    await sleep(2000);
  }
};

cron.schedule('*/2 * * * *', runAnalysis);
