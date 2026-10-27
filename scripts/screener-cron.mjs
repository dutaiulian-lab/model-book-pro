import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';
import { calculatePerformance } from './lib/technicals.mjs';
import { fetchAllUSTickers } from './lib/universe.mjs';
import { latestScannableSession, isTradingDay } from '../src/lib/market-calendar.js';
import { upcomingEarnings } from './lib/earnings.mjs';
import {
    RULES, RULES_VERSION, FAMILY_LABELS, REGIME_TEXT, STOP_TEXT, EXIT_TEXT, prepare, rsScore, dollarVol,
    inRankUniverse, countedSetups, passesBuyRules, passesTrackRules, bestSetup, initialStop,
    percentile, regimeOn, spyRegimeByDate, splitFactors, parseChart, IDLE, idleCashByDate, idleCashText,
    CONTEXT, contextHistory, marketContext,
} from './lib/leader-rules.mjs';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

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
//   snap:    display values for the dashboard card.
// Sessions of breadth history kept for the market context.
const BREADTH_SESSIONS = contextHistory();

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
    // RS / dollar volume for the entry window (percentiles); a50 (above its
    // 50-day SMA, null before 50 bars) for a longer window: market breadth and
    // its history for the market context (breadth thrust, 10-day change).
    const window = Math.max(RULES.entryWindow, BREADTH_SESSIONS);
    for (let k = Math.max(0, n - window); k < n; k++) {
        if (inRankUniverse(S, k)) {
            const a50 = Number.isNaN(S.sma50[k]) ? null : S.c[k] > S.sma50[k];
            recent[S.dates[k]] = k >= n - RULES.entryWindow ? { rs: rsScore(S, k), dv: dollarVol(S, k), a50 } : { a50 };
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
    if (!setups.length) return { recent };
    const k = n - 1;
    const snap = {
        price: S.c[k], dma10: S.sma10[k], ema21: S.ema21[k], sma50: S.sma50[k],
        adr: S.adrS[k] * 100, vol_ratio: S.v[k] / S.vol20[k],
        // Highest high of the last 252 sessions (or since listing): the card's
        // "Off High" is measured from today's close, not the setup day's.
        hi52: Math.max(...Array.from(S.h.subarray(Math.max(0, n - 252)))),
        perf63: n > 63 ? (S.c[k] / S.c[k - 63] - 1) * 100 : NaN,
        is_ipo: ipoStart && k < 252, ipo_date: ipoStart ? S.dates[0] : null,
    };
    return { recent, setups, snap, n };
}

function buildMatch(ticker, r, st, ranks, spy3mo) {
    const { snap, n } = r;
    const f = st.feats;
    const pivot = st.pivot;
    const stop = initialStop(pivot, st.structStop);
    const distPivot = (snap.price / pivot - 1) * 100;
    // Display tiers (rules.json display): ready / soon / far (far = hidden on
    // the dashboard, still a live order and recorded in the track record).
    const tier = distPivot >= -RULES.readyWithinPct ? 'READY' : distPivot >= -RULES.soonWithinPct ? 'SOON' : 'FAR';
    const TIER_LABEL = { READY: '🎯 Ready now', SOON: '⏳ Soon', FAR: '💤 Far below pivot' };
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
        high_52w: snap.hi52,
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
        timing_status: tier,
        timing_label: TIER_LABEL[tier],
        buy_limit: pivot * (1 + RULES.gapLimitPct / 100),
        below_stop: snap.price < stop,
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

    // One scan per session: several schedules trigger this (cron-job.org,
    // Vercel Cron, GitHub's schedule), and on market holidays a run would just
    // republish the previous session. FORCE_SCAN=1 (workflow input) rescans the
    // same session. Never go backwards, even when forced: runs in the evening
    // (GitHub's schedule starts hours late) have received a SPY series from
    // Yahoo without the latest session, and rescanning then overwrote the
    // newer published scan with the previous session's.
    const outPath = path.join(process.cwd(), 'public', 'market-state.json');
    let prevAsOf = null;
    if (fs.existsSync(outPath)) {
        try {
            prevAsOf = JSON.parse(fs.readFileSync(outPath, 'utf8')).as_of || null;
        } catch (e) {
            // Unreadable previous file: just rescan.
        }
    }
    if (prevAsOf && asOf < prevAsOf) {
        console.log(`Yahoo's latest session (${asOf}) is older than the published scan (${prevAsOf}). Skipping.`);
        return;
    }
    // Latest NYSE session whose 22:15 UTC scan time has passed. If neither Yahoo
    // nor the published scan has it, the data is late (not a holiday): fail, so
    // the run shows as failed, the dashboard flags the scan, and the next
    // trigger (Vercel Cron at 02:30 UTC) retries.
    const expected = latestScannableSession().session;
    if (asOf < expected && !(prevAsOf && prevAsOf >= expected)) {
        console.error(`Yahoo's latest session is ${asOf}, but the ${expected} session (not an NYSE holiday) should be out. Data is late; failing so a later run retries.`);
        process.exit(1);
    }
    if (prevAsOf === asOf && process.env.FORCE_SCAN !== '1') {
        console.log(`Previous scan already covers ${asOf}; no newer NYSE session is due. Skipping.`);
        return;
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
            if (!breadthBy.has(d)) breadthBy.set(d, { n: 0, up: 0 });
            if (x.dv !== undefined) {
                if (!rsBy.has(d)) { rsBy.set(d, []); dvBy.set(d, []); }
                if (!Number.isNaN(x.rs)) rsBy.get(d).push(x.rs);
                dvBy.get(d).push(x.dv);
            }
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
        spy_sma200: spyC.length >= 200 ? Number((spyC.subarray(-200).reduce((a, b) => a + b, 0) / 200).toFixed(2)) : null,
    };
    console.log(`Market filter (${regime.rule_text}): ${regime.on ? 'ON' : 'OFF'}; breadth ${regime.breadth_50}% above 50-day.`);
    const idleToday = idleCashByDate(spyDates, spyC).get(asOf);
    const idle_cash = {
        mode: IDLE.mode, band: IDLE.band, rule_text: idleCashText(), note: IDLE.note,
        on: !!idleToday?.on,
        spy_vs_200: Number.isFinite(idleToday?.vs200) ? Number(idleToday.vs200.toFixed(2)) : null,
    };
    console.log(`${idle_cash.rule_text}: ${idle_cash.on ? 'HOLD SPY' : 'CASH'} (SPY ${idle_cash.spy_vs_200}% vs 200-day).`);
    // Market context (display only): states for SPY vs its 200-day and breadth.
    const breadthHist = spyDates.slice(-BREADTH_SESSIONS).map(d => mktFor(d).breadth);
    const context = CONTEXT ? { ...marketContext(idleToday?.vs200, breadthHist), note: CONTEXT.note } : null;
    if (context) console.log(`Market context: SPY ${context.spy.label ?? '-'}, breadth ${context.breadth.label ?? '-'} (10-day ${context.breadth.change10 ?? '-'})${context.flags.map(f => `, ${f.label}`).join('')}.`);
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
    const tracked = [];
    const setupList = (list) => list.map(x => ({
        family: x.st.fam, setup_type: FAMILY_LABELS[x.st.fam], signal_date: x.st.date,
        pivot: x.st.pivot, struct_stop: x.st.structStop, suggested_stop: initialStop(x.st.pivot, x.st.structStop),
        rs_rank: x.ranks.rs, dv_rank: x.ranks.dvPct,
    }));
    for (const [ticker, r] of results) {
        if (!r.setups) continue;
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
        }
    }
    const tierOrder = { READY: 0, SOON: 1, FAR: 2 };
    techMatches.sort((a, b) => tierOrder[a.timing_status] - tierOrder[b.timing_status] || b.rs_rank - a.rs_rank);
    tracked.sort((a, b) => b.rs_rank - a.rs_rank);

    console.log(`\nTechnical Scan found ${techMatches.length} buy setups (${techMatches.filter(m => m.timing_status === 'READY').length} ready, ${techMatches.filter(m => m.timing_status === 'SOON').length} soon, ${techMatches.filter(m => m.timing_status === 'FAR').length} far below the pivot) and ${tracked.length} separately tracked setups.`);
    console.log(`Fundamentals / earnings lookup...`);

    // Fundamentals are informational (no point-in-time history to test them).
    // The earnings date is part of the rules: no fill on the session that
    // reacts to the release (rules.json entry.skipEarningsSession).
    const finalMatches = [];
    const fundStats = { checked: techMatches.length, failed: 0, earnings_unknown: 0 };
    for (const match of techMatches) {
        let summary = null;
        try {
            summary = await quoteSummaryWithRetry(match.ticker);
        } catch (e) {
            fundStats.failed++;
            console.log(`[FUNDAMENTALS ERROR] ${match.ticker}: ${e.name}: ${String(e.message).slice(0, 200)}`);
        }
        let next = null, earnErr = null;
        try {
            next = await upcomingEarnings(match.ticker, asOf, { summary });
        } catch (e) {
            earnErr = String(e.message).slice(0, 200);
        }
        if (!next) fundStats.earnings_unknown++;
        const earn = earningsInfo(next, asOf, match.sessions_left);
        const epsGrowth = summary?.financialData?.earningsGrowth ?? null;
        const revGrowth = summary?.financialData?.revenueGrowth ?? null;
        finalMatches.push({
            ...match,
            eps_growth: epsGrowth,
            rev_growth: revGrowth,
            growth_ok: summary ? (epsGrowth ?? 0) >= 0.20 || (revGrowth ?? 0) >= 0.20 : null,
            short_percent: summary?.defaultKeyStatistics?.shortPercentOfFloat || 0,
            float_shares: summary?.defaultKeyStatistics?.floatShares || 0,
            sector: summary?.summaryProfile?.sector || "Unknown",
            industry: summary?.summaryProfile?.industry || "Unknown",
            ...earn,
            ...(earnErr ? { earnings_error: earnErr } : {}),
        });
        {
            console.log(`[BUY] ${match.ticker} ${match.timing_status} (${match.setup_type}) RS ${match.rs_rank.toFixed(0)}`
                + ` - EPS: ${epsGrowth == null ? 'n/a' : (epsGrowth * 100).toFixed(1) + '%'}, Rev: ${revGrowth == null ? 'n/a' : (revGrowth * 100).toFixed(1) + '%'}`
                + ` - earnings ${earn.earnings_date}${earn.earnings_no_buy_session ? ` (no buy on ${earn.earnings_no_buy_session})` : ''}${earnErr ? ` [lookup failed: ${earnErr}]` : ''}`);
        }
        await sleep(300);
    }
    console.log(`Fundamentals: ${fundStats.failed}/${fundStats.checked} lookups failed; earnings date unknown for ${fundStats.earnings_unknown}.`);

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
            entry: `Buy stop at the pivot (limit +${RULES.gapLimitPct}%), valid ${RULES.entryWindow} sessions; no fill on an earnings-reaction session`,
            tiers: { ready: RULES.readyWithinPct, soon: RULES.soonWithinPct },
        },
        regime,
        idle_cash,
        context,
        total_scanned: tickers.length,
        ranking_universe: universeToday,
        stats: {
            ...stats,
            failure_rate: Number(failureRate.toFixed(4)),
            fundamentals_checked: fundStats.checked,
            fundamentals_failed: fundStats.failed,
            earnings_unknown: fundStats.earnings_unknown,
        },
        matches: finalMatches,
        tracked,
    };

    if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Saved results: ${finalMatches.length} buy setups, ${tracked.length} tracked.`);
}

// The next `k` NYSE sessions after `iso` (exclusive).
function nextSessions(iso, k) {
    const out = [];
    let t = Date.parse(`${iso}T12:00:00Z`);
    while (out.length < k) {
        t += 86400e3;
        const d = new Date(t).toISOString().slice(0, 10);
        if (isTradingDay(d)) out.push(d);
    }
    return out;
}
// First NYSE session on or after `iso`.
function sessionOnOrAfter(iso) {
    return isTradingDay(iso) ? iso : nextSessions(iso, 1)[0];
}

// Card fields for the next earnings release. The reaction session is the
// release day (before the open / during the session) or the next session
// (after the close); unknown time flags both. If one falls inside the buy
// stop's remaining window, the order must not be live that session (a
// trigger there voids the setup, as in the study).
function earningsInfo(next, asOf, sessionsLeft) {
    if (!next) return { earnings_date: 'Unknown', earnings_time: null, earnings_soon: false, earnings_no_buy_session: null, earnings_events: [] };
    const day = sessionOnOrAfter(next.date);
    const react = [];
    if (day !== next.date || next.amc !== true) react.push(day);
    if (day === next.date && next.amc !== false) react.push(nextSessions(day, 1)[0]);
    const window = nextSessions(asOf, Math.max(0, sessionsLeft));
    const hit = react.find(d => window.includes(d)) || null;
    const days = Math.round((Date.parse(next.date) - Date.parse(asOf)) / 86400e3);
    return {
        earnings_date: next.date,
        earnings_time: next.amc === true ? 'after close' : next.amc === false ? 'before open' : null,
        earnings_estimate: !!next.estimate,
        earnings_source: next.source,
        earnings_soon: days >= 0 && days <= 7,
        earnings_no_buy_session: hit,
        earnings_events: [{ date: next.date, amc: next.amc ?? null }],
    };
}

run();
