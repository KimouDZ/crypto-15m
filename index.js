import fs from 'fs';
import axios from 'axios';
import ccxt from 'ccxt';
import cron from 'node-cron';
import technicalindicators from 'technicalindicators';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const exchange = new ccxt.binance();

const coins = JSON.parse(fs.readFileSync('./coins.json'));

const profits = {};
const buys = {};

function log(msg) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Algiers' });
  console.log(`[${now}] ${msg}`);
}

async function fetchData(symbol) {
  const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 200);
  const closes = ohlcv.map(c => c[4]);
  return closes;
}

function calculateIndicators(closes) {
  const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
  const bb = technicalindicators.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const macdBuy = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 1, slowPeriod: 2, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdSell = technicalindicators.MACD.calculate({ values: closes, fastPeriod: 1, slowPeriod: 10, signalPeriod: 2, SimpleMAOscillator: false, SimpleMASignal: false });
  return { rsi, bb, macdBuy, macdSell };
}

function sendTelegramMessage(msg) {
  axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    params: {
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: 'Markdown'
    }
  });
}

function percentDiff(a, b) {
  return ((b - a) / a) * 100;
}

async function analyze() {
  for (const symbol of coins) {
    try {
      const closes = await fetchData(symbol);
      const { rsi, bb, macdBuy, macdSell } = calculateIndicators(closes);
      const lastPrice = closes[closes.length - 1];

      const rsiVal = rsi[rsi.length - 1];
      const bbVal = bb[bb.length - 1];
      const macdB = macdBuy[macdBuy.length - 1];
      const macdS = macdSell[macdSell.length - 1];

      const inPosition = buys[symbol]?.length > 0;

      // شراء أساسي أو تدعيم
      if (rsiVal < 40 && bbVal?.pb < 0.4 && macdB.MACD > macdB.signal) {
        if (!inPosition) {
          buys[symbol] = [{ price: lastPrice, time: new Date().toISOString() }];
          sendTelegramMessage(`🟢 *إشارة شراء جديدة*

العملة: ${symbol}
السعر: ${lastPrice.toFixed(4)}
الوقت: ${new Date().toLocaleString('ar-EG')}`);
        } else {
          const lastBuy = buys[symbol][buys[symbol].length - 1];
          const decline = (lastPrice < lastBuy.price * 0.985);
          if (decline) {
            buys[symbol].push({ price: lastPrice, time: new Date().toISOString() });
            sendTelegramMessage(`🟠 *دعم للشراء*

العملة: ${symbol}
السعر: ${lastPrice.toFixed(4)}
الوقت: ${new Date().toLocaleString('ar-EG')}`);
          }
        }
      }

      // بيع
      if (inPosition && rsiVal > 55 && macdS.MACD < macdS.signal) {
        const avgBuy = buys[symbol].reduce((sum, b) => sum + b.price, 0) / buys[symbol].length;
        const profit = percentDiff(avgBuy, lastPrice);

        sendTelegramMessage(`🔴 *بيع الصفقة*

العملة: ${symbol}
سعر الشراء المتوسط: ${avgBuy.toFixed(4)}
سعر البيع: ${lastPrice.toFixed(4)}
عدد التدعيمات: ${buys[symbol].length - 1}
الربح/الخسارة: ${profit.toFixed(2)}%
الوقت: ${new Date().toLocaleString('ar-EG')}`);

        profits[symbol] = [...(profits[symbol] || []), profit];
        buys[symbol] = [];
      }
    } catch (e) {
      log(`خطأ في ${symbol}: ${e.message}`);
    }
  }
  log('✅ تم تحليل جميع العملات');
}

// تحليل كل دقيقتين
cron.schedule('*/2 * * * *', analyze);

// إرسال ملخص الأرباح كل يوم الساعة 23:59
cron.schedule('59 23 * * *', () => {
  const now = new Date();
  const day = now.toLocaleDateString('en-GB');
  let report = `📅 *ملخص الأرباح اليومية - ${day}*\n\n`;

  let totalProfit = 0;
  let totalLoss = 0;
  let totalTrades = 0;
  const lines = [];

  for (const [symbol, values] of Object.entries(profits)) {
    for (const p of values) {
      totalTrades++;
      if (p >= 0) totalProfit += p;
      else totalLoss += p;
      lines.push(`- \`${symbol}\`: ${p > 0 ? '+' : ''}${p.toFixed(2)}%`);
    }
  }

  const net = totalProfit + totalLoss;
  report += `✅ *عدد صفقات البيع:* ${totalTrades}\n`;
  report += `📈 *إجمالي الربح:* +${totalProfit.toFixed(2)}%\n`;
  report += `📉 *إجمالي الخسارة:* ${totalLoss.toFixed(2)}%\n`;
  report += `📊 *الربح الصافي:* ${net >= 0 ? '+' : ''}${net.toFixed(2)}%\n\n`;
  if (lines.length > 0) {
    report += `🪙 العملات التي تم بيعها:\n` + lines.join('\n');
  }
  report += `\n\n🕓 *تم التحليل على فريم:* 15 دقيقة`;

  sendTelegramMessage(report);
});
