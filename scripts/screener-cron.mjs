import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';
import { evaluateTechnicals, calculatePerformance } from './lib/technicals.mjs';
import { fetchAllUSTickers } from './lib/universe.mjs';

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
            const timing = m.timing_label || '🎯 Ready at Pad';
            const dist10 = m.dist_10dma !== undefined ? `${m.dist_10dma >= 0 ? '+' : ''}${m.dist_10dma.toFixed(1)}%` : '<2.5%';
            const stopStr = m.suggested_stop ? `$${m.suggested_stop.toFixed(2)} (-${m.suggested_stop_pct?.toFixed(1)}%)` : 'Tight MA';
            fields.push({
                name: `${idx + 1}. [${badge}] ${m.ticker} · $${m.price?.toFixed(2)} [${timing}]`,
                value: `📉 Base: **${m.base_depth}** | 🎯 10-DMA: **${dist10}** | 🛡️ Stop: **${stopStr}** | 3M RS: **+${m.relative_strength_3mo?.toFixed(1)}%** | EPS: **+${((m.eps_growth || 0) * 100).toFixed(0)}%**`,
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

// Scan health accounting. "no_data" = Yahoo answered but has nothing usable
// (delisted / unknown symbol); "fetch_failed" = network error, 429 or 5xx
// after retries. Only fetch_failed counts toward the abort threshold.
const stats = { ok: 0, no_data: 0, fetch_failed: 0, retries: 0 };
const MAX_FETCH_FAILURE_RATE = 0.10;
const MIN_UNIVERSE_SIZE = 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Retries network errors, 429 and 5xx with exponential backoff (1s, 2s).
// Returns the Response, or null if every attempt failed.
async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.status !== 429 && res.status < 500) return res;
    } catch (e) {
      // Network error: fall through to retry.
    }
    if (i < attempts - 1) {
      stats.retries++;
      await sleep(1000 * 2 ** i);
    }
  }
  return null;
}

async function fetchYahooData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
    const res = await fetchWithRetry(url);
    if (!res) { stats.fetch_failed++; return null; }
    if (res.status === 404) { stats.no_data++; return null; }
    if (!res.ok) { stats.fetch_failed++; return null; }
    const json = await res.json();
    if (!json.chart?.result) { stats.no_data++; return null; }

    const data = json.chart.result[0];
    const quotes = data.indicators.quote[0];
    const timestamps = data.timestamp;
    if (!timestamps || timestamps.length === 0) { stats.no_data++; return null; }

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
    // While the regular session is open, Yahoo's last daily bar is partial
    // (low volume, unfinished range), which makes the dry-up / contraction
    // filters pass trivially. Exclude it so intraday scans use the last close.
    const regular = data.meta?.currentTradingPeriod?.regular;
    const lastTs = timestamps[timestamps.length - 1];
    if (regular && Date.now() / 1000 < regular.end && lastTs >= regular.start &&
        history.length > 0 &&
        history[history.length - 1].date === new Date(lastTs * 1000).toISOString().split('T')[0]) {
        history.pop();
    }

    stats.ok++;
    return { history, meta: data.meta };
  } catch (e) {
    stats.fetch_failed++;
    return null;
  }
}

// Fundamentals lookup with retry. Failures are usually transient (rate
// limiting right after the price scan, or cookie/crumb refresh), so back off
// 2s then 4s. validateResult:false keeps type coercion but stops minor Yahoo
// schema drift on a single field from failing the whole lookup.
async function quoteSummaryWithRetry(ticker, attempts = 3) {
    for (let i = 0; ; i++) {
        try {
            return await yf.quoteSummary(
                ticker,
                { modules: ['financialData', 'defaultKeyStatistics', 'calendarEvents', 'summaryProfile'] },
                { validateResult: false });
        } catch (e) {
            if (i >= attempts - 1) throw e;
            await sleep(2000 * 2 ** i);
        }
    }
}

