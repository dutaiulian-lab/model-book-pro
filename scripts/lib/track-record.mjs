// Track record: turns daily screener picks into "signals" and measures what
// happened next, so the screener's rules can be judged on evidence.
//
// Trade model (the plan the rule research selected; mechanical on purpose):
//   - A ticker becomes a new signal on the first scan day it appears after
//     being absent for NEW_SIGNAL_LOOKBACK scan days.
//   - Entry: buy stop at the pivot (prior 10-day high), valid for ENTRY_WINDOW
//     sessions after the signal. Fills at the pivot, or at the open if the
//     stock gaps above it. No break within the window = "not triggered".
//   - Initial stop: the lower of the structural stop and 5% below the fill.
//     On the entry day only a close below the stop counts (the intraday low
//     may have come before the breakout); afterwards any touch exits, at the
//     stop or at the open if it gaps through.
//   - Exit: the first close below the 50-day SMA, or the close of session
//     MAX_HOLD_DAYS.
//   - R = (exit - entry) / (entry - stop). Account return assumes 1% account
//     risk per trade with positions capped at 25% of the account.
import fs from 'fs';
import path from 'path';

export const ENTRY_WINDOW = 5;
export const MIN_STOP_PCT = 5;
export const EXIT_SMA = 50;
export const MAX_HOLD_DAYS = 120;
export const HORIZONS = [1, 5, 10, 20];
export const BIG_WIN_PCT = 30;
export const NEW_SIGNAL_LOOKBACK = 5;
// Live signals stop being refreshed after this many calendar days (covers the
// entry window plus the maximum hold).
export const EXPIRE_CALENDAR_DAYS = 200;
// Bars needed before the signal for the exit SMA, plus the forward window.
export const BARS_RANGE = '1y';

export const TRACK_RECORD_PATH = path.join(process.cwd(), 'public', 'track-record.json');
export const PICK_DAYS_PATH = path.join(process.cwd(), 'public', 'pick-days.json');

export const SETTINGS = {
    entry: `Buy stop at the pivot, valid ${ENTRY_WINDOW} sessions`,
    stop: `Lower of the structural stop and ${MIN_STOP_PCT}% below the fill`,
    exit: `First close below the ${EXIT_SMA}-day SMA, or session ${MAX_HOLD_DAYS}`,
    sizing: '1% account risk per trade, position capped at 25%',
    entry_window: ENTRY_WINDOW,
    max_hold_days: MAX_HOLD_DAYS,
    new_signal_lookback: NEW_SIGNAL_LOOKBACK,
    rules_version: '2026-10 (C)',
};

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const pct = (a, b) => ((a - b) / b) * 100;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fields kept from a screener match when it becomes a signal.
export function pickFields(m) {
    return {
        ticker: m.ticker,
        setup_type: m.setup_type,
        timing_status: m.timing_status,
        price: round(m.price, 4),
        pivot: round(m.recent_pivot, 4),
        struct_stop: round(m.struct_stop ?? m.suggested_stop, 4),
        stop: round(m.suggested_stop, 4),
        stop_pct: round(m.suggested_stop_pct),
        up_from_low52: round(m.up_from_low52, 1),
        rs_3mo: round(m.relative_strength_3mo, 1),
    };
}

// True if `ticker` was absent from the previous NEW_SIGNAL_LOOKBACK scan days
// of the same source.
export function isNewSignal(ticker, date, days, source) {
    const prior = Object.keys(days)
        .filter(d => d < date && days[d].source === source)
        .sort()
        .slice(-NEW_SIGNAL_LOOKBACK);
    return !prior.some(d => days[d].tickers.includes(ticker));
}

// Account return (% of account) for a trade returning `retPct` with `riskPct`
// between entry and stop: 1% risk, position capped at 25%.
export const accountReturn = (retPct, riskPct) => retPct * Math.min(1 / riskPct, 0.25);

