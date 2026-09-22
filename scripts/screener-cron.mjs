import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function sendDiscordSummary(output, spy3mo) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
        console.log("No valid DISCORD_WEBHOOK_URL found. Skipping Discord broadcast.");
        return;
    }

    const matches = output.matches || [];
    const count = matches.length;
    const isZero = count === 0;
    const color = isZero ? 0x64748b : 0x10b981; // Slate gray if 0, Emerald green if matches

    const fields = [
        {
            name: "🔍 Universe Scanned",
            value: `${output.total_scanned?.toLocaleString() || "6,000+"} US Tickers`,
            inline: true
        },
        {
            name: "🎯 Model Book Leaders",
            value: isZero ? "0 Stocks (Cash Posture)" : `${count} Qualified Setups`,
            inline: true
        },
        {
            name: "📊 S&P 500 (3M Perf)",
            value: spy3mo !== null && spy3mo !== undefined ? `${spy3mo >= 0 ? "+" : ""}${spy3mo.toFixed(1)}%` : "N/A",
            inline: true
        }
    ];

    if (isZero) {
        fields.push({
            name: "🛡️ Institutional Regime Guidance",
            value: "No stocks passed the strict Model Book Dual-Filter (Stage-2 / IPO Base + Smashed 10/21 MA + VCP Dry-Up + Breakdown Shield). Capital preservation active.",
            inline: false
        });
    } else {
        const topMatches = matches.slice(0, 8);
        topMatches.forEach((m, idx) => {
            const badge = m.setup_type === 'Launchpad Coil' ? '🟢 COIL' : (m.setup_type === 'Power Trend Flag' ? '🚀 FLAG' : '🌟 IPO');
            fields.push({
                name: `${idx + 1}. [${badge}] ${m.ticker} · $${m.price?.toFixed(2)} (${m.sector || m.industry || "Leader"})`,
                value: `📉 Base: **${m.base_depth}** | ⚡ 10/21 Spread: **${m.spread_10_21?.toFixed(1)}%** | 3M RS: **+${m.relative_strength_3mo?.toFixed(1)}%** | EPS: **+${((m.eps_growth || 0) * 100).toFixed(0)}%**`,
                inline: false
            });
        });
        if (matches.length > 8) {
            fields.push({
                name: "➕ Additional Setups",
                value: `Plus ${matches.length - 8} more candidates on the live dashboard.`,
                inline: false
            });
        }
    }

    const payload = {
        username: "Model Book Pro · Daily Screener",
        avatar_url: "https://assets.marketleaders.trade/favicon.ico",
        embeds: [
            {
                title: isZero 
                    ? "🛡️ Daily Market Screener: 0 Setups (Capital Preservation)" 
                    : `🚀 Daily Market Screener: ${count} Model Book Leaders Detected!`,
                description: isZero
                    ? "The evening institutional scan has completed across all US equities. No candidates passed the Model Book criteria today."
                    : `The evening scan found **${count} stocks** coiling at actionable institutional launchpads (Stage-2 / IPO Base + Smashed Moving Averages + Volume Dry-Up).`,
                color,
                fields,
                footer: {
                    text: "Model Book Pro · Institutional O'Neil / Minervini / Qullamaggie Engine"
                },
                timestamp: new Date().toISOString()
            }
        ]
    };

    try {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            console.log("✅ Successfully broadcasted Daily Screener Digest to Discord!");
        } else {
            console.warn("Discord API returned status:", res.status, await res.text());
        }
    } catch (err) {
        console.error("Error sending to Discord:", err.message);
    }
}

async function fetchAllUSTickers() {
    try {
        console.log("Downloading the master list of all US Market Tickers...");
        const res = await fetch("https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/all/all_tickers.txt");
        const text = await res.text();
        const tickers = text.split('\n')
            .map(t => t.trim())
            .filter(t => t.length > 0 && !t.includes('-') && !t.includes('.') && !t.endsWith('W') && !t.endsWith('U')); 
        console.log(`Successfully loaded ${tickers.length} master tickers.`);
        return tickers;
    } catch (e) {
        return ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "PLTR", "APP", "MSTR", "HOOD", "CAVA", "VST", "UBER"];
    }
}