async function run() {
    console.log(`Fetching S&P 500 Market Benchmark (SPY)...`);
    const spyDataResult = await fetchYahooData('SPY');
    if (!spyDataResult) {
        console.error('Aborting: could not fetch SPY benchmark. Previous market-state.json left untouched.');
        process.exit(1);
    }
    const spyData = spyDataResult.history;
    const spy3mo = calculatePerformance(spyData, 63);
    const asOf = spyData[spyData.length - 1].date;
    console.log(`Scanning as of the ${asOf} close.`);

    // Scheduled runs on market holidays would just republish the previous
    // session (and re-post to Discord). Manual runs always proceed.
    const outPath = path.join(process.cwd(), 'public', 'market-state.json');
    if (process.env.GITHUB_EVENT_NAME === 'schedule' && fs.existsSync(outPath)) {
        try {
            const previous = JSON.parse(fs.readFileSync(outPath, 'utf8'));
            if (previous.as_of === asOf) {
                console.log(`Previous scan already covers ${asOf} (market holiday?). Skipping.`);
                return;
            }
        } catch (e) {
            // Unreadable previous file: just rescan.
        }
    }

    const tickers = await fetchAllUSTickers();
    if (tickers.length < MIN_UNIVERSE_SIZE) {
        console.error(`Aborting: ticker universe only has ${tickers.length} symbols (master list download failed?).`);
        process.exit(1);
    }
    // Reset so the SPY benchmark fetch doesn't skew the universe stats.
    Object.assign(stats, { ok: 0, no_data: 0, fetch_failed: 0, retries: 0 });
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
                const match = evaluateTechnicals(ticker, result.history, result.meta, spy3mo);
                if (match) techMatches.push(match);
            }
        }));
        await new Promise(r => setTimeout(r, 150));
    }

    const failureRate = stats.fetch_failed / tickers.length;
    console.log(`\nFetch stats: ${JSON.stringify(stats)} (failure rate ${(failureRate * 100).toFixed(1)}%)`);
    if (failureRate > MAX_FETCH_FAILURE_RATE) {
        console.error(`Aborting: ${(failureRate * 100).toFixed(1)}% of price fetches failed (limit ${MAX_FETCH_FAILURE_RATE * 100}%). ` +
            `Previous market-state.json left untouched.`);
        process.exit(1);
    }

    console.log(`\nTechnical Scan found ${techMatches.length} Model Book candidates.`);
    console.log(`Starting FUNDAMENTAL Validation phase...`);

    let finalMatches = [];
    const fundStats = { checked: techMatches.length, failed: 0 };
    for (const match of techMatches) {
        try {
            const summary = await quoteSummaryWithRetry(match.ticker);
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
            fundStats.failed++;
            console.log(`[FUNDAMENTALS ERROR] ${match.ticker}: ${e.name}: ${String(e.message).slice(0, 200)}`);
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

    // yahoo-finance2's quoteSummary breaks periodically (crumb/cookie changes).
    // If most lookups fail, the result would silently be "coils only".
    const fundFailureRate = fundStats.checked ? fundStats.failed / fundStats.checked : 0;
    console.log(`Fundamentals: ${fundStats.failed}/${fundStats.checked} lookups failed.`);
    if (fundStats.checked >= 5 && fundFailureRate > 0.5) {
        console.error(`Aborting: ${(fundFailureRate * 100).toFixed(0)}% of fundamentals lookups failed. ` +
            `Previous market-state.json left untouched.`);
        process.exit(1);
    }

    const output = {
        timestamp: new Date().toISOString(),
        as_of: asOf,
        total_scanned: tickers.length,
        stats: {
            ...stats,
            failure_rate: Number(failureRate.toFixed(4)),
            fundamentals_checked: fundStats.checked,
            fundamentals_failed: fundStats.failed,
        },
        matches: finalMatches
    };

    if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Saved results. Found ${finalMatches.length} stocks that passed BOTH Technicals and Fundamentals.`);

    await sendDiscordSummary(output, spy3mo);
}

run();
