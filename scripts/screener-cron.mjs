import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';
import { calculatePerformance } from './lib/technicals.mjs';
import { fetchAllUSTickers } from './lib/universe.mjs';
import {
    RULES, WATCH, RULES_VERSION, FAMILY_LABELS, REGIME_TEXT, STOP_TEXT, EXIT_TEXT, prepare, rsScore, dollarVol,
    inRankUniverse, detect, countedSetups, passesBuyRules, passesTrackRules, passesWatch, bestSetup, initialStop,
    percentile, regimeOn, spyRegimeByDate, splitFactors, parseChart, IDLE, idleCashByDate, idleCashText,
} from './lib/leader-rules.mjs';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Scan health accounting. "no_data" = Yahoo answered but has nothing usable
// (delisted / unknown symbol); "fetch_failed" = network error, 429 or 5xx
// after retries. Only fetch_failed counts toward the abort threshold.
const stats = { ok: 0, no_data: 0, fetch_failed: 0, retries: 0 };
const MAX_FETCH_FAILURE_RATE = 0.10;
const MIN_UNIVERSE_SIZE = 1000;
const WATCHLIST_MAX = 40;
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

// Two years of daily bars: the rules need a 252-session RS window, the
// 200-day SMA and its 20-day slope, and the 52-week range.
async function fetchYahooData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=2y&interval=1d&events=split`;
    const res = await fetchWithRetry(url);
    if (!res) { stats.fetch_failed++; return null; }
    if (res.status === 404) { stats.no_data++; return null; }
    if (!res.ok) { stats.fetch_failed++; return null; }
    const json = await res.json();
    const data = json.chart?.result?.[0];
    if (!data) { stats.no_data++; return null; }
    // parseChart also drops today's partial bar while the session is open, so
    // intraday runs use the last close.
    const parsed = parseChart(data);
    if (!parsed || !parsed.history.length) { stats.no_data++; return null; }
    stats.ok++;
    return { ...parsed, meta: data.meta };
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

// Pass 1 for one ticker. Keeps only what pass 2 needs (the full prepared
// series for ~6,000 tickers would not fit comfortably in memory):
//   recent:  RS score and dollar volume for the last few sessions, if the
//            stock is in the ranking universe (feeds the percentiles);
//   setups:  counted setups from the last 5 sessions whose buy-stop has not
//            triggered yet (still actionable tomorrow);
//   watch:   today's raw setups including power gaps (watchlist);
//   snap:    display values for the dashboard card.
function scanTicker(ticker, history, splits, meta, spyDates) {
    if (meta?.instrumentType && meta.instrumentType !== 'EQUITY') return null;
    if (history.length < 30) return null;
    // New issue if the first bar is more than 5 sessions after SPY's first bar
    // (same convention as the research data set).
    const ipoStart = spyDates.length > 5 && history[0].date > spyDates[5];
    const dates = history.map(b => b.date);
    const S = prepare(history, { ipoStart, factor: splitFactors(dates, splits) });
    const n = S.n;
    const recent = {};
    for (let k = Math.max(0, n - RULES.entryWindow); k < n; k++) {
        if (inRankUniverse(S, k)) {
            // a50: above its 50-day SMA (null before 50 bars), for market breadth.
            recent[S.dates[k]] = { rs: rsScore(S, k), dv: dollarVol(S, k), a50: Number.isNaN(S.sma50[k]) ? null : S.c[k] > S.sma50[k] };
        }
    }
    const pack = (st, s) => {
        let struct = st.structStop;
        // Non-coil stops ratchet down to the lows printed while waiting for the fill.
        if (st.fam !== 'RANGE') for (let q = s + 1; q < n; q++) struct = Math.min(struct, S.l[q] * 0.995);
        return {
            s, date: S.dates[s], fam: st.fam, pivot: st.pivot, structStop: struct, trap: st.trap || 0,
            baseDepth: st.baseDepth, baseLen: st.baseLen, gapPct: st.gapPct, feats: st.feats, rsScore: rsScore(S, s),
        };
    };
    const setups = countedSetups(S, 30, n - 1)
        .filter(st => st.s >= n - RULES.entryWindow && st.eb < 0)
        .map(st => pack(st, st.s));
    const today = detect(S, n - 1, { withGap: true });
    const watch = today ? today.cands.map(cd => pack({ ...cd, feats: today.feats }, n - 1)) : [];
    if (!setups.length && !watch.length) return { recent };
    const k = n - 1;
    const snap = {
        price: S.c[k], dma10: S.sma10[k], ema21: S.ema21[k], sma50: S.sma50[k],
        adr: S.adrS[k] * 100, vol_ratio: S.v[k] / S.vol20[k],
        perf63: n > 63 ? (S.c[k] / S.c[k - 63] - 1) * 100 : NaN,
        is_ipo: ipoStart && k < 252, ipo_date: ipoStart ? S.dates[0] : null,
    };
    return { recent, setups, watch, snap, n };
}

function buildMatch(ticker, r, st, ranks, spy3mo) {
    const { snap, n } = r;
    const f = st.feats;
    const pivot = st.pivot;
    const stop = initialStop(pivot, st.structStop);
    const distPivot = (snap.price / pivot - 1) * 100;
    const atPivot = distPivot >= -2;
    return {
        ticker,
        family: st.fam,
        setup_type: FAMILY_LABELS[st.fam],
        signal_date: st.date,
        sessions_left: st.s + RULES.entryWindow - (n - 1),
        price: snap.price,
        dma10: snap.dma10,
        ema21: snap.ema21,
        sma50: snap.sma50,
        rs_rank: ranks.rs,
        dv_rank: ranks.dvPct,
        dollar_volume: f.dv,
        base_depth: `-${f.depth52.toFixed(1)}%`,
        depth_52w: f.depth52,
        up_from_low52: f.upLow52,
        setup_depth: st.baseDepth,
        setup_length: st.baseLen,
        spread_10_21: Math.abs(snap.dma10 - snap.ema21) / snap.ema21 * 100,
        vol_ratio: snap.vol_ratio,
        vol_status: `Vol ${(snap.vol_ratio * 100).toFixed(0)}% of 20d`,
        is_ipo: snap.is_ipo,
        ipo_date: snap.ipo_date,
        adr: snap.adr,
        relative_strength_3mo: spy3mo !== null && !Number.isNaN(snap.perf63) ? snap.perf63 - spy3mo : snap.perf63,
        dist_10dma: (snap.price / snap.dma10 - 1) * 100,
        dist_21ema: (snap.price / snap.ema21 - 1) * 100,
        recent_pivot: pivot,
        buy_stop: pivot,
        dist_from_pivot: distPivot,
        timing_status: atPivot ? 'AT_PIVOT' : 'NEAR_PIVOT',
        timing_label: atPivot ? '🎯 At Pivot' : '⏳ Near Pivot',
        struct_stop: st.structStop,
        suggested_stop: stop,
        suggested_stop_pct: (pivot - stop) / pivot * 100,
    };
}

async function run() {
    console.log(`Fetching S&P 500 Market Benchmark (SPY)...`);
    const spyDataResult = await fetchYahooData('SPY');
    if (!spyDataResult || spyDataResult.history.length < 220) {
        console.error('Aborting: could not fetch SPY benchmark. Previous market-state.json left untouched.');
        process.exit(1);
    }
    const spyData = spyDataResult.history;
    const spy3mo = calculatePerformance(spyData, 63);
    const asOf = spyData[spyData.length - 1].date;
    const spyDates = spyData.map(b => b.date);
    const spyC = Float64Array.from(spyData, b => b.close);
    // Market flags per date; breadth is filled in after pass 1 (needs the universe).
    const mktByDate = spyRegimeByDate(spyDates, spyC);
    const mktFor = (d) => mktByDate.get(d) || { spy200: false, spy50: false, breadth: NaN };
    console.log(`Scanning as of the ${asOf} close. SPY ${mktFor(asOf).spy200 ? 'above' : 'BELOW'} its 200-day SMA.`);

    // Scheduled runs on market holidays would just republish the previous
    // session. Manual runs always proceed.
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

    const results = new Map();
    const batchSize = 25;
    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch = tickers.slice(i, i + batchSize);
        if (i % 500 === 0) console.log(`Scanning progress: ${i} / ${tickers.length}...`);

        await Promise.all(batch.map(async (ticker) => {
            const result = await fetchYahooData(ticker);
            if (!result) return;
            try {
                const r = scanTicker(ticker, result.history, result.splits, result.meta, spyDates);
                if (r) results.set(ticker, r);
            } catch (e) {
                console.log(`[SCAN ERROR] ${ticker}: ${e.message}`);
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

    // Percentile universes and breadth per date (liquid US equities that day).
    const rsBy = new Map(), dvBy = new Map(), breadthBy = new Map();
    for (const r of results.values()) {
        for (const [d, x] of Object.entries(r.recent)) {
            if (!rsBy.has(d)) { rsBy.set(d, []); dvBy.set(d, []); breadthBy.set(d, { n: 0, up: 0 }); }
            if (!Number.isNaN(x.rs)) rsBy.get(d).push(x.rs);
            dvBy.get(d).push(x.dv);
            if (x.a50 != null) { const b = breadthBy.get(d); b.n++; if (x.a50) b.up++; }
        }
    }
    for (const [d, b] of breadthBy) if (mktByDate.has(d) && b.n) mktByDate.get(d).breadth = b.up / b.n * 100;
    const mktToday = mktFor(asOf);
    const regime = {
        rule: RULES.regime,
        rule_text: REGIME_TEXT[RULES.regime],
        on: regimeOn(mktToday),
        spy_above_200: !!mktToday.spy200,
        spy_above_50: !!mktToday.spy50,
        breadth_50: Number.isFinite(mktToday.breadth) ? Number(mktToday.breadth.toFixed(1)) : null,
        spy_close: spyC[spyC.length - 1],
    };
    console.log(`Market filter (${regime.rule_text}): ${regime.on ? 'ON' : 'OFF'}; breadth ${regime.breadth_50}% above 50-day.`);
    const idleToday = idleCashByDate(spyDates, spyC).get(asOf);
    const idle_cash = {
        mode: IDLE.mode, band: IDLE.band, rule_text: idleCashText(), note: IDLE.note,
        on: !!idleToday?.on,
        spy_vs_200: Number.isFinite(idleToday?.vs200) ? Number(idleToday.vs200.toFixed(2)) : null,
    };
    console.log(`${idle_cash.rule_text}: ${idle_cash.on ? 'HOLD SPY' : 'CASH'} (SPY ${idle_cash.spy_vs_200}% vs 200-day).`);
    for (const a of rsBy.values()) a.sort((x, y) => x - y);
    for (const a of dvBy.values()) a.sort((x, y) => x - y);
    const universeToday = dvBy.get(asOf)?.length || 0;
    console.log(`Ranking universe today: ${universeToday} liquid equities.`);
    if (universeToday < 500) {
        console.error(`Aborting: ranking universe for ${asOf} only has ${universeToday} stocks. Previous market-state.json left untouched.`);
        process.exit(1);
    }
    const ranksFor = (st) => ({
        rs: percentile(rsBy.get(st.date) || [], st.rsScore),
        dvPct: percentile(dvBy.get(st.date) || [], st.feats.dv),
    });

    const techMatches = [];
    const watchlist = [];
    const tracked = [];
    const setupList = (list) => list.map(x => ({
        family: x.st.fam, setup_type: FAMILY_LABELS[x.st.fam], signal_date: x.st.date,
        pivot: x.st.pivot, struct_stop: x.st.structStop, suggested_stop: initialStop(x.st.pivot, x.st.structStop),
        rs_rank: x.ranks.rs, dv_rank: x.ranks.dvPct,
    }));
    for (const [ticker, r] of results) {
        if (!r.setups && !r.watch) continue;
        const ranked = (r.setups || []).map(st => ({ st, ranks: ranksFor(st) }));
        const buys = ranked.filter(x => passesBuyRules(x.st, x.ranks, mktFor(x.st.date)));
        // Families tracked separately (e.g. High Tight Flags): same filters,
        // recorded in the track record under their own tier, never buy signals
        // (a ticker can be in both lists).
        const tr = ranked.filter(x => passesTrackRules(x.st, x.ranks, mktFor(x.st.date)));
        if (tr.length) {
            const best = bestSetup(tr.map(x => x.st));
            const m = buildMatch(ticker, r, best, tr.find(x => x.st === best).ranks, spy3mo);
            m.tier = 'track';
            m.setups = setupList(tr);
            tracked.push(m);
        }
        if (buys.length) {
            const best = bestSetup(buys.map(x => x.st));
            const m = buildMatch(ticker, r, best, buys.find(x => x.st === best).ranks, spy3mo);
            // Every qualifying setup is tracked separately in the track record
            // (as in the research); the card shows the one that triggers first.
            m.setups = setupList(buys);
            techMatches.push(m);
            continue;
        }
        if (tr.length) continue;
        const w = (r.watch || []).map(st => ({ st, ranks: ranksFor(st) })).filter(x => passesWatch(x.st, x.ranks));
        if (w.length) {
            const best = bestSetup(w.map(x => x.st));
            const ranks = w.find(x => x.st === best).ranks;
            watchlist.push({
                ...buildMatch(ticker, r, best, ranks, spy3mo),
                gap_pct: best.gapPct ?? null,
                why_not_buy: whyNotBuy(best, ranks, regimeOn(mktFor(best.date))),
            });
        }
    }
    techMatches.sort((a, b) => b.rs_rank - a.rs_rank);
    tracked.sort((a, b) => b.rs_rank - a.rs_rank);
    watchlist.sort((a, b) => b.rs_rank - a.rs_rank);
    watchlist.splice(WATCHLIST_MAX);

    console.log(`\nTechnical Scan found ${techMatches.length} buy setups, ${tracked.length} separately tracked setups and ${watchlist.length} watchlist leaders.`);
    console.log(`Fundamentals / earnings lookup (informational; the tested rules are price-only)...`);

    // Fundamentals are shown on the card and flag earnings risk, but do not
    // filter: the 20-year study could not test them (no point-in-time data), and
    // the track record must follow exactly the rules that were tested.
    const finalMatches = [];
    const fundStats = { checked: techMatches.length, failed: 0 };
    for (const match of techMatches) {
        try {
            const summary = await quoteSummaryWithRetry(match.ticker);
            const epsGrowth = summary?.financialData?.earningsGrowth ?? null;
            const revGrowth = summary?.financialData?.revenueGrowth ?? null;
            let earningsDateStr = "Unknown";
            let earningsSoon = false;
            const ed0 = summary?.calendarEvents?.earnings?.earningsDate?.[0];
            if (ed0) {
                const ed = new Date(ed0);
                earningsDateStr = ed.toISOString().split('T')[0];
                const diffDays = Math.ceil((ed - new Date()) / (1000 * 60 * 60 * 24));
                earningsSoon = diffDays >= 0 && diffDays <= 7;
            }
            finalMatches.push({
                ...match,
                eps_growth: epsGrowth,
                rev_growth: revGrowth,
                growth_ok: (epsGrowth ?? 0) >= 0.20 || (revGrowth ?? 0) >= 0.20,
                short_percent: summary?.defaultKeyStatistics?.shortPercentOfFloat || 0,
                float_shares: summary?.defaultKeyStatistics?.floatShares || 0,
                sector: summary?.summaryProfile?.sector || "Unknown",
                industry: summary?.summaryProfile?.industry || "Unknown",
                earnings_date: earningsDateStr,
                earnings_soon: earningsSoon,
            });
            console.log(`[BUY] ${match.ticker} (${match.setup_type}) RS ${match.rs_rank.toFixed(0)} - EPS: ${epsGrowth == null ? 'n/a' : (epsGrowth * 100).toFixed(1) + '%'}, Rev: ${revGrowth == null ? 'n/a' : (revGrowth * 100).toFixed(1) + '%'}${earningsSoon ? ' - EARNINGS ' + earningsDateStr : ''}`);
        } catch (e) {
            fundStats.failed++;
            console.log(`[FUNDAMENTALS ERROR] ${match.ticker}: ${e.name}: ${String(e.message).slice(0, 200)}`);
            finalMatches.push({ ...match, eps_growth: null, rev_growth: null, earnings_date: "Unknown", sector: "Unknown", industry: "Unknown" });
        }
        await new Promise(r => setTimeout(r, 300));
    }
    console.log(`Fundamentals: ${fundStats.failed}/${fundStats.checked} lookups failed.`);

    const output = {
        timestamp: new Date().toISOString(),
        as_of: asOf,
        rules_version: RULES_VERSION,
        rules: { ...RULES, depth52Max: Number.isFinite(RULES.depth52Max) ? RULES.depth52Max : null },
        rules_text: {
            families: RULES.families.map(f => FAMILY_LABELS[f]),
            tracked_families: RULES.trackFamilies.map(f => FAMILY_LABELS[f]),
            track_note: RULES.trackNote,
            regime: REGIME_TEXT[RULES.regime], stop: STOP_TEXT[RULES.stop], exit: EXIT_TEXT[RULES.exit],
        },
        watch_rules: WATCH,
        regime,
        idle_cash,
        total_scanned: tickers.length,
        ranking_universe: universeToday,
        stats: {
            ...stats,
            failure_rate: Number(failureRate.toFixed(4)),
            fundamentals_checked: fundStats.checked,
            fundamentals_failed: fundStats.failed,
        },
        matches: finalMatches,
        tracked,
        watchlist,
    };

    if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Saved results: ${finalMatches.length} buy setups, ${tracked.length} tracked, ${watchlist.length} watchlist leaders.`);
}