async function fetchYahooData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.chart.result) return null;

    const data = json.chart.result[0];
    const quotes = data.indicators.quote[0];
    const timestamps = data.timestamp;
    if (!timestamps || timestamps.length === 0) return null;

    const history = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (quotes.close[i] !== null && quotes.volume[i] !== null && quotes.high[i] !== null && quotes.low[i] !== null) {
            history.push({
                date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                open: quotes.open[i],
                high: quotes.high[i],
                low: quotes.low[i],
                close: quotes.close[i],
                volume: quotes.volume[i]
            });
        }
    }
    return { history, meta: data.meta };
  } catch (e) {
    return null;
  }
}

function calculateSMA(data, period, key = 'close') {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    const sum = slice.reduce((acc, curr) => acc + curr[key], 0);
    return sum / period;
}

function calculateEMA(data, period, key = 'close') {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data[0][key];
    for (let i = 1; i < data.length; i++) {
        ema = (data[i][key] - ema) * k + ema;
    }
    return ema;
}

function calculatePerformance(data, daysAgo) {
    if (data.length <= daysAgo) return null;
    const pastPrice = data[data.length - 1 - daysAgo].close;
    const currentPrice = data[data.length - 1].close;
    return ((currentPrice - pastPrice) / pastPrice) * 100;
}

