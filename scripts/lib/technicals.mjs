// Model Book technical rules, shared by the daily screener and the
// track-record backfill so both apply exactly the same filters.

export function calculateSMA(data, period, key = 'close') {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    const sum = slice.reduce((acc, curr) => acc + curr[key], 0);
    return sum / period;
}

export function calculateEMA(data, period, key = 'close') {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data[0][key];
    for (let i = 1; i < data.length; i++) {
        ema = (data[i][key] - ema) * k + ema;
    }
    return ema;
}

export function calculatePerformance(data, daysAgo) {
    if (data.length <= daysAgo) return null;
    const pastPrice = data[data.length - 1 - daysAgo].close;
    const currentPrice = data[data.length - 1].close;
    return ((currentPrice - pastPrice) / pastPrice) * 100;
}

// Returns the match object for `ticker` if the last bar of `data` passes every
// technical filter, otherwise null. `data` must be the daily bars the live
// scan would see (Yahoo range=1y), oldest first. `meta` is Yahoo's chart
// meta; pass {} to derive the 52-week high from `data` instead.
export function evaluateTechnicals(ticker, data, meta = {}, spy3mo = null) {
    if (!data || data.length < 30) return null;
    const current = data[data.length - 1];

    // 1. Strict Liquidity Floor: Minimum $10 price and $20M/day institutional liquidity
    if (current.close < 10.0 || current.volume < 150000) return null;

    const volSma20 = calculateSMA(data, 20, 'volume');
    if (!volSma20) return null;
    const dollarVol20m = (volSma20 * current.close) / 1000000;
    if (dollarVol20m < 20.0) return null; // Must trade >= $20M daily

    // 2. Stage-2 Trend & IPO Leader Exception (< 200 bars)
    const isIpo = data.length < 200;
    const dma10 = calculateSMA(data, 10, 'close');
    const ema21 = calculateEMA(data, 21, 'close');
    const sma50 = data.length >= 50 ? calculateSMA(data, 50, 'close') : null;

    if (!isIpo) {
        const sma150 = calculateSMA(data, 150, 'close');
        const sma200 = calculateSMA(data, 200, 'close');
        const old200Data = data.slice(0, data.length - 20);
        const sma200_20d = calculateSMA(old200Data, 200, 'close');

        const trendUp = (
            sma50 && sma150 && sma200 &&
            current.close > sma50 &&
            sma50 > sma150 &&
            sma150 > sma200 &&
            sma200 > sma200_20d
        );
        if (!trendUp) return null;
    } else {
        // IPO Base Rule: Price > 50 SMA (if >= 50 bars exist)
        if (sma50 && current.close <= sma50) return null;
    }

    // 3. Launchpad Power Trend Stack: Price >= 10-DMA >= 21-EMA
    if (!dma10 || !ema21 || current.close < dma10 || current.close < ema21 || dma10 < ema21) {
        return null;
    }

    // EXTENSION GUARDRAIL (Timing & Lowest Risk Calibration):
    // Reject immediately if price is already stretched away from the moving average pad.
    // Buying extended stocks (> 3.5% from 10-DMA or > 6.5% from 21-EMA) destroys risk/reward.
    const dist10dma = ((current.close - dma10) / dma10) * 100;
    const dist21ema = ((current.close - ema21) / ema21) * 100;
    if (dist10dma > 3.5 || dist21ema > 6.5) {
        return null;
    }

    // 4. Base Depth Calibration: Max 35.0% Drawdown from 52-Week High (Empirical Model Book Depth)
    const lookback = Math.min(data.length, 252);
    const high52 = meta.fiftyTwoWeekHigh || Math.max(...data.slice(-lookback).map(d => d.high));
    const distanceFromHigh = ((high52 - current.close) / high52) * 100;
    if (distanceFromHigh > 35.0) return null;

    // 5. Volume Breakdown Trap (Prior 10 Sessions) - The 100% Failure Shield
    let trapTriggered = false;
    const checkStart = Math.max(0, data.length - 11);
    for (let j = checkStart; j < data.length - 1; j++) {
        const sliceUpToJ = data.slice(0, j + 1);
        const d10_j = calculateSMA(sliceUpToJ, 10, 'close');
        const e21_j = calculateEMA(sliceUpToJ, 21, 'close');
        const vSma_j = calculateSMA(sliceUpToJ, 20, 'volume');
        if (d10_j && e21_j && vSma_j) {
            const bar_j = data[j];
            if ((bar_j.close < d10_j || bar_j.close < e21_j) && bar_j.volume > vSma_j) {
                const breakdownHigh = bar_j.high;
                const cleared = data.slice(j + 1).some(b => b.close > breakdownHigh);
                if (!cleared) {
                    trapTriggered = true;
                    break;
                }
            }
        }
    }
    if (trapTriggered) return null;

    // 6. Smashed Moving Averages Calibration
    // 10-to-21 spread <= 3.0%, 10-to-50 spread <= 12.0%
    const spread_10_21 = (Math.abs(dma10 - ema21) / ema21) * 100;
    const spread_10_50 = sma50 ? (Math.abs(dma10 - sma50) / sma50) * 100 : 0;
    if (spread_10_21 > 3.0) return null;
    if (sma50 && spread_10_50 > 12.0) return null;

    // Archetype Classification:
    let setupType = "Launchpad Coil";
    if (isIpo) {
        setupType = "IPO Base Pivot";
    } else if (spread_10_21 <= 2.2 && spread_10_50 <= 8.0) {
        setupType = "Launchpad Coil";
    } else {
        setupType = "Power Trend Flag";
    }

    // 7. Progressive VCP Range Contraction
    const todayRange = current.high - current.low;
    const avgRange10 = data.slice(-10).reduce((sum, d) => sum + (d.high - d.low), 0) / Math.min(data.length, 10);
    const avgRange3 = data.slice(-3).reduce((sum, d) => sum + (d.high - d.low), 0) / Math.min(data.length, 3);
    const avgRange20 = data.slice(-20).reduce((sum, d) => sum + (d.high - d.low), 0) / Math.min(data.length, 20);
    if (todayRange > avgRange10 || avgRange3 > avgRange20) return null;

    // 8. Volume Dry-Up Ratio (< 1.0x 20d Volume SMA)
    if (current.volume >= volSma20) return null;
    const volRatio = current.volume / volSma20;

    // 9. Daily Closing Range >= 45% (Closes near highs)
    const dcr = (current.high - current.low) > 0 ? (current.close - current.low) / (current.high - current.low) : 0.5;
    if (dcr < 0.45) return null;

    // 10. Performance, Volatility & Timing Calibration
    const stock3mo = calculatePerformance(data, Math.min(data.length - 1, 63)) || 0;
    const adr = (data.slice(-20).reduce((sum, d) => sum + ((d.high - d.low) / d.close), 0) / Math.min(data.length, 20)) * 100;

    // ADR-Normalized Stretch: Distance from 10-DMA must not exceed 0.70x ADR
    const adrStretch = adr > 0 ? (dist10dma / adr) : 0;
    if (adrStretch > 0.70) return null;

    // Base Pivot Analysis: Identify the highest high of the prior 10 sessions (excluding today)
    const pivotLookback = Math.min(10, data.length - 1);
    const recentPivot = Math.max(...data.slice(-pivotLookback - 1, -1).map(d => d.high));
    const distFromPivot = ((current.close - recentPivot) / recentPivot) * 100;

    // Reject if price has already exploded > 2.5% past the recent base pivot
    if (distFromPivot > 2.5) return null;

    // Actionability Status:
    // - READY_AT_PAD: Coiled within 2.2% of 10-DMA (lowest risk entry before explosion)
    // - BREAKING_OUT: Within -0.5% to +2.5% of the pivot level (active breakout)
    let timingStatus = "READY_AT_PAD";
    let timingLabel = "🎯 Ready at Pad";
    if (distFromPivot >= -0.5 && distFromPivot <= 2.5) {
        timingStatus = "BREAKING_OUT";
        timingLabel = "⚡ At Pivot";
    } else if (dist10dma <= 2.2) {
        timingStatus = "READY_AT_PAD";
        timingLabel = "🎯 Ready at Pad";
    } else {
        timingStatus = "COILING";
        timingLabel = "⏳ Coiling";
    }

    // Suggested Stop Loss: Below the 10-DMA or recent 3-day swing low (minimum risk floor)
    const recent3Low = Math.min(...data.slice(-3).map(d => d.low));
    const stopPrice = Math.max(recent3Low, dma10 * 0.985);
    const stopPct = Math.max(1.5, Math.min(6.0, ((current.close - stopPrice) / current.close) * 100));

    return {
        ticker,
        price: current.close,
        dma10,
        ema21,
        sma50,
        base_depth: `-${distanceFromHigh.toFixed(1)}%`,
        spread_10_21,
        spread_10_50,
        vol_ratio: volRatio,
        vol_status: `Dry-Up (${(volRatio * 100).toFixed(0)}%)`,
        setup_type: setupType,
        is_ipo: isIpo,
        adr,
        relative_strength_3mo: spy3mo !== null ? (stock3mo - spy3mo) : stock3mo,
        dist_10dma: dist10dma,
        dist_21ema: dist21ema,
        adr_stretch: adrStretch,
        recent_pivot: recentPivot,
        dist_from_pivot: distFromPivot,
        timing_status: timingStatus,
        timing_label: timingLabel,
        suggested_stop: stopPrice,
        suggested_stop_pct: stopPct
    };
}
