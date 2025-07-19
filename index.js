import fs from "fs";
import axios from "axios";
import cron from "node-cron";

const coins = JSON.parse(fs.readFileSync("./coins.json", "utf8"));
const TELEGRAM_TOKEN = "8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8";
const CHAT_ID = "1055739217";

// تحليل RSI
function rsi(values, period = 14) {
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = values[values.length - 1 - i] - values[values.length - 2 - i];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    let rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

// حساب %B
function percentB(close, bbUpper, bbLower) {
    return (close - bbLower) / (bbUpper - bbLower);
}

// تحليل MACD
function macd(data, fast = 1, slow = 50, signal = 20) {
    const ema = (period, values) => {
        const k = 2 / (period + 1);
        let emaArray = [values[0]];
        for (let i = 1; i < values.length; i++) {
            emaArray.push(values[i] * k + emaArray[i - 1] * (1 - k));
        }
        return emaArray;
    };
    const fastEMA = ema(fast, data);
    const slowEMA = ema(slow, data);
    const macdLine = fastEMA.map((val, i) => val - slowEMA[i]);
    const signalLine = ema(signal, macdLine);
    return { macdLine, signalLine };
}

// إرسال التنبيه
async function sendTelegramAlert(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: CHAT_ID, text });
}

// تحليل كل عملة
async function analyzeCoin(symbol) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=100`;
        const res = await axios.get(url);
        const closes = res.data.map(c => parseFloat(c[4]));
        const highs = res.data.map(c => parseFloat(c[2]));
        const lows = res.data.map(c => parseFloat(c[3]));

        const rsiValue = rsi(closes);
        const bbLen = 20, bbMult = 2;
        const basis = closes.slice(-bbLen).reduce((a, b) => a + b) / bbLen;
        const stdev = Math.sqrt(closes.slice(-bbLen).reduce((a, b) => a + Math.pow(b - basis, 2), 0) / bbLen);
        const upper = basis + bbMult * stdev;
        const lower = basis - bbMult * stdev;
        const pB = percentB(closes[closes.length - 1], upper, lower);

        const buyMACD = macd(closes, 1, 50, 20);
        const macdUp = buyMACD.macdLine.slice(-2)[0] < buyMACD.signalLine.slice(-2)[0]
                    && buyMACD.macdLine.slice(-1)[0] > buyMACD.signalLine.slice(-1)[0];

        const sellMACD = macd(closes, 1, 100, 8);
        const macdDown = sellMACD.macdLine.slice(-2)[0] > sellMACD.signalLine.slice(-2)[0]
                    && sellMACD.macdLine.slice(-1)[0] < sellMACD.signalLine.slice(-1)[0];

        if (rsiValue < 45 && pB < 0.4 && macdUp) {
            await sendTelegramAlert(`🔔 إشارة شراء على ${symbol}`);
        } else if (macdDown) {
            await sendTelegramAlert(`📉 إشارة بيع على ${symbol}`);
        }
    } catch (e) {
        console.error(`خطأ في ${symbol}:`, e.message);
    }
}

// تحليل كل العملات
async function runAnalysis() {
    for (const symbol of coins) {
        await analyzeCoin(symbol);
    }
}

// تشغيل التحليل كل 15 دقيقة
cron.schedule("*/1 * * * *", async () => {
    console.log("تشغيل التحليل...");
    runAnalysis();
});
