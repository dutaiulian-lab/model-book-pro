
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
            name: "🎯 A+ Setups Found",
            value: isZero ? "0 Stocks (Cash Posture)" : `${count} Qualified Leaders`,
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
            value: "No stocks met strict Stage-2 shallow base (<15%), VCP volume dry-up, and >15% fundamental EPS/Rev growth rules today. Capital preservation active.",
            inline: false
        });
    } else {
        const topMatches = matches.slice(0, 8);
        topMatches.forEach((m, idx) => {
            fields.push({
                name: `${idx + 1}. ${m.ticker} · $${m.price?.toFixed(2)} (${m.sector || m.industry || "Leader"})`,
                value: `📉 Base: **${m.base_depth}** | ⚡ 3M RS: **+${m.relative_strength_3mo?.toFixed(1)}%** | 📈 EPS: **+${((m.eps_growth || 0) * 100).toFixed(0)}%** | Rev: **+${((m.rev_growth || 0) * 100).toFixed(0)}%**`,
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
        username: "True Market Leaders Daily Screener",
        avatar_url: "https://assets.marketleaders.trade/favicon.ico",
        embeds: [
            {
                title: isZero 
                    ? "🛡️ Daily Market Screener: 0 Setups (Capital Preservation)" 
                    : `🚀 Daily Market Screener: ${count} A+ Growth Leaders Detected!`,
                description: isZero
                    ? "The evening institutional scan has completed across all US equities. No candidates passed the strict dual-filter test today."
                    : `The evening scan found **${count} stocks** passing the strict technical VCP dry-up + fundamental growth (>15% EPS/Rev) test.`,
                color,
                fields,
                footer: {
                    text: "True Market Leaders · Qullamaggie / Minervini / O'Neil Engine"
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

import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

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
        return ["AAPL", "MSFT", "NVDA", "SPCX", "CRCL"];
    }
}

async function fetchYahooData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.chart.result) return null;
    
    const result = json.chart.result[0];
    const quotes = result.indicators.quote[0];
    
    let validData = [];
    if (!quotes.close) return null;
    for(let i = 0; i < quotes.close.length; i++) {
        if(quotes.close[i] !== null && quotes.low[i] !== null && quotes.volume[i] !== null) {
            validData.push({ 
                close: quotes.close[i], 
                low: quotes.low[i],
                high: quotes.high[i],
                volume: quotes.volume[i] 
            });
        }
    }
    return { history: validData, meta: result.meta };
  } catch (e) {
    return null;
  }
}

function calculateSMA(data, period, key) {
    if(data.length < period) return null;
    let sum = 0;
    for(let i = data.length - period; i < data.length; i++) sum += data[i][key];
    return sum / period;
}

function calculateEMA(data, period) {
    if(data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data[0].close;
    for (let i = 1; i < data.length; i++) ema = (data[i].close - ema) * k + ema;
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
    const batchSize = 20;
    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch = tickers.slice(i, i + batchSize);
        if (i % 500 === 0) console.log(`Scanning progress: ${i} / ${tickers.length}...`);
        
        await Promise.all(batch.map(async (ticker) => {
            const result = await fetchYahooData(ticker);
            if (result && result.history.length > 200) {
                const data = result.history;
                const meta = result.meta;
                const current = data[data.length - 1];
                
                // Champion Trader Floor: Minimum 0 price and 0M/day institutional liquidity
                if (current.close < 10.0 || current.volume < 150000) return;

                const sma50 = calculateSMA(data, 50, 'close');
                const sma150 = calculateSMA(data, 150, 'close');
                const sma200 = calculateSMA(data, 200, 'close');
                const ema21 = calculateEMA(data, 21);
                
                const old200SMAData = data.slice(0, data.length - 20);
                const sma200_20days_ago = calculateSMA(old200SMAData, 200, 'close');
                const volSma20 = calculateSMA(data, 20, 'volume');
                const volSma50 = calculateSMA(data, 50, 'volume');
                const dollarVol20m = (volSma20 * current.close) / 1000000;
                if (dollarVol20m < 20.0) return; // Strict Institutional Liquidity Floor: Must trade >= 0M daily

                const trendUp = (current.close > sma50 && sma50 > sma150 && sma150 > sma200 && sma200 > sma200_20days_ago);
                const high52 = meta.fiftyTwoWeekHigh || Math.max(...data.slice(-252).map(d => d.high));
                const distanceFromHigh = ((high52 - current.close) / high52) * 100;
                const isShallowBase = distanceFromHigh <= 15.0; 
                const distanceTo21 = Math.abs((current.low - ema21) / ema21);
                const touching21 = distanceTo21 <= 0.02; 
                const closedAbove21 = current.close >= ema21; 
                const lowVolume = current.volume < volSma20 && current.volume < volSma50;
                const todayRange = current.high - current.low;
                const avgRange = data.slice(-10).reduce((sum, d) => sum + (d.high - d.low), 0) / 10;
                const isTight = todayRange <= avgRange; 
                const stock3mo = calculatePerformance(data, 63);
                const outperforming = stock3mo > (Math.max(spy3mo, 0) * 1.5) && stock3mo > 10; 
                const adr = (data.slice(-20).reduce((sum, d) => sum + ((d.high - d.low) / d.close), 0) / 20) * 100;
                const goodVolatility = adr >= 2.0 && adr <= 8.0;

                let hasInstDemand = false;
                for (let j = data.length - 15; j < data.length; j++) {
                    const prevClose = data[j-1].close;
                    if (data[j].close > prevClose && data[j].volume > (calculateSMA(data.slice(0, j), 50, 'volume') * 1.5)) {
                        hasInstDemand = true; break;
                    }
                }

                if (trendUp && isShallowBase && touching21 && closedAbove21 && lowVolume && isTight && outperforming && goodVolatility && hasInstDemand) {
                    techMatches.push({
                        ticker, price: current.close, ema21, base_depth: `-${distanceFromHigh.toFixed(1)}%`,
                        adr, relative_strength_3mo: stock3mo - spy3mo, vol_status: "VCP Dry-Up"
                    });
                }
            }
        }));
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\nTechnical Scan found ${techMatches.length} candidates.`);
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
            
            // THE CHAMPION FUNDAMENTAL FILTER: Must have either >= 20% EPS Growth OR >= 25% Revenue Growth (CANSLIM explosive metrics)
            if (epsGrowth >= 0.20 || revGrowth >= 0.25) {
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
                console.log(`[PASS] ${match.ticker} - EPS Growth: ${(epsGrowth*100).toFixed(1)}%, Rev Growth: ${(revGrowth*100).toFixed(1)}%`);
            } else {
                console.log(`[REJECTED] ${match.ticker} - Failed Fundamental Test (EPS: ${(epsGrowth*100).toFixed(1)}%, Rev: ${(revGrowth*100).toFixed(1)}%)`);
            }
        } catch (e) {
            console.log(`[SKIP] ${match.ticker} - Could not fetch fundamentals.`);
        }
        await new Promise(r => setTimeout(r, 500)); // Be polite to Yahoo
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
