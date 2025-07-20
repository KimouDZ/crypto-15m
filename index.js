import ccxt from 'ccxt';
import axios from 'axios';
import cron from 'node-cron';
import fs from 'fs';

const TELEGRAM_TOKEN = '8161859979:AAFlliIFMfGNlr_xQUlxF92CgDX00PaqVQ8';
const CHAT_ID = '1055739217';
const INTERVAL = '15m'; // شارت 15 دقيقة
const ANALYSIS_INTERVAL_MINUTES = 2;

const exchange = new ccxt.binance();
const stateFile = './state.json';
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};

const coins = [ 
  "TON/USDT","PENGU/USDT","CRO/USDT","1000CHEEMS/USDT", "1000SATS/USDT", "1INCH/USDT", "1MBABYDOGE/USDT", "A/USDT", "AAVE/USDT", "ACH/USDT", "ACX/USDT", "ADA/USDT", "AEVO/USDT", "AIXBT/USDT", "ALGO/USDT", "ALICE/USDT", "ALPINE/USDT", "ALT/USDT", "AMP/USDT", "ANIME/USDT", "ANKR/USDT", "APE/USDT", "API3/USDT", "APT/USDT", "ARB/USDT", "ARDR/USDT", "ARKM/USDT", "ARPA/USDT", "AR/USDT", "ASR/USDT", "ASTR/USDT", "ATA/USDT", "ATOM/USDT", "AUCTION/USDT", "AUDIO/USDT", "AVA/USDT", "AVAX/USDT", "AWE/USDT", "AXL/USDT", "AXS/USDT", "BABY/USDT", "BAKE/USDT", "BAND/USDT", "BAR/USDT", "BAT/USDT", "BEAMX/USDT", "BEL/USDT", "BERA/USDT", "BCH/USDT", "BICO/USDT", "BIF/USDT", "BIGTIME/USDT", "BIO/USDT", "BLUR/USDT", "BNB/USDT", "BONK/USDT", "BOME/USDT", "BTC/USDT", "BTTC/USDT", "CAKE/USDT", "CELER/USDT", "CELO/USDT", "CFX/USDT", "CHESS/USDT", "CHR/USDT", "CHZ/USDT", "CITY/USDT", "CKB/USDT", "COMP/USDT", "COOKIE/USDT", "COS/USDT", "COTI/USDT", "COW/USDT", "CRV/USDT", "CTK/USDT", "CTSI/USDT", "CVC/USDT", "CVX/USDT", "CYBER/USDT", "DASH/USDT", "DATA/USDT", "DCR/USDT", "DEGO/USDT", "DENT/USDT", "DEXE/USDT", "DF/USDT", "DGB/USDT", "DIA/USDT", "DODO/USDT", "DOGE/USDT", "DOT/USDT", "DUSK/USDT", "DYDX/USDT", "DYM/USDT", "EDU/USDT", "EGLD/USDT", "EIGEN/USDT", "ENA/USDT", "ENJ/USDT", "ENS/USDT", "ETHFI/USDT", "ETH/USDT", "ETH/USDC", "ETC/USDT", "EUR/USDT", "FARMB/USDT", "FDUSD/USDT", "FET/USDT", "FIDA/USDT", "FIL/USDT", "FIO/USDT", "FIRO/USDT", "FIS/USDT", "FLM/USDT", "FLOKI/USDT", "FLOW/USDT", "FLUX/USDT", "FORM/USDT", "FORTH/USDT", "FUN/USDT", "FUNFAIR/USDT", "FXS/USDT", "GALA/USDT", "GAS/USDT", "GHST/USDT", "GLM/USDT", "GLMR/USDT", "GMX/USDT", "GNS/USDT", "GNO/USDT", "GMT/USDT", "GRT/USDT", "GTC/USDT", "HBAR/USDT", "HIGH/USDT", "HIVE/USDT", "HOOK/USDT", "HOT/USDT", "ICI/USDT", "ICP/USDT", "ICX/USDT", "IDEX/USDT", "ID/USDT", "ILV/USDT", "IMX/USDT", "INJ/USDT", "IOST/USDT", "IOTX/USDT", "IO/USDT", "IOTA/USDT", "JASMY/USDT", "JOEB/USDT", "JST/USDT", "JTO/USDT", "JUV/USDT", "KAIA/USDT", "KAITO/USDT", "KASPA/USDT", "KAVA/USDT", "KDA/USDT", "KNC/USDT", "KSM/USDT", "LAZIO/USDT", "LAYER/USDT", "LDO/USDT", "LILPEPE/USDT", "LINK/USDT", "LOKAUSDT", "LQTY/USDT", "LRC/USDT", "LSK/USDT", "LTC/USDT", "LUNA/USDT", "LUNC/USDT", "MAGIC/USDT", "MANA/USDT", "MANTA/USDT", "MASK/USDT", "MAV/USDT", "MBL/USDT", "MBOX/USDT", "MDT/USDT", "ME/USDT", "MEME/USDT", "METIS/USDT", "MINA/USDT", "MKR/USDT", "MLN/USDT", "MOVR/USDT", "MOVE/USDT", "MTL/USDT", "NEAR/USDT", "NEIRO/USDT", "NEO/USDT", "NEXO/USDT", "NFP/USDT", "NKN/USDT", "NOT/USDT", "NTRN/USDT", "NXR/USDT", "OGN/USDT", "OG/USDT", "OMNI/USDT", "OM/USDT", "ONE/USDT", "ONG/USDT", "ONDO/USDT", "ONT/USDT", "OP/USDT", "ORCA/USDT", "ORDI/USDT", "OSMO/USDT", "PAXG/USDT", "PEPE/USDT", "PENDLE/USDT", "PEOPLE/USDT", "PERP/USDT", "PHA/USDT", "PHB/USDT", "PIXEL/USDT", "PNUT/USDT", "POL/USDT", "POLY/USDT", "POND/USDT", "PORTO/USDT", "POWR/USDT", "PROM/USDT", "PSG/USDT", "PUNDIX/USDT", "PYR/USDT", "PYTH/USDT", "QKC/USDT", "QNT/USDT", "QTUM/USDT", "QUICK/USDT", "QI/USDT", "QIXT/USDT", "RAD/USDT", "RARE/USDT", "RAY/USDT", "RDNT/USDT", "REI/USDT", "RENDER/USDT", "REQ/USDT", "RIF/USDT", "RLC/USDT", "RONIN/USDT", "ROSE/USDT", "RPL/USDT", "RSR/USDT", "RUNE/USDT", "RVN/USDT", "SAGA/USDT", "SAHARA/USDT", "SAND/USDT", "SANTOS/USDT", "SC/USDT", "SCRT/USDT", "SEI/USDT", "SFP/USDT", "SHIB/USDT", "SIGN/USDT", "SKL/USDT", "SLP/USDT", "SNX/USDT", "SOL/USDT", "SPELL/USDT", "SSV/USDT", "STG/USDT", "STORJ/USDT", "STRAX/USDT", "STRK/USDT", "STX/USDT", "SUI/USDT", "SUN/USDT", "SUPER/USDT", "SUSHI/USDT", "S/USDT", "SXP/USDT", "SYN/USDT", "SYS/USDT", "T/USDT", "TAO/USDT", "TFUEL/USDT", "THETA/USDT", "TIA/USDT", "TKO/USDT", "TLM/USDT", "TRB/USDT", "TRU/USDT", "TRUMP/USDT", "TRX/USDT", "TUSD/USDT", "TWT/USDT", "UMA/USDT", "UNI/USDT", "USTC/USDT", "UTK/USDT", "VANA/USDT", "VANY/USDT", "VET/USDT", "VOXEL/USDT", "VTHO/USDT", "W/USDT", "WAN/USDT", "WAXP/USDT", "WIF/USDT", "WINKS/USDT", "WLD/USDT", "WOO/USDT", "XAI/USDT", "XDC/USDT", "XEC/USDT", "XLM/USDT", "XNO/USDT", "XRP/USDT", "XTZ/USDT", "XVG/USDT", "XVS/USDT", "YFI/USDT", "YGG/USDT", "ZEC/USDT", "ZEN/USDT", "ZETA/USDT", "ZIL/USDT", "ZK/USDT", "ZRX/USDT" ];

