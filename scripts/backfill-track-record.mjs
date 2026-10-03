// Backfill of the track record: replays the active leader rules (lib/rules.json
// via lib/leader-rules.mjs)
// over the last BACKFILL_YEARS years, exactly as the research did:
//   - setups are detected and de-duplicated per ticker over its full history;
//   - RS and liquidity ranks are percentiles across the liquid US equity
//     universe of that day;
//   - market breadth (for the breadth50 regime) is measured over that universe;
//   - every qualifying setup is one signal, traded with the shared trade model;
//     setups of separately tracked families are recorded with tier 'track'.
//
// Limitations (shown in the dashboard too): today's ticker list omits stocks
// delisted since, which flatters results; fundamentals and earnings dates are not
// used (the rules are price-only).
//
// Usage: node scripts/backfill-track-record.mjs [years=3]
import { fetchAllUSTickers } from './lib/universe.mjs';
import {
    RULES, RULES_VERSION, prepare, rsScore, dollarVol, inRankUniverse, countedSetups, passesBuyRules,
    passesTrackRules, initialStop, percentile, spyRegimeByDate, splitFactors, FAMILY_LABELS,
} from './lib/leader-rules.mjs';
import {
    computeOutcome, fetchDailyBars, pickFields, readJson, signalId,
    writeTrackRecord, TRACK_RECORD_PATH, PICK_DAYS_PATH,
} from './lib/track-record.mjs';

const BACKFILL_YEARS = Number(process.argv[2] || 3);
// History fetched per ticker: the backfill window plus 2 years of warm-up
// (252-session RS window, 200-day SMA slope, 52-week range).
const FETCH_RANGE = `${Math.ceil(BACKFILL_YEARS + 2)}y`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const minusYears = (date, y) => `${Number(date.slice(0, 4)) - y}${date.slice(4)}`;

