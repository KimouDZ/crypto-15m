
import fs from 'fs';
import axios from 'axios';
import cron from 'node-cron';
import ccxt from 'ccxt';
import technicalindicators from 'technicalindicators';
import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const USERS_FILE = 'users.json';

const exchange = new ccxt.binance();
const PRICE_DROP_SUPPORT = 0.017;
const RUN_ID = uuidv4();
console.log(`🚀 بدء تشغيل البرنامج بمعرف ${RUN_ID}`);

// تحميل وتخزين المستخدمين المسجلين (chat IDs)
let registeredUsers = [];

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    registeredUsers = JSON.parse(data);
    console.log(`✔️ تم تحميل ${registeredUsers.length} مستخدمين مسجلين`);
  } catch {
    registeredUsers = [];
    console.log('🚫 لا يوجد ملف للمستخدمين، سيتم إنشاؤه عند التسجيل الأول');
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(registeredUsers, null, 2), 'utf-8');
    console.log('💾 تم تحديث قائمة المستخدمين');
  } catch (error) {
    console.error('❌ خطأ في حفظ المستخدمين:', error.message);
  }
}

// إرسال رسائل لجميع المستخدمين المسجلين بدون قيود زمنية
function sendTelegramMessage(message) {
  for (const chatId of registeredUsers) {
    const nowIso = new Date().toISOString();
    console.log(`[${nowIso}] ⚡️ إرسال رسالة إلى ${chatId}`);
    axios
      .post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      })
      .then(() => {
        console.log(`[${nowIso}] ✅ تم إرسال الرسالة بنجاح إلى ${chatId}`);
      })
      .catch((error) => {
        console.error(`[${nowIso}] ❌ فشل إرسال الرسالة إلى ${chatId}:`, error.message);
      });
  }
}

function formatDate(date) {
  const offsetDate = new Date(date.getTime() + 60 * 60 * 1000);
  return offsetDate.toISOString().replace('T', ' ').slice(0, 19);
}

