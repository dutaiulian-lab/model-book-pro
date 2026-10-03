// One-off backfill of the track record: replays the screener's technical rules
// for every trading day of the past year, using the same 1-year window of
// daily bars the live scan would have seen on that day.
//
// Limitations (shown in the dashboard too): fundamentals and earnings dates are
// not available historically, so those filters are skipped; and today's ticker
// list omits stocks delisted since, which flatters results.
//
// Usage: node scripts/backfill-track-record.mjs
import { evaluateTechnicals } from './lib/technicals.mjs';
import { fetchAllUSTickers } from './lib/universe.mjs';
import {
    NEW_SIGNAL_LOOKBACK, computeOutcome, fetchDailyBars, pickFields, readJson,
    writeTrackRecord, TRACK_RECORD_PATH, PICK_DAYS_PATH,
} from './lib/track-record.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const minusOneYear = (date) => `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;

async function main() {
    const spy = (await fetchDailyBars('SPY', '2y'))?.bars;
    if (!spy?.length) throw new Error('Could not fetch SPY');
    const spyByDate = new Map(spy.map(b => [b.date, b]));
    // Signal days: every SPY session with a full year of history before it.
    const firstFull = spy.find(b => b.date > minusOneYear(spy[spy.length - 1].date) && minusOneYear(b.date) >= spy[0].date);
    const dates = spy.filter(b => b.date >= firstFull.date).map(b => b.date);
    const dateIdx = new Map(dates.map((d, i) => [d, i]));
    // SPY 3-month performance on each day, as the live scan computes it.
    const spy3mo = new Map();
    for (const d of dates) {
        const win = spy.filter(b => b.date > minusOneYear(d) && b.date <= d);
        const past = win[win.length - 1 - 63];
        if (past) spy3mo.set(d, ((win[win.length - 1].close - past.close) / past.close) * 100);
    }
    console.log(`Backfilling ${dates.length} sessions: ${dates[0]} .. ${dates[dates.length - 1]}`);

    const tickers = await fetchAllUSTickers();
    if (tickers.length < 1000) throw new Error(`Universe too small (${tickers.length})`);

    const days = Object.fromEntries(dates.map(d => [d, { source: 'backfill', tickers: [] }]));
    const signals = [];
    let fetched = 0, failed = 0;
    const batchSize = 25;
    for (let i = 0; i < tickers.length; i += batchSize) {
        if (i % 500 === 0) console.log(`progress ${i}/${tickers.length}, signals so far ${signals.length}`);
        await Promise.all(tickers.slice(i, i + batchSize).map(async (ticker) => {
            const res = await fetchDailyBars(ticker, '2y');
            if (!res) { failed++; return; }
            fetched++;
            const bars = res.bars;
            const matchDays = new Set();
            const matches = [];
            let lo = 0;
            for (let k = 0; k < bars.length; k++) {
                const d = bars[k].date;
                if (!dateIdx.has(d)) continue;
                const startDate = minusOneYear(d);
                while (lo < k && bars[lo].date <= startDate) lo++;
                const m = evaluateTechnicals(ticker, bars.slice(lo, k + 1), {}, spy3mo.get(d) ?? null);
                if (m) { matchDays.add(d); matches.push([d, m]); }
            }
            for (const [d, m] of matches) {
                days[d].tickers.push(ticker);
                const di = dateIdx.get(d);
                const prior = dates.slice(Math.max(0, di - NEW_SIGNAL_LOOKBACK), di);
                if (prior.some(p => matchDays.has(p))) continue;
                const sig = { id: `${ticker}|${d}|backfill`, source: 'backfill', signal_date: d, ...pickFields(m) };
                sig.outcome = computeOutcome(sig, bars, spyByDate);
                signals.push(sig);
            }
        }));
        await sleep(150);
    }
    console.log(`Fetched ${fetched}, failed ${failed}.`);
    if (failed / tickers.length > 0.1) throw new Error('Too many fetch failures; not writing.');

    // Keep any live history; replace previous backfill data.
    const prevRecord = readJson(TRACK_RECORD_PATH, { signals: [] });
    const prevDays = readJson(PICK_DAYS_PATH, { days: {} }).days;
    const liveSignals = prevRecord.signals.filter(s => s.source === 'live');
    const liveDays = Object.fromEntries(Object.entries(prevDays).filter(([, v]) => v.source === 'live'));
    for (const d of Object.keys(days)) {
        days[d].tickers.sort();
        if (liveDays[d]) delete days[d];
    }
    writeTrackRecord([...signals, ...liveSignals], { ...days, ...liveDays }, {
        backfill: { generated_at: new Date().toISOString(), from: dates[0], to: dates[dates.length - 1], universe: tickers.length },
    });
    const closed = signals.filter(s => s.outcome.status === 'closed').length;
    console.log(`Wrote ${signals.length} backfill signals (${closed} closed) over ${dates.length} sessions.`);
}

main().catch(e => { console.error(e); process.exit(1); });