async function run() {
    console.log(`Fetching S&P 500 Market Benchmark (SPY)...`);
    const spyDataResult = await fetchYahooData('SPY');
    if (!spyDataResult) return;
    const spyData = spyDataResult.history;
    const spy3mo = calculatePerformance(spyData, 63);

    const tickers = await fetchAllUSTickers();
    console.log(`Starting Technical Scan on ${tickers.length} tickers...`);

    let techMatches = [];
    const batchSize = 25;
    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch = tickers.slice(i, i + batchSize);
        if (i % 500 === 0) console.log(`Scanning progress: ${i} / ${tickers.length}...`);

        await Promise.all(batch.map(async (ticker) => {
            const result = await fetchYahooData(ticker);
            // Must have at least 30 trading days of history
            if (result && result.history.length >= 30) {
                const data = result.history;
                const meta = result.meta;
                const current = data[data.length - 1];

                // 1. Strict Liquidity Floor: Minimum $10 price and $20M/day institutional liquidity
                if (current.close < 10.0 || current.volume < 150000) return;

                const volSma20 = calculateSMA(data, 20, 'volume');
                if (!volSma20) return;
                const dollarVol20m = (volSma20 * current.close) / 1000000;
                if (dollarVol20m < 20.0) return; // Must trade >= $20M daily

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
                    if (!trendUp) return;
                } else {
                    // IPO Base Rule: Price > 50 SMA (if >= 50 bars exist)
                    if (sma50 && current.close <= sma50) return;
                }

                // 3. Launchpad Power Trend Stack: Price >= 10-DMA >= 21-EMA
                if (!dma10 || !ema21 || current.close < dma10 || current.close < ema21 || dma10 < ema21) {
                    return;
                }

                // 4. Base Depth Calibration: Max 35.0% Drawdown from 52-Week High (Empirical Model Book Depth)
                const lookback = Math.min(data.length, 252);
                const high52 = meta.fiftyTwoWeekHigh || Math.max(...data.slice(-lookback).map(d => d.high));
                const distanceFromHigh = ((high52 - current.close) / high52) * 100;
                if (distanceFromHigh > 35.0) return;

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
                if (trapTriggered) return;

                // 6. Smashed Moving Averages Calibration
                // 10-to-21 spread <= 3.0%, 10-to-50 spread <= 12.0%
                const spread_10_21 = (Math.abs(dma10 - ema21) / ema21) * 100;
                const spread_10_50 = sma50 ? (Math.abs(dma10 - sma50) / sma50) * 100 : 0;
                if (spread_10_21 > 3.0) return;
                if (sma50 && spread_10_50 > 12.0) return;

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
                if (todayRange > avgRange10 || avgRange3 > avgRange20) return;

                // 8. Volume Dry-Up Ratio (< 1.0x 20d Volume SMA)
                if (current.volume >= volSma20) return;
                const volRatio = current.volume / volSma20;

                // 9. Daily Closing Range >= 45% (Closes near highs)
                const dcr = (current.high - current.low) > 0 ? (current.close - current.low) / (current.high - current.low) : 0.5;
                if (dcr < 0.45) return;

                // 10. Performance & Volatility
                const stock3mo = calculatePerformance(data, Math.min(data.length - 1, 63)) || 0;
                const adr = (data.slice(-20).reduce((sum, d) => sum + ((d.high - d.low) / d.close), 0) / Math.min(data.length, 20)) * 100;

                techMatches.push({
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
                    relative_strength_3mo: spy3mo !== null ? (stock3mo - spy3mo) : stock3mo
                });
            }
        }));
        await new Promise(r => setTimeout(r, 150));
    }

    console.log(`\nTechnical Scan found ${techMatches.length} Model Book candidates.`);
    console.log(`Starting FUNDAMENTAL Validation phase...`);

    let finalMatches = [];

    for (const match of techMatches) {
        try {
            const summary = await yf.quoteSummary(match.ticker, { modules: ['financialData', 'defaultKeyStatistics', 'calendarEvents', 'summaryProfile'] });
            const epsGrowth = summary?.financialData?.earningsGrowth || 0;
            const revGrowth = summary?.financialData?.revenueGrowth || 0;

            const shortPercent = summary?.defaultKeyStatistics?.shortPercentOfFloat || 0;
            const floatShares = summary?.defaultKeyStatistics?.floatShares || 0;
            const sector = summary?.summaryProfile?.sector || "Unknown";
            const industry = summary?.summaryProfile?.industry || "Unknown";

            let earningsRisk = false;
            let earningsDateStr = "Unknown";
            if (summary?.calendarEvents?.earnings?.earningsDate && summary.calendarEvents.earnings.earningsDate.length > 0) {
                const ed = new Date(summary.calendarEvents.earnings.earningsDate[0]);
                earningsDateStr = ed.toISOString().split('T')[0];

                const today = new Date();
                const diffTime = ed - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // Exclude if earnings are in the next 7 days
                if (diffDays >= 0 && diffDays <= 7) {
                    earningsRisk = true;
                    console.log(`Skipping ${match.ticker} - Earnings in ${diffDays} days (${earningsDateStr})`);
                }
            }

            // MODEL BOOK FUNDAMENTAL CRITERIA:
            // 1. Standard: >= 20% EPS Growth OR >= 20% Revenue Growth
            // 2. IPO / Hypergrowth exception: If IPO or high relative strength (RS > 50%), allow if sales > 15%
            const passesFundamentals = (epsGrowth >= 0.20 || revGrowth >= 0.20) || (match.is_ipo && (revGrowth >= 0.15 || match.relative_strength_3mo > 40));

            if (passesFundamentals) {
                if (!earningsRisk) {
                    finalMatches.push({
                        ...match,
                        eps_growth: epsGrowth,
                        rev_growth: revGrowth,
                        short_percent: shortPercent,
                        float_shares: floatShares,
                        sector: sector,
                        industry: industry,
                        earnings_date: earningsDateStr
                    });
                }
                console.log(`[PASS] ${match.ticker} (${match.setup_type}) - EPS: ${(epsGrowth*100).toFixed(1)}%, Rev: ${(revGrowth*100).toFixed(1)}%`);
            } else {
                console.log(`[REJECTED] ${match.ticker} - Failed Fundamental Test (EPS: ${(epsGrowth*100).toFixed(1)}%, Rev: ${(revGrowth*100).toFixed(1)}%)`);
            }
        } catch (e) {
            // If fundamentals cannot be fetched, preserve if technical setup is an A+ Launchpad Coil
            if (match.setup_type === 'Launchpad Coil' && match.relative_strength_3mo > 30) {
                finalMatches.push(match);
                console.log(`[PRESERVED] ${match.ticker} - Pure Technical A+ Coil (No fundamentals available)`);
            } else {
                console.log(`[SKIP] ${match.ticker} - Could not fetch fundamentals.`);
            }
        }
        await new Promise(r => setTimeout(r, 300));
    }

    const output = {
        timestamp: new Date().toISOString(),
        total_scanned: tickers.length,
        matches: finalMatches
    };

    const outPath = path.join(process.cwd(), 'public', 'market-state.json');
    if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Saved results. Found ${finalMatches.length} stocks that passed BOTH Technicals and Fundamentals.`);

    await sendDiscordSummary(output, spy3mo);
}

run();
