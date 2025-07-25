import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';
import { DateTime } from 'luxon';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_IDS = ['1055739217'];
const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.015;

// تحميل المراكز عند بدء التشغيل
function loadPositions() {
  try {
    const data = fs.readFileSync('positions.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// حفظ المراكز إلى ملف JSON
function savePositions(data) {
  try {
    fs.writeFileSync('positions.json', JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('خطأ في حفظ المراكز:', error.message);
  }
}

let inPositions = loadPositions();
let lastAlertsTime = {};
let lastAlertPrice = {};
let percentBPassed = {};
let dailyProfits = {};

function sendTelegramMessage(message) {
  for (const chatId of CHAT_IDS) {
    axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    }).catch(error => {
      console.error(`❌ فشل إرسال الرسالة إلى ${chatId}:`, error.message);
    });
  }
}

function roundPrice(price) {
  return Math.round(price * 100) / 100;
}

// تعديل canSendAlert لتحقق بناءً على العملة فقط (بدون النوع)
function canSendAlert(symbol, currentTime, price) {
  const COOLDOWN = 10 * 1000; // 10 ثواني cooldown

  if (!lastAlertsTime[symbol]) {
    lastAlertsTime[symbol] = 0;
    lastAlertPrice[symbol] = 0;
  }

  const lastTime = lastAlertsTime[symbol];
  const lastPrice = lastAlertPrice[symbol];
  const roundedPrice = roundPrice(price);

  if (lastTime && lastPrice === roundedPrice && (currentTime - lastTime) < COOLDOWN) {
    return false;
  }

  lastAlertsTime[symbol] = currentTime;
  lastAlertPrice[symbol] = roundedPrice;
  return true;
}

function formatDate(date) {
  const offsetDate = new Date(date.getTime() + 60 * 60 * 1000); // GMT+1
  return offsetDate.toISOString().replace('T', ' ').slice(0, 19);
}

function calculateMACD(values, fastPeriod, slowPeriod, signalPeriod) {
  return technicalindicators.MACD.calculate({
    values,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
}

function calculateRSI(values, period) {
  return technicalindicators.RSI.calculate({ values, period });
}

function calculatePercentB(closes, period = 20, stdDev = 2) {
  const bb = technicalindicators.BollingerBands.calculate({
    period,
    stdDev,
    values: closes
  });
  return closes.slice(period - 1).map((close, i) => {
    const band = bb[i];
    return band ? (close - band.lower) / (band.upper - band.lower) : 0;
  });
}

async function analyze() {
  try {
    const coins = JSON.parse(fs.readFileSync('coins.json'));

    // تم حذف رسالة بدء التحليل حسب طلبك

    const now = Date.now();

    for (const symbol of coins) {
      console.log(`جاري تحليل العملة: ${symbol}`);

      let alertSentForSymbol = false; // لضمان تنبيه واحد فقط لكل عملة

      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
        const closes = ohlcv.map(c => c[4]);
        if (closes.length < 20) continue;

        const rsi = calculateRSI(closes, 14);
        const percentB = calculatePercentB(closes);
        const macdBuy = calculateMACD(closes, 1, 2, 2);
        const macdSell = calculateMACD(closes, 1, 10, 2);

        const lastIndex = closes.length - 1;
        const priceRaw = closes[lastIndex];
        const price = roundPrice(priceRaw);
        const timeNow = new Date();
        const timeStr = formatDate(timeNow);

        const rsiVal = rsi[rsi.length - 1];
        const pbVal = percentB[percentB.length - 1];
        const macdHistBuy = macdBuy[macdBuy.length - 1]?.MACD - macdBuy[macdBuy.length - 1]?.signal;
        const prevMacdHistBuy = macdBuy[macdBuy.length - 2]?.MACD - macdBuy[macdBuy.length - 2]?.signal;
        const macdHistSell = macdSell[macdSell.length - 1]?.MACD - macdSell[macdSell.length - 1]?.signal;
        const prevMacdHistSell = macdSell[macdSell.length - 2]?.MACD - macdSell[macdSell.length - 2]?.signal;

        const position = inPositions[symbol];

        if (percentBPassed[symbol] === undefined) percentBPassed[symbol] = false;
        percentBPassed[symbol] = pbVal > 0.2;

        const buySignal = !position &&
          rsiVal < 40 && pbVal < 0.4 &&
          prevMacdHistBuy < 0 && macdHistBuy > 0;

        const sellSignal = position &&
          position.supports.length > 0 &&
          percentBPassed[symbol] &&
          prevMacdHistSell > 0 && macdHistSell < 0;

        const sellRegularSignal = position &&
          position.supports.length === 0 &&
          rsiVal > 55 &&
          prevMacdHistSell > 0 && macdHistSell < 0;

        if (!alertSentForSymbol && buySignal) {
          console.log(`إشارة شراء للرمز ${symbol} عند السعر ${price}`);
          if (canSendAlert(symbol, now, price)) {
            inPositions[symbol] = { symbol, buyPrice: price, buyTime: timeNow, supports: [] };
            savePositions(inPositions);
            sendTelegramMessage(
              `🟢 إشــارة شــراء جديدة\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n📅 الوقت: ${timeStr}`
            );
            alertSentForSymbol = true;
          } else {
            console.log(`تم منع إرسال تنبيه شراء لـ ${symbol} بسبب شرط الـ cooldown`);
          }
        } 
        else if (!alertSentForSymbol && sellSignal) {
          console.log(`إشارة بيع تدعيم للرمز ${symbol} عند السعر ${price}`);
          if (canSendAlert(symbol, now, price)) {
            const avgBuy = [position.buyPrice, ...position.supports.map(s => s.price)].reduce((a, b) => a + b) / (1 + position.supports.length);
            const changePercent = ((price - avgBuy) / avgBuy * 100).toFixed(2);
            const profit = price - avgBuy;
            const dateStr = timeNow.toISOString().slice(0, 10);

            if (!dailyProfits[dateStr]) dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
            dailyProfits[dateStr].totalProfit += profit;
            if (profit > 0) dailyProfits[dateStr].wins++;
            else if (profit < 0) dailyProfits[dateStr].losses++;

            let message = `🔴 إشــارة بيـع\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء الأساسي: ${position.buyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n📅 وقت الشراء: ${formatDate(position.buyTime)}\n\n`;

            position.supports.forEach((s, i) => {
              message += `➕ سعر التدعيم ${i + 1}: ${s.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n📅 وقت التدعيم ${i + 1}: ${formatDate(s.time)}\n\n`;
            });

            message += `💸 سعر البيع: ${price}\n📅 وقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent}%`;
            sendTelegramMessage(message);
            delete inPositions[symbol];
            savePositions(inPositions);
            alertSentForSymbol = true;
          } else {
            console.log(`تم منع إرسال تنبيه بيع تدعيم لـ ${symbol} بسبب شرط الـ cooldown`);
          }
        } 
        else if (!alertSentForSymbol && sellRegularSignal) {
          console.log(`إشارة بيع عادي للرمز ${symbol} عند السعر ${price}`);
          if (canSendAlert(symbol, now, price)) {
            const changePercent = ((price - position.buyPrice) / position.buyPrice * 100).toFixed(2);
            const profit = price - position.buyPrice;
            const dateStr = timeNow.toISOString().slice(0, 10);

            if (!dailyProfits[dateStr]) dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
            dailyProfits[dateStr].totalProfit += profit;
            if (profit > 0) dailyProfits[dateStr].wins++;
            else if (profit < 0) dailyProfits[dateStr].losses++;

            let message = `🔴 إشــارة بيع عادي\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء: ${position.buyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n📅 وقت الشراء: ${formatDate(position.buyTime)}\n\n💸 سعر البيع: ${price}\n📅 وقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent}%`;
            sendTelegramMessage(message);
            delete inPositions[symbol];
            savePositions(inPositions);
            alertSentForSymbol = true;
          } else {
            console.log(`تم منع إرسال تنبيه بيع عادي لـ ${symbol} بسبب شرط الـ cooldown`);
          }
        } 
        else if (!alertSentForSymbol && position &&
          price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) &&
          buySignal) {
          const lastSupport = position.supports[position.supports.length - 1];
          const basePrice = lastSupport ? lastSupport.price : position.buyPrice;
          if (price <= basePrice * (1 - PRICE_DROP_SUPPORT)) {
            console.log(`إشارة تدعيم شراء للرمز ${symbol} عند السعر ${price}`);
            if (canSendAlert(symbol, now, price)) {
              position.supports.push({ price, time: timeNow });
              savePositions(inPositions);
              sendTelegramMessage(
                `🟠 تــدعيـم للشراء\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n📅 الوقت: ${timeStr}`
              );
              alertSentForSymbol = true;
            } else {
              console.log(`تم منع إرسال تنبيه تدعيم لـ ${symbol} بسبب شرط الـ cooldown`);
            }
          }
        }

      } catch (error) {
        console.error(`خطأ في تحليل ${symbol}:`, error.message);
      }
    }
  } catch (error) {
    console.error("خطأ في قراءة coins.json أو أثناء التحليل:", error.message);
  }
}

cron.schedule('*/2 * * * *', async () => {
  try {
    console.log("جاري التحليل...");
    await analyze();
  } catch (error) {
    console.error("خطأ أثناء التحليل:", error);
  }
});

cron.schedule('0 * * * *', async () => {
  // تحقق من منتصف الليل بتوقيت الجزائر
  const nowInAlgiers = DateTime.now().setZone('Africa/Algiers');

  if (nowInAlgiers.hour === 0 && nowInAlgiers.minute === 0) {
    const yesterday = nowInAlgiers.minus({ days: 1 });
    const dateStr = yesterday.toISODate();

    const report = dailyProfits[dateStr];

    // حساب تقرير الصفقات المفتوحة
    let openPositionsReport = '';

    for (const symbol in inPositions) {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        const currentPrice = ticker.last;
        const position = inPositions[symbol];

        const avgBuy = [position.buyPrice, ...position.supports.map(s => s.price)].reduce((a, b) => a + b, 0) / (1 + position.supports.length);
        const percentChange = ((currentPrice - avgBuy) / avgBuy * 100).toFixed(2);

        openPositionsReport += `\n- ${symbol}: السعر الحالي ${currentPrice.toFixed(2)}، نسبة الربح/الخسارة الحالية: ${percentChange}%`;
      } catch (error) {
        openPositionsReport += `\n- ${symbol}: لم أتمكن من جلب السعر الحالي (${error.message})`;
      }
    }

    if (report) {
      const message =
        `📊 تقرير الأرباح ليوم ${dateStr}:\n` +
        `💰 إجمالي الربح/الخسارة: ${report.totalProfit.toFixed(8)} وحدة نقدية\n` +
        `✅ عدد الصفقات الرابحة: ${report.wins}\n` +
        `❌ عدد الصفقات الخاسرة: ${report.losses}\n` +
        `\n📈 الصفقات المفتوحة:\n${openPositionsReport || 'لا توجد صفقات مفتوحة.'}`;

      sendTelegramMessage(message);
      delete dailyProfits[dateStr];
    } else {
      const message = `📊 تقرير الأرباح ليوم ${dateStr}:\nلم يتم تسجيل أي صفقة.\n\n📈 الصفقات المفتوحة:\n${openPositionsReport || 'لا توجد صفقات مفتوحة.'}`;
      sendTelegramMessage(message);
    }
  }
});
