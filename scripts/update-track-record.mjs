// Daily track record update, run by the workflow right after the screener.
//  1. Records today's live picks (public/market-state.json) and a dated copy
//     in public/history/.
//  2. Refreshes the outcome of every signal still inside its holding window.
//  3. Rewrites public/track-record.json and public/pick-days.json.
// Safe to re-run: picks for the same as_of date are replaced, not duplicated.
import fs from 'fs';
import path from 'path';
import {
    BARS_RANGE, EXPIRE_CALENDAR_DAYS, computeOutcome, fetchDailyBars, isNewSignal, pickFields,
    readJson, writeTrackRecord, TRACK_RECORD_PATH, PICK_DAYS_PATH,
} from './lib/track-record.mjs';

const OPEN = new Set(['pending', 'open']);

async function main() {
    const statePath = path.join(process.cwd(), 'public', 'market-state.json');
    const state = readJson(statePath, null);
    const record = readJson(TRACK_RECORD_PATH, { signals: [] });
    const days = readJson(PICK_DAYS_PATH, { days: {} }).days;
    let signals = record.signals;

    if (state?.as_of && Array.isArray(state.matches)) {
        const asOf = state.as_of;
        days[asOf] = { source: 'live', tickers: state.matches.map(m => m.ticker).sort() };
        signals = signals.filter(s => !(s.source === 'live' && s.signal_date === asOf));
        let added = 0;
        for (const m of state.matches) {
            if (!isNewSignal(m.ticker, asOf, days, 'live')) continue;
            signals.push({
                id: `${m.ticker}|${asOf}|live`, source: 'live', signal_date: asOf,
                ...pickFields(m), outcome: { status: 'pending' },
            });
            added++;
        }
        const histDir = path.join(process.cwd(), 'public', 'history');
        fs.mkdirSync(histDir, { recursive: true });
        fs.copyFileSync(statePath, path.join(histDir, `${asOf}.json`));
        console.log(`Recorded ${state.matches.length} picks for ${asOf} (${added} new signals).`);
    } else {
        console.log('market-state.json has no as_of date; only refreshing outcomes.');
    }

    // Refresh signals still inside their holding window.
    const cutoff = new Date(Date.now() - EXPIRE_CALENDAR_DAYS * 86400e3).toISOString().slice(0, 10);
    for (const s of signals) {
        if (OPEN.has(s.outcome?.status) && s.signal_date < cutoff) {
            s.outcome = { ...s.outcome, status: 'expired' };
        }
    }
    const toRefresh = signals.filter(s => OPEN.has(s.outcome?.status));
    if (toRefresh.length) {
        const spy = (await fetchDailyBars('SPY', BARS_RANGE))?.bars;
        if (!spy) throw new Error('Could not fetch SPY');
        const spyByDate = new Map(spy.map(b => [b.date, b]));
        const tickers = [...new Set(toRefresh.map(s => s.ticker))];
        const barsByTicker = new Map();
        for (let i = 0; i < tickers.length; i += 10) {
            await Promise.all(tickers.slice(i, i + 10).map(async t => {
                const res = await fetchDailyBars(t, BARS_RANGE);
                if (res) barsByTicker.set(t, res.bars);
            }));
        }
        let updated = 0;
        for (const s of toRefresh) {
            const bars = barsByTicker.get(s.ticker);
            if (!bars) continue;
            s.outcome = computeOutcome(s, bars, spyByDate);
            updated++;
        }
        console.log(`Refreshed ${updated}/${toRefresh.length} open signals (${tickers.length} tickers).`);
    }

    const { summary, signals: _s, generated_at, settings, ...extra } = record;
    writeTrackRecord(signals, days, extra);
    console.log(`Track record: ${signals.length} signals across ${Object.keys(days).length} scan days.`);
}

main().catch(e => { console.error(e); process.exit(1); });
