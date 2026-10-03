// Daily track-record update, run after the screener:
//   1. records today's picks (pick-days.json + a dated copy of market-state.json);
//   2. adds every qualifying setup not seen before as a live signal;
//   3. refreshes outcomes of signals still waiting for a fill or still open.
import fs from 'fs';
import path from 'path';
import {
    BARS_RANGE, EXPIRE_CALENDAR_DAYS, computeOutcome, fetchDailyBars, pickFields, signalId,
    readJson, writeTrackRecord, TRACK_RECORD_PATH, PICK_DAYS_PATH,
} from './lib/track-record.mjs';
import { RULES_VERSION } from './lib/leader-rules.mjs';

const OPEN = new Set(['pending', 'open']);
const SPY_RANGE = '5y';

async function main() {
    const statePath = path.join(process.cwd(), 'public', 'market-state.json');
    const state = readJson(statePath, null);
    const record = readJson(TRACK_RECORD_PATH, { signals: [] });
    const days = readJson(PICK_DAYS_PATH, { days: {} }).days;
    let signals = record.signals;
    // Live signals recorded under older rule sets keep their last outcome but are
    // no longer refreshed or counted.
    for (const s of signals) if (s.source === 'live' && !s.family) s.source = 'legacy';

    if (state?.as_of && Array.isArray(state.matches)) {
        const asOf = state.as_of;
        days[asOf] = { source: 'live', tickers: state.matches.map(m => m.ticker).sort() };
        // Re-running on the same day replaces that day's additions.
        signals = signals.filter(s => !(s.source === 'live' && s.first_listed === asOf));
        // Backfilled copies of the same setup are kept separately (different source).
        const known = new Set(signals.filter(s => s.source === 'live').map(s => s.id));
        let added = 0;
        for (const m of state.matches) {
            const setups = m.setups?.length ? m.setups : [{
                family: m.family, setup_type: m.setup_type, signal_date: m.signal_date, pivot: m.recent_pivot,
                struct_stop: m.struct_stop, suggested_stop: m.suggested_stop, rs_rank: m.rs_rank, dv_rank: m.dv_rank,
            }];
            for (const st of setups) {
                if (!st.family || !st.signal_date) continue;
                const id = signalId(m.ticker, st.signal_date, st.family);
                if (known.has(id)) continue;
                known.add(id);
                const fields = pickFields({
                    ...m, family: st.family, setup_type: st.setup_type, recent_pivot: st.pivot, struct_stop: st.struct_stop,
                    suggested_stop: st.suggested_stop, suggested_stop_pct: (st.pivot - st.suggested_stop) / st.pivot * 100,
                    rs_rank: st.rs_rank, dv_rank: st.dv_rank,
                }, asOf);
                signals.push({
                    id, source: 'live', signal_date: st.signal_date, first_listed: asOf,
                    rules: state.rules_version || RULES_VERSION, ...fields, outcome: { status: 'pending' },
                });
                added++;
            }
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
        if (s.source !== 'legacy' && OPEN.has(s.outcome?.status) && s.signal_date < cutoff) {
            s.outcome = { ...s.outcome, status: 'expired' };
        }
    }
    const toRefresh = signals.filter(s => s.source !== 'legacy' && OPEN.has(s.outcome?.status));
    // SPY covers the backfill window too, for the account simulation.
    const spy = (await fetchDailyBars('SPY', SPY_RANGE))?.bars;
    if (!spy) throw new Error('Could not fetch SPY');
    if (toRefresh.length) {
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
    writeTrackRecord(signals, days, extra, spy);
    console.log(`Track record: ${signals.length} signals across ${Object.keys(days).length} scan days.`);
}

main().catch(e => { console.error(e); process.exit(1); });