// Short reason a watchlist leader is not a buy signal.
function whyNotBuy(st, ranks, marketOn) {
    const f = st.feats;
    if (RULES.trackFamilies.includes(st.fam)) return `${FAMILY_LABELS[st.fam]}: tracked separately, not a buy rule`;
    if (!RULES.families.includes(st.fam)) return st.fam === 'GAP' ? 'Power gap (watch for a setup)' : 'Setup not in buy rules';
    if (!marketOn) return `Market filter off (${REGIME_TEXT[RULES.regime]})`;
    if (RULES.rsMin > 0 && !(ranks.rs >= RULES.rsMin)) return `RS ${ranks.rs.toFixed(0)} < ${RULES.rsMin}`;
    if (RULES.dvPctMin > 0 && !(ranks.dvPct >= RULES.dvPctMin)) return `Liquidity rank ${ranks.dvPct.toFixed(0)} < ${RULES.dvPctMin}`;
    if (!(f.dv >= RULES.dvMin)) return `Dollar volume below $${RULES.dvMin / 1e6}M`;
    if (f.upLow52 < RULES.upLow52Min) return `Only +${f.upLow52.toFixed(0)}% off 52w low`;
    if (f.depth52 > RULES.depth52Max) return `${f.depth52.toFixed(0)}% below 52w high`;
    return 'Repeat setup (de-duplicated)';
}

run();