// `bars`: the ticker's daily bars, oldest first, including at least
// EXIT_SMA - 1 sessions before the signal for the exit SMA.
// `spyByDate`: Map date -> SPY bar.
export function computeOutcome(sig, bars, spyByDate) {
    const start = bars.findIndex(b => b.date > sig.signal_date);
    if (start < 0) return { status: 'pending' };
    const pivot = sig.pivot;
    const structStop = sig.struct_stop ?? sig.stop;
    if (!(pivot > 0) || !(structStop > 0)) return { status: 'skipped', note: 'Missing pivot or stop' };

    // Entry: first session within the window whose high clears the pivot.
    let eb = -1;
    for (let k = start; k < Math.min(bars.length, start + ENTRY_WINDOW); k++) {
        if (bars[k].high > pivot) { eb = k; break; }
    }
    if (eb < 0) {
        return bars.length - start >= ENTRY_WINDOW
            ? { status: 'no_entry', note: `Pivot not broken within ${ENTRY_WINDOW} sessions` }
            : { status: 'pending', days_waiting: bars.length - start };
    }
    const entry = Math.max(bars[eb].open, pivot);
    const stop = Math.min(structStop, entry * (1 - MIN_STOP_PCT / 100));
    const risk = entry - stop;
    const o = {
        entry_date: bars[eb].date, entry: round(entry, 4), stop: round(stop, 4),
        risk_pct: round((risk / entry) * 100), breakout_day: eb - start + 1,
    };

    const smaAt = (k) => {
        if (k < EXIT_SMA - 1) return null;
        let s = 0;
        for (let j = k - EXIT_SMA + 1; j <= k; j++) s += bars[j].close;
        return s / EXIT_SMA;
    };
    const last = Math.min(bars.length - 1, eb + MAX_HOLD_DAYS - 1);
    let exit = null, xk = -1;
    for (let k = eb; k <= last; k++) {
        const b = bars[k];
        if (k === eb ? b.close < stop : b.low <= stop) {
            exit = k === eb ? b.close : Math.min(stop, b.open);
            o.exit_reason = 'stop';
            xk = k;
            break;
        }
        const sma = smaAt(k);
        if (k > eb && sma != null && b.close < sma) {
            exit = b.close; o.exit_reason = `sma${EXIT_SMA}`; xk = k;
            break;
        }
        if (k === eb + MAX_HOLD_DAYS - 1) { exit = b.close; o.exit_reason = 'time'; xk = k; }
    }
    const endK = xk >= 0 ? xk : last;
    o.days = endK - eb + 1;

    const spyEntry = spyByDate.get(bars[eb].date)?.open;
    for (const h of HORIZONS) {
        const k = eb + h - 1;
        if (k >= bars.length) continue;
        o[`ret_${h}d`] = round(pct(bars[k].close, entry));
        const spyClose = spyByDate.get(bars[k].date)?.close;
        if (spyEntry && spyClose) o[`xs_${h}d`] = round(o[`ret_${h}d`] - pct(spyClose, spyEntry));
    }
    const win60 = bars.slice(eb, Math.min(bars.length, eb + 60));
    o.max_gain = round(pct(Math.max(...win60.map(b => b.high)), entry));
    o.max_dd = round(pct(Math.min(...bars.slice(eb, endK + 1).map(b => b.low)), entry));

    if (exit === null) {
        const mark = bars[bars.length - 1].close;
        o.status = 'open';
        o.mark = round(mark, 4);
        o.r = round((mark - entry) / risk);
        return o;
    }
    o.status = 'closed';
    o.exit_date = bars[xk].date;
    o.exit = round(exit, 4);
    o.r = round((exit - entry) / risk);
    o.ret = round(pct(exit, entry));
    o.acct = round(accountReturn(o.ret, o.risk_pct), 3);
    return o;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sum = (a) => a.reduce((s, x) => s + x, 0);
function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stats(list) {
    const closed = list.filter(s => s.outcome?.status === 'closed' && s.outcome.r != null);
    const rs = closed.map(s => s.outcome.r);
    const wins = rs.filter(r => r > 0);
    const losses = rs.filter(r => r <= 0);
    const entered = list.filter(s => s.outcome?.entry_date);
    const decided = list.filter(s => s.outcome?.entry_date || s.outcome?.status === 'no_entry');
    const with20 = entered.filter(s => s.outcome.ret_20d != null);
    const xs20 = with20.map(s => s.outcome.xs_20d).filter(x => x != null);
    const with60 = entered.filter(s => s.outcome.max_gain != null);
    return {
        signals: list.length,
        closed: closed.length,
        open: list.filter(s => ['open', 'pending'].includes(s.outcome?.status)).length,
        no_entry: list.filter(s => s.outcome?.status === 'no_entry').length,
        skipped: list.filter(s => s.outcome?.status === 'skipped').length,
        trigger_rate: decided.length ? round((entered.length / decided.length) * 100, 1) : null,
        win_rate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
        avg_r: round(mean(rs)),
        median_r: round(median(rs)),
        avg_win_r: round(mean(wins)),
        avg_loss_r: round(mean(losses)),
        profit_factor: losses.length && sum(losses) < 0 ? round(sum(wins) / -sum(losses)) : null,
        avg_acct: round(mean(closed.map(s => s.outcome.acct).filter(x => x != null)), 3),
        avg_days: round(mean(closed.map(s => s.outcome.days)), 1),
        stop_rate: closed.length
            ? round((closed.filter(s => s.outcome.exit_reason === 'stop').length / closed.length) * 100, 1) : null,
        big_win_rate: with60.length
            ? round((with60.filter(s => s.outcome.max_gain >= BIG_WIN_PCT).length / with60.length) * 100, 1) : null,
        n_20d: with20.length,
        avg_ret_20d: round(mean(with20.map(s => s.outcome.ret_20d))),
        avg_xs_20d: round(mean(xs20)),
    };
}

function groupStats(list, keyFn) {
    const groups = {};
    for (const s of list) (groups[keyFn(s)] ||= []).push(s);
    return Object.fromEntries(Object.entries(groups).sort().map(([k, v]) => [k, stats(v)]));
}

export function summarize(signals) {
    const out = {};
    for (const source of ['live', 'backfill']) {
        const s = signals.filter(x => x.source === source);
        out[source] = {
            overall: stats(s),
            by_setup: groupStats(s, x => x.setup_type),
            by_timing: groupStats(s, x => x.timing_status),
            by_month: groupStats(s, x => x.signal_date.slice(0, 7)),
        };
    }
    return out;
}

export function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

export function writeTrackRecord(signals, days, extra = {}) {
    signals.sort((a, b) => (a.signal_date === b.signal_date
        ? a.ticker.localeCompare(b.ticker) : a.signal_date.localeCompare(b.signal_date)));
    const sortedDays = Object.fromEntries(Object.entries(days).sort());
    fs.writeFileSync(TRACK_RECORD_PATH, JSON.stringify({
        generated_at: new Date().toISOString(),
        settings: SETTINGS,
        ...extra,
        summary: summarize(signals),
        signals,
    }));
    fs.writeFileSync(PICK_DAYS_PATH, JSON.stringify({ days: sortedDays }));
}

// Daily bars from Yahoo's chart API, oldest first. Drops today's partial bar
// while the regular session is open (same rule as the screener).
export async function fetchDailyBars(ticker, range, attempts = 3) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            if (!res.ok) return null;
            const data = (await res.json()).chart?.result?.[0];
            const ts = data?.timestamp;
            if (!ts?.length) return null;
            const q = data.indicators.quote[0];
            const bars = [];
            for (let j = 0; j < ts.length; j++) {
                if (q.close[j] !== null && q.volume[j] !== null && q.high[j] !== null && q.low[j] !== null) {
                    bars.push({
                        date: new Date(ts[j] * 1000).toISOString().split('T')[0],
                        open: q.open[j], high: q.high[j], low: q.low[j], close: q.close[j], volume: q.volume[j],
                    });
                }
            }
            const regular = data.meta?.currentTradingPeriod?.regular;
            const lastTs = ts[ts.length - 1];
            if (regular && Date.now() / 1000 < regular.end && lastTs >= regular.start && bars.length &&
                bars[bars.length - 1].date === new Date(lastTs * 1000).toISOString().split('T')[0]) {
                bars.pop();
            }
            return { bars, meta: data.meta };
        } catch (e) {
            if (i === attempts - 1) return null;
            await sleep(1000 * 2 ** i);
        }
    }
    return null;
}
