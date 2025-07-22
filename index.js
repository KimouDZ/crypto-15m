// ... (نفس الاستيرادات والتهيئة السابقة)

const analyzeSymbol = async (symbol) => {
  try {
    const market = await exchange.loadMarkets();
    if (!market[symbol]) {
      console.warn(`⚠️ الزوج غير موجود على Binance: ${symbol}`);
      return;
    }

    const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 200);
    const closes = ohlcv.map(c => c[4]);

    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
    const lastRSI = rsi[rsi.length - 1];

    const bb = technicalindicators.BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes
    });
    const lastBB = bb[bb.length - 1];
    const percentB = (closes[closes.length - 1] - lastBB.lower) / (lastBB.upper - lastBB.lower);

    const macdBuy = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 2,
      signalPeriod: 2,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const macdSell = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 1,
      slowPeriod: 10,
      signalPeriod: 2,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const lastMACD_Buy = macdBuy[macdBuy.length - 1];
    const prevMACD_Buy = macdBuy[macdBuy.length - 2];
    const lastMACD_Sell = macdSell[macdSell.length - 1];
    const prevMACD_Sell = macdSell[macdSell.length - 2];

    const buySignal = (
      lastRSI < 40 &&
      percentB < 0.4 &&
      prevMACD_Buy.MACD < prevMACD_Buy.signal &&
      lastMACD_Buy.MACD > lastMACD_Buy.signal
    );

    const sellSignal = (
      state[symbol]?.hasPosition &&
      lastRSI > 55 &&
      prevMACD_Sell.MACD > prevMACD_Sell.signal &&
      lastMACD_Sell.MACD < lastMACD_Sell.signal
    );

    // ✅ احصل على "وقت الشمعة" بدقة (آخر شمعة)
    const lastCandleTime = ohlcv[ohlcv.length - 1][0]; // timestamp in ms
    const nowFormatted = new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' });

    if (buySignal && !state[symbol]?.hasPosition) {
      if (state[symbol]?.lastBuyCandle === lastCandleTime) {
        console.log(`⏸️ تم تجاهل إشارة شراء مكررة لـ ${symbol} في نفس الشمعة`);
        return;
      }

      const price = closes[closes.length - 1];
      state[symbol] = {
        hasPosition: true,
        entryPrice: price,
        entryTime: nowFormatted,
        lastBuyCandle: lastCandleTime
      };

      await sendTelegramMessage(`🟢 <b>إشارة شراء</b>\n\n🪙 العملة: <b>${symbol}</b>\n💰 السعر: <b>${price.toFixed(4)}</b>\n🕒 الوقت: <b>${nowFormatted}</b>\n\n🔔 سيتم الانتظار لإشارة بيع...`);
    }

    if (sellSignal) {
      if (state[symbol]?.lastSellCandle === lastCandleTime) {
        console.log(`⏸️ تم تجاهل إشارة بيع مكررة لـ ${symbol} في نفس الشمعة`);
        return;
      }

      const price = closes[closes.length - 1];
      const entry = state[symbol];
      const profitPercent = ((price - entry.entryPrice) / entry.entryPrice) * 100;

      await sendTelegramMessage(`🔴 <b>إشارة بيع</b>\n\n🪙 العملة: <b>${symbol}</b>\n💰 سعر الشراء: <b>${entry.entryPrice.toFixed(4)}</b>\n🕒 وقت الشراء: <b>${entry.entryTime}</b>\n💸 سعر البيع: <b>${price.toFixed(4)}</b>\n📊 الربح/الخسارة: <b>${profitPercent.toFixed(2)}%</b>\n🕒 وقت البيع: <b>${nowFormatted}</b>`);

      state[symbol] = {
        hasPosition: false,
        lastSellCandle: lastCandleTime
      };
    }
  } catch (err) {
    console.error(`⚠️ خطأ في تحليل ${symbol}: ${err.message}`);
  }
};