async function main() {
    const spy = (await fetchDailyBars('SPY', FETCH_RANGE))?.bars;
    if (!spy?.length) throw new Error('Could not fetch SPY');
    const spyByDate = new Map(spy.map(b => [b.date, b]));
    const spyDates = spy.map(b => b.date);
    const mktByDate = spyRegimeByDate(spyDates, spy.map(b => b.close));
    const lastDate = spyDates[spyDates.length - 1];
    const FROM = spyDates.find(d => d > minusYears(lastDate, BACKFILL_YEARS));
    const dates = spyDates.filter(d => d >= FROM);
    console.log(`Backfilling ${dates.length} sessions: ${FROM} .. ${lastDate} (fetching ${FETCH_RANGE} per ticker)`);

    const tickers = await fetchAllUSTickers();
    if (tickers.length < 1000) throw new Error(`Universe too small (${tickers.length})`);

    // Pass 1: per ticker, rank inputs for every day, and candidate setups that
    // pass every rule except the ranks (outcome computed while bars are in hand).
    const rsBy = new Map(dates.map(d => [d, []])), dvBy = new Map(dates.map(d => [d, []]));
    const breadthBy = new Map(dates.map(d => [d, { n: 0, up: 0 }]));
    // Pre-filter: every rule except the ranks and the market filter.
    const OPEN_MKT = { spy200: true, spy50: true, breadth: 100 }, TOP = { rs: 100, dvPct: 100 };
    const cands = [];
    let fetched = 0, failed = 0, skippedType = 0;
    const batchSize = 25;
    for (let i = 0; i < tickers.length; i += batchSize) {
        if (i % 500 === 0) console.log(`progress ${i}/${tickers.length}, candidates so far ${cands.length}`);
        await Promise.all(tickers.slice(i, i + batchSize).map(async (ticker) => {
            const res = await fetchDailyBars(ticker, FETCH_RANGE);
            if (!res) { failed++; return; }
            fetched++;
            if (res.meta?.instrumentType && res.meta.instrumentType !== 'EQUITY') { skippedType++; return; }
            const bars = res.bars;
            if (bars.length < 60) return;
            const S = prepare(bars, {
                ipoStart: spyDates.length > 5 && bars[0].date > spyDates[5],
                factor: splitFactors(bars.map(b => b.date), res.splits),
            });
            for (let k = 0; k < S.n; k++) {
                const d = S.dates[k];
                if (d < FROM || !rsBy.has(d) || !inRankUniverse(S, k)) continue;
                const sc = rsScore(S, k);
                if (!Number.isNaN(sc)) rsBy.get(d).push(sc);
                dvBy.get(d).push(dollarVol(S, k));
                if (!Number.isNaN(S.sma50[k])) { const b = breadthBy.get(d); b.n++; if (S.c[k] > S.sma50[k]) b.up++; }
            }
            for (const st of countedSetups(S, 30, S.n - 1)) {
                const d = S.dates[st.s];
                if (d < FROM) continue;
                const tier = passesBuyRules(st, TOP, OPEN_MKT) ? 'buy' : passesTrackRules(st, TOP, OPEN_MKT) ? 'track' : null;
                if (!tier) continue;
                const c = S.c[st.s];
                const m = {
                    ticker, family: st.fam, setup_type: FAMILY_LABELS[st.fam], price: c,
                    timing_status: c >= st.pivot * 0.98 ? 'AT_PIVOT' : 'NEAR_PIVOT',
                    recent_pivot: st.pivot, struct_stop: st.structStop,
                    suggested_stop: initialStop(st.pivot, st.structStop),
                    suggested_stop_pct: RULES.stopMaxPct, up_from_low52: st.feats.upLow52,
                    relative_strength_3mo: null, tier,
                };
                m.suggested_stop_pct = (st.pivot - m.suggested_stop) / st.pivot * 100;
                const sig = { id: signalId(ticker, d, st.fam), source: 'backfill', signal_date: d, ...pickFields(m, d) };
                sig.outcome = computeOutcome(sig, bars, spyByDate, S);
                // Days the live screener would have listed it (until it triggers).
                const lastListed = Math.min(S.n - 1, st.s + RULES.entryWindow - 1, st.eb >= 0 ? st.eb - 1 : Infinity);
                const listed = S.dates.slice(st.s, lastListed + 1);
                cands.push({ sig, st: { fam: st.fam, trap: st.trap, feats: st.feats }, tier, rsScore: rsScore(S, st.s), dv: st.feats.dv, listed });
            }
        }));
        await sleep(150);
    }
    console.log(`Fetched ${fetched}, failed ${failed}, non-equity ${skippedType}; ${cands.length} pre-rank candidates.`);
    if (failed / tickers.length > 0.1) throw new Error('Too many fetch failures; not writing.');

    for (const a of rsBy.values()) a.sort((x, y) => x - y);
    for (const a of dvBy.values()) a.sort((x, y) => x - y);

    const days = Object.fromEntries(dates.map(d => [d, { source: 'backfill', tickers: [] }]));
    const signals = [];
    for (const c of cands) {
        const d = c.sig.signal_date;
        const ranks = { rs: percentile(rsBy.get(d), c.rsScore), dvPct: percentile(dvBy.get(d), c.dv) };
        const b = breadthBy.get(d);
        const mkt = { ...mktByDate.get(d), breadth: b?.n ? b.up / b.n * 100 : NaN };
        if (!(c.tier === 'buy' ? passesBuyRules : passesTrackRules)(c.st, ranks, mkt)) continue;
        c.sig.rs_rank = Number(ranks.rs.toFixed(1));
        c.sig.dv_rank = Number(ranks.dvPct.toFixed(1));
        signals.push(c.sig);
        if (c.tier === 'track') continue;
        for (const ld of c.listed) if (days[ld] && !days[ld].tickers.includes(c.sig.ticker)) days[ld].tickers.push(c.sig.ticker);
    }

    // Keep any live history; replace previous backfill data.
    const prevRecord = readJson(TRACK_RECORD_PATH, { signals: [] });
    const prevDays = readJson(PICK_DAYS_PATH, { days: {} }).days;
    const keptSignals = prevRecord.signals.filter(s => s.source !== 'backfill');
    const liveDays = Object.fromEntries(Object.entries(prevDays).filter(([, v]) => v.source === 'live'));
    for (const d of Object.keys(days)) {
        days[d].tickers.sort();
        if (liveDays[d]) delete days[d];
    }
    writeTrackRecord([...signals, ...keptSignals], { ...days, ...liveDays }, {
        backfill: {
            generated_at: new Date().toISOString(), from: FROM, to: lastDate, universe: tickers.length,
            years: BACKFILL_YEARS, rules_version: RULES_VERSION,
        },
    }, spy);
    const closed = signals.filter(s => s.outcome.status === 'closed' && s.tier !== 'track');
    const avgR = closed.reduce((a, s) => a + s.outcome.r, 0) / (closed.length || 1);
    console.log(`Wrote ${signals.length} backfill signals (${closed.length} closed, avg R ${avgR.toFixed(3)}) over ${dates.length} sessions.`);
}

main().catch(e => { console.error(e); process.exit(1); });
