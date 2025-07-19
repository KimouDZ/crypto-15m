import fs from "fs";
import axios from "axios";
import cron from "node-cron";

const coins = JSON.parse(fs.readFileSync("./coins.json", "utf8"));
const TELEGRAM_TOKEN = "8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8";
const CHAT_ID = "1055739217"; // معرف الشات الخاص بك

// RSI لحساب القوة النسبية من آخر 15 شمعة
function rsi(values, period = 14) {
    let gains = 0, losses = 0;
    for (let i = values.length - period - 1; i < values.length - 1; i++) {
        const diff = values[i + 1] - values[i];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const rs = gains / (losses || 1);
    return 100 - (100 / (1 + rs));
}

// %B لحساب نسبة موقع السعر داخل البولنجر باند
function percentB(close, upper, lower) {
    return (close - lower) / (upper - lower);
}

// MACD
function macd(closes, fast = 1, slow = 50, signal = 20) {
    const ema = (length, data) => {
        const k = 2 / (length + 1);
        let ema = data[0];
        const result = [ema];
        for (let i = 1; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
            result.push(ema);
        }
        return result;
    };
    const macdLine = ema(fast, closes).map((v, i) => v - ema(slow, closes)[i]);
    const signalLine = ema(signal, macdLine);
    return { macdLine, signalLine };
}

// إرسال تنبيه إلى Telegram
async function sendAlert(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: CHAT_ID, text });
}

// تحليل عملة واحدة
async function analyze(symbol) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=100`;
        const res = await axios.get(url);
        const data = res.data;

        const closes = data.map(c => parseFloat(c[4]));
        const rsiValue = rsi(closes.slice(-15));

        const bbPeriod = 20;
        const recentCloses = closes.slice(-bbPeriod);
        const mean = recentCloses.reduce((a, b) => a + b) / bbPeriod;
        const std = Math.sqrt(recentCloses.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / bbPeriod);
        const upper = mean + 2 * std;
        const lower = mean - 2 * std;
        const pB = percentB(closes[closes.length - 1], upper, lower);

        const buyMACD = macd(closes, 1, 50, 20);
        const sellMACD = macd(closes, 1, 100, 8);

        const macdLine = buyMACD.macdLine;
        const signalLine = buyMACD.signalLine;
        const prevMACD = macdLine[macdLine.length - 2];
        const currMACD = macdLine[macdLine.length - 1];
        const prevSig = signalLine[signalLine.length - 2];
        const currSig = signalLine[signalLine.length - 1];

        const macdUp = prevMACD < prevSig && currMACD > currSig;

        const macdLineSell = sellMACD.macdLine;
        const signalLineSell = sellMACD.signalLine;
        const prevMACDSell = macdLineSell[macdLineSell.length - 2];
        const currMACDSell = macdLineSell[macdLineSell.length - 1];
        const prevSigSell = signalLineSell[signalLineSell.length - 2];
        const currSigSell = signalLineSell[signalLineSell.length - 1];

        const macdDown = prevMACDSell > prevSigSell && currMACDSell < currSigSell;

        if (rsiValue < 45 && pB < 0.4 && macdUp) {
            await sendAlert(`✅ إشارة شراء على ${symbol}`);
        } else if (macdDown) {
            await sendAlert(`❌ إشارة بيع على ${symbol}`);
        }

    } catch (error) {
        console.error(`خطأ في ${symbol}:`, error.message);
    }
}

// تحليل كل العملات كل دقيقة
cron.schedule("* * * * *", async () => {
    console.log("🔁 جاري التحليل...");
    for (const symbol of coins) {
        await analyze(symbol);
    }
});
