import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import cron from 'node-cron';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const coins = JSON.parse(fs.readFileSync('coins.json'));
const exchange = new ccxt.binance();

const STATE_FILE = 'state.json';
let state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE)) : {};

function log(message) {
  console.log(`[LOG ${new Date().toISOString()}] ${message}`);
}

function sendTelegramMessage(message) {
  return axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-GB', { hour12: false }).replace(',', ' -');
}

function formatNumber(n) {
  return parseFloat(n).toFixed(4);
}

function formatPercentage(n) {
  const percent = parseFloat(n).toFixed(2);
  return percent > 0 ? `+${percent}%` : `${percent}%`;
}

function getAveragePrice(prices) {
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function shouldBuy(rsi, percentB, macdHist) {
  return rsi < 25 && percentB < 0 && macdHist > 0;
}

function shouldSell(rsi, macdHist) {
  return rsi > 50 && macdHist < 0;
}

async function analyze() {
  for (const symbol of coins) {
    try {
      const market = await exchange.fetchOHLCV(symbol, '15m');
      const closes = market.map(c => c[4]);

      const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
      const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
      const macd = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 1, slowPeriod: 5, signalPeriod: 30, SimpleMAOscillator: false, SimpleMASignal: false });
      const macdSell = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 2, slowPeriod: 10, signalPeriod: 15, SimpleMAOscillator: false, SimpleMASignal: false });

      if (rsi.length < 1 || bb.length < 1 || macd.length < 1 || macdSell.length < 1) continue;

      const lastPrice = closes[closes.length - 1];
      const lastRSI = rsi[rsi.length - 1];
      const lastBB = bb[bb.length - 1];
      const percentB = (lastPrice - lastBB.lower) / (lastBB.upper - lastBB.lower);
      const macdHist = macd[macd.length - 1].MACD - macd[macd.length - 1].signal;
      const macdSellHist = macdSell[macdSell.length - 1].MACD - macdSell[macdSell.length - 1].signal;

      const coin = symbol.replace('/USDT', '');
      const current = state[coin] || { bought: false, buyPrices: [], buyTimes: [] };

      if (!current.bought && shouldBuy(lastRSI, percentB, macdHist)) {
        current.bought = true;
        current.buyPrices = [lastPrice];
        current.buyTimes = [Date.now()];

        sendTelegramMessage(`🟢 *إشارة شراء*\n\n🪙 العملة: ${coin}/USDT\n💰 السعر: ${formatNumber(lastPrice)}\n🕒 الوقت: ${formatDate(current.buyTimes[0])}`);
        log(`شراء ${coin} بسعر ${lastPrice}`);

      } else if (current.bought && !shouldSell(lastRSI, macdSellHist)) {
        const lastBuyPrice = current.buyPrices[current.buyPrices.length - 1];
        const drop = lastBuyPrice * 0.985;

        if (lastPrice <= drop && shouldBuy(lastRSI, percentB, macdHist)) {
          current.buyPrices.push(lastPrice);
          current.buyTimes.push(Date.now());

          sendTelegramMessage(`🟠 *دعم إضافي (${current.buyPrices.length - 1})*\n\n🪙 العملة: ${coin}/USDT\n💰 السعر: ${formatNumber(lastPrice)}\n🕒 الوقت: ${formatDate(current.buyTimes[current.buyTimes.length - 1])}`);
          log(`دعم ${coin} بسعر ${lastPrice}`);
        }

      } else if (current.bought && shouldSell(lastRSI, macdSellHist)) {
        const avgBuyPrice = getAveragePrice(current.buyPrices);
        const profit = ((lastPrice - avgBuyPrice) / avgBuyPrice) * 100;

        const buysFormatted = current.buyPrices.map((p, i) => `#${i + 1}: ${formatNumber(p)} في ${formatDate(current.buyTimes[i])}`).join('\n');

        sendTelegramMessage(`🔴 *إشارة بيع*\n\n🪙 العملة: ${coin}/USDT\n💰 سعر الشراء: ${formatNumber(current.buyPrices[0])}\n🕒 وقت الشراء: ${formatDate(current.buyTimes[0])}\n📍 التدعيمات:\n${buysFormatted}\n💸 سعر البيع: ${formatNumber(lastPrice)}\n📊 الربح/الخسارة: ${formatPercentage(profit)}\n🕒 وقت البيع: ${formatDate(Date.now())}`);

        log(`بيع ${coin} بسعر ${lastPrice} بربح ${profit}%`);
        state[coin] = { bought: false, buyPrices: [], buyTimes: [] };
      }

      state[coin] = current;
    } catch (err) {
      log(`خطأ في ${symbol}: ${err.message}`);
    }
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

cron.schedule('*/2 * * * *', analyze);
log('البوت بدأ العمل بنجاح');