function calculateMACD(values, fastPeriod, slowPeriod, signalPeriod) {
  return technicalindicators.MACD.calculate({
    values,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
}

function calculateRSI(values, period) {
  return technicalindicators.RSI.calculate({ values, period });
}

function calculatePercentB(closes, period = 20, stdDev = 2) {
  const bb = technicalindicators.BollingerBands.calculate({
    period,
    stdDev,
    values: closes,
  });
  return closes.slice(period - 1).map((close, i) => {
    const band = bb[i];
    return band ? (close - band.lower) / (band.upper - band.lower) : 0;
  });
}

function loadPositions() {
  try {
    const data = fs.readFileSync('positions.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function savePositions(data) {
  try {
    fs.writeFileSync('positions.json', JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`⚠️ [${RUN_ID}] خطأ في حفظ المراكز:`, error.message);
  }
}

let inPositions = loadPositions();
let percentBPassed = {};
let dailyProfits = {};

let isAnalyzing = false;

async function analyze() {
  if (isAnalyzing) {
    console.log('📌 تحليل جاري، يتم تجاهل استدعاء analyze جديد');
    return;
  }
  isAnalyzing = true;

  try {
    const coins = JSON.parse(fs.readFileSync('coins.json'));
    console.log(`🚀 بدء تحليل العملات: ${coins.join(', ')}`);

    for (const symbol of coins) {
      console.log(`🔍 جاري تحليل العملة: ${symbol}`);

      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, '15m');
        const closes = ohlcv.map((c) => c[4]);
        if (closes.length < 20) continue;

        const rsi = calculateRSI(closes, 14);
        const percentB = calculatePercentB(closes);
        const macdBuy = calculateMACD(closes, 1, 2, 2);
        const macdSell = calculateMACD(closes, 1, 10, 2);

        const lastIndex = closes.length - 1;
        const price = closes[lastIndex];
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

        const buySignal = !position && rsiVal < 40 && pbVal < 0.4 && prevMacdHistBuy < 0 && macdHistBuy > 0;
        const sellSignal = position && position.supports.length > 0 && percentBPassed[symbol] && prevMacdHistSell > 0 && macdHistSell < 0;
        const sellRegularSignal = position && position.supports.length === 0 && rsiVal > 55 && prevMacdHistSell > 0 && macdHistSell < 0;

        // إشارة شراء
        if (buySignal) {
          console.log(`💚 [${timeStr}] إشارة شراء للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
          inPositions[symbol] = { symbol, buyPrice: price, buyTime: timeNow, supports: [] };
          savePositions(inPositions);
          sendTelegramMessage(`🟢 إشــارة شــراء جديدة\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n📅 الوقت: ${timeStr}`);
        }

        // إشارة بيع بدعم (مع ذكر جميع التدعيمات السعر والتاريخ)
        else if (sellSignal) {
          console.log(`🔴 [${timeStr}] إشارة بيع تدعيم للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
          const avgBuy = (position.buyPrice + position.supports.reduce((a, s) => a + s.price, 0)) / (1 + position.supports.length);
          const changePercent = ((price - avgBuy) / avgBuy * 100);
          const profit = price - avgBuy;
          const dateStr = timeNow.toISOString().slice(0, 10);
          if (!dailyProfits[dateStr]) dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
          dailyProfits[dateStr].totalProfit += profit;
          if (profit > 0) dailyProfits[dateStr].wins++;
          else if (profit < 0) dailyProfits[dateStr].losses++;

          // تكوين معلومات التدعيمات السابقة
          let supportsInfo = '';
          if (position.supports.length > 0) {
            position.supports.forEach((s, i) => {
              supportsInfo += `➕ تدعيم رقم ${i + 1}: السعر ${s.price}، الوقت ${formatDate(new Date(s.time))}\n`;
            });
            supportsInfo += '\n';
          }

          let message =
            `🔴 إشــارة بيـع\n\n` +
            `🪙 العملة: ${symbol}\n` +
            `💰 سعر الشراء الأساسي: ${position.buyPrice}\n` +
            `📅 وقت الشراء: ${formatDate(position.buyTime)}\n\n` +
            (supportsInfo ? `🛠️ التدعيمات السابقة:\n${supportsInfo}` : '') +
            `💸 سعر البيع: ${price}\n` +
            `📅 وقت البيع: ${timeStr}\n\n` +
            `📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`;

          sendTelegramMessage(message);
          delete inPositions[symbol];
          savePositions(inPositions);
        }

        // إشارة بيع عادي
        else if (sellRegularSignal) {
          console.log(`🔴 [${timeStr}] إشارة بيع عادي للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
          const changePercent = ((price - position.buyPrice) / position.buyPrice * 100);
          const profit = price - position.buyPrice;
          const dateStr = timeNow.toISOString().slice(0, 10);
          if (!dailyProfits[dateStr]) dailyProfits[dateStr] = { totalProfit: 0, wins: 0, losses: 0 };
          dailyProfits[dateStr].totalProfit += profit;
          if (profit > 0) dailyProfits[dateStr].wins++;
          else if (profit < 0) dailyProfits[dateStr].losses++;
          const message = `🔴 إشــارة بيع عادي\n\n🪙 العملة: ${symbol}\n💰 سعر الشراء: ${position.buyPrice}\n📅 وقت الشراء: ${formatDate(position.buyTime)}\n\n💸 سعر البيع: ${price}\n📅 وقت البيع: ${timeStr}\n\n📊 الربح/الخسارة: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
          sendTelegramMessage(message);
          delete inPositions[symbol];
          savePositions(inPositions);
        }

        // وقف خسارة بيع
        else if (position && price <= position.buyPrice * 0.92) {
          const dateStr = formatDate(timeNow);
          let supportsInfo = '';
          const maxSupports = 3;
          position.supports.slice(0, maxSupports).forEach((s, i) => {
            supportsInfo += `➕ سعر التدعيم ${i + 1}: ${s.price}\n📅 وقت التدعيم ${i + 1}: ${formatDate(s.time)}\n\n`;
          });
          const message =
            `🔴 بيـع بوقـف خسـارة\n\n🪙 العملة: ${symbol}\n` +
            `💰 سعر الشراء الأساسي: ${position.buyPrice}\n\n` +
            supportsInfo +
            `💸 سعر البيع (نسبة 8% خسارة أو أكثر): ${price}\n` +
            `📅 وقت البيع: ${dateStr}`;
          sendTelegramMessage(message);
          console.log(`🔴 [${dateStr}] بيع بوقف خسارة للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
          delete inPositions[symbol];
          savePositions(inPositions);
        }

        // تدعيم شراء (شرط: هبوط 1.7% + تحقق buySignal) مع إضافة رقم التدعيم في الرسالة
        else if (position && price <= position.buyPrice * (1 - PRICE_DROP_SUPPORT) && buySignal) {
          const lastSupport = position.supports[position.supports.length - 1];
          const basePrice = lastSupport ? lastSupport.price : position.buyPrice;
          if (price <= basePrice * (1 - PRICE_DROP_SUPPORT)) {
            const supportNumber = position.supports.length + 1;
            console.log(`🟠 [${timeStr}] إشارة تدعيم شراء رقم ${supportNumber} للرمز ${symbol} عند السعر ${price} [RUN_ID: ${RUN_ID}]`);
            position.supports.push({ price, time: timeNow });
            savePositions(inPositions);
            sendTelegramMessage(`🟠 تــدعيـم للشراء رقم ${supportNumber}\n\n🪙 العملة: ${symbol}\n💰 السعر: ${price}\n📅 الوقت: ${timeStr}`);
          }
        }

      } catch (error) {
        console.error(`⚠️ خطأ في تحليل ${symbol}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`⚠️ خطأ في قراءة coins.json أو أثناء التحليل: ${error.message}`);
  } finally {
    isAnalyzing = false;
  }
}

// جدولة تحليل كل دقيقة كما في الأصل
cron.schedule('*/1 * * * *', async () => {
  try {
    console.log(`⏳ جاري التحليل... [RUN_ID: ${RUN_ID}]`);
    await analyze();
  } catch (error) {
    console.error('⚠️ خطأ أثناء التحليل:', error);
  }
});

// كود polling لتسجيل المستخدمين تلقائيًا من تحديثات Telegram مع تسجيل الوقت (كما هو في الأصل)

let offset = 0;

async function polling() {
  while (true) {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`,
        { params: { offset: offset + 1, timeout: 30 } }
      );
      const updates = response.data.result;

      for (const update of updates) {
        offset = update.update_id;

        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text || '';

          if (!registeredUsers.includes(chatId)) {
            registeredUsers.push(chatId);
            saveUsers();
            console.log(`[${new Date().toISOString()}] ➕ تم تسجيل مستخدم جديد بالمعرف: ${chatId}`);
          }

          if (text.toLowerCase() === '/start') {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
              chat_id: chatId,
              text: 'مرحبًا! تم تسجيلك بنجاح في البوت.',
              parse_mode: 'Markdown',
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ خطأ في جلب التحديثات:', error.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// بدء التحميل والتشغيل
loadUsers();
polling().catch(console.error);