function sendTelegramMessage(message) {
  return axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: "Markdown"
  });
}

function formatPercent(p) {
  return `${(p >= 0 ? '+' : '')}${(p * 100).toFixed(2)}%`;
}

function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const rsiPeriod = 10;
  const bbPeriod = 15;
  const bbMultiplier = 2;

  const gains = [];
  const losses = [];
  for (let i = 1; i <= rsiPeriod; i++) {
    const change = closes[closes.length - i] - closes[closes.length - i - 1];
    if (change >= 0) gains.push(change);
    else losses.push(-change);
  }

  const avgGain = gains.reduce((a, b) => a + b, 0) / rsiPeriod;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / rsiPeriod;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  const bbCloses = closes.slice(-bbPeriod);
  const bbAvg = bbCloses.reduce((a, b) => a + b, 0) / bbPeriod;
  const std = Math.sqrt(bbCloses.reduce((a, b) => a + Math.pow(b - bbAvg, 2), 0) / bbPeriod);
  const upper = bbAvg + bbMultiplier * std;
  const lower = bbAvg - bbMultiplier * std;
  const lastClose = closes[closes.length - 1];
  const percentB = (lastClose - lower) / (upper - lower);

  return { rsi, percentB, closes };
}

function calculateMACD(closes, fast, slow, signal) {
  function ema(length, data) {
    const k = 2 / (length + 1);
    let ema = data.slice(0, length).reduce((a, b) => a + b) / length;
    for (let i = length; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  const macdLine = ema(fast, closes) - ema(slow, closes);
  const signalLine = ema(signal, closes);
  return { macdLine, signalLine };
}

async function analyzeMarket() {
  for (const symbol of coins) {
    try {
      const market = await exchange.loadMarkets();
      const ohlcv = await exchange.fetchOHLCV(symbol, INTERVAL, undefined, 100);
      const candles = ohlcv.map(c => ({
        time: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5]
      }));

      const { rsi, percentB, closes } = calculateIndicators(candles);

      const macdBuy = calculateMACD(closes, 1, 10, 4);
      const macdSell = calculateMACD(closes, 1, 100, 8);
      const prevBuy = calculateMACD(closes.slice(0, -1), 1, 10, 4);
      const prevSell = calculateMACD(closes.slice(0, -1), 1, 100, 8);

      const inTrade = state[symbol];

      // شراء
      if (!inTrade && rsi < 45 && percentB < 0.2 && prevBuy.macdLine < prevBuy.signalLine && macdBuy.macdLine > macdBuy.signalLine) {
        const price = closes[closes.length - 1];
        state[symbol] = { buyPrice: price, time: Date.now() };
        await sendTelegramMessage(`🟢 *شراء ${symbol}*\nالوقت: ${new Date().toLocaleString()}\nالسعر: *${price.toFixed(4)} USDT*`);
        fs.writeFileSync(stateFile, JSON.stringify(state));
      }

      // بيع
      if (inTrade && prevSell.macdLine > prevSell.signalLine && macdSell.macdLine < macdSell.signalLine) {
        const sellPrice = closes[closes.length - 1];
        const profit = (sellPrice - inTrade.buyPrice) / inTrade.buyPrice;
        await sendTelegramMessage(`🔴 *بيع ${symbol}*\nالوقت: ${new Date().toLocaleString()}\nالسعر: *${sellPrice.toFixed(4)} USDT*\nالربح: *${formatPercent(profit)}*`);
        delete state[symbol];
        fs.writeFileSync(stateFile, JSON.stringify(state));
      }

    } catch (e) {
      console.log(`⚠️ خطأ في تحليل ${symbol}: ${e.message}`);
    }
  }
}

// يعمل كل دقيقتين
cron.schedule(`*/${ANALYSIS_INTERVAL_MINUTES} * * * *`, () => {
  console.log("⏳ بدء التحليل...");
  analyzeMarket();
});

// تحليل عند بداية التشغيل
analyzeMarket();
