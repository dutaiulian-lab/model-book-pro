// Track record: turns daily screener picks into "signals" and measures what
// happened next, so the screener's rules can be judged on evidence.
//
// Trade model (the plan the 20-year rule study selected; mechanical on purpose,
// implemented once in lib/leader-rules.mjs simulateTrade):
//   - A signal is one setup: ticker + setup day + setup family. The screener
//     lists it every day its buy stop is live, but it is recorded once.
//   - Entry: buy stop at the pivot, valid ENTRY_WINDOW sessions after the
//     setup day. Fills at the pivot, or at the open if the stock gaps above it.
//     No break within the window = "not triggered".
//   - Initial stop: the structural stop (for non-coil setups lowered to any
//     low printed while waiting), clamped to 3%-8% below the fill. On the entry
//     day only a close below the stop counts; afterwards any touch exits, at
//     the stop or at the open if it gaps through.
//   - Exit: the first close below the 50-day SMA; once a close is >= 20% above
//     the fill, the first close below the 21-day EMA instead. Max 252 sessions.
//   - R = (exit - entry) / (entry - stop). Account return assumes 1% account
//     risk per trade with positions capped at 25% of the account.
import fs from 'fs';
import path from 'path';
import { RULES, RULES_VERSION, prepare, simulateTrade, parseChart } from './leader-rules.mjs';

export const ENTRY_WINDOW = RULES.entryWindow;
export const MAX_HOLD_DAYS = RULES.maxHold;
export const HORIZONS = [1, 5, 10, 20];
export const BIG_WIN_PCT = 30;
// Live signals stop being refreshed after this many calendar days (covers the
// entry window plus the 252-session maximum hold).
export const EXPIRE_CALENDAR_DAYS = 400;
// Bars needed before the signal for the exit averages, plus the forward window.
export const BARS_RANGE = '2y';

export const TRACK_RECORD_PATH = path.join(process.cwd(), 'public', 'track-record.json');
export const PICK_DAYS_PATH = path.join(process.cwd(), 'public', 'pick-days.json');

export const SETTINGS = {
    entry: `Buy stop at the pivot, valid ${ENTRY_WINDOW} sessions after the setup day`,
    stop: `Structural stop clamped to ${RULES.stopMinPct}%-${RULES.stopMaxPct}% below the fill`,
    exit: `First close below the 50-day SMA (21-day EMA once up ${RULES.trailAfterGainPct}%), or session ${MAX_HOLD_DAYS}`,
    sizing: '1% account risk per trade, position capped at 25%',
    signal: 'Each setup (ticker, setup day, family) counts once',
    entry_window: ENTRY_WINDOW,
    max_hold_days: MAX_HOLD_DAYS,
    rules_version: RULES_VERSION,
};

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const pct = (a, b) => ((a - b) / b) * 100;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const signalId = (ticker, signalDate, family) => `${ticker}|${signalDate}|${family}`;

// Fields kept from a screener match when it becomes a signal. ref_date /
// ref_close let outcomes be rescaled if the stock splits later (Yahoo bars are
// split-adjusted, the stored pivot is not).
export function pickFields(m, refDate) {
    return {
        ticker: m.ticker,
        family: m.family,
        setup_type: m.setup_type,
        timing_status: m.timing_status,
        price: round(m.price, 4),
        pivot: round(m.recent_pivot, 4),
        struct_stop: round(m.struct_stop ?? m.suggested_stop, 4),
        stop: round(m.suggested_stop, 4),
        stop_pct: round(m.suggested_stop_pct),
        up_from_low52: round(m.up_from_low52, 1),
        rs_rank: round(m.rs_rank, 1),
        dv_rank: round(m.dv_rank, 1),
        rs_3mo: round(m.relative_strength_3mo, 1),
        ref_date: refDate,
        ref_close: round(m.price, 4),
    };
}

// Account return (% of account) for a trade returning `retPct` with `riskPct`
// between entry and stop: 1% risk, position capped at 25%.
export const accountReturn = (retPct, riskPct) => retPct * Math.min(1 / riskPct, 0.25);

// `bars`: the ticker's daily bars, oldest first, including at least 50
// sessions before the signal for the exit SMA. `spyByDate`: Map date -> SPY bar.
// `S` (optional): prepare(bars), when the caller already has it.
export function computeOutcome(sig, bars, spyByDate, S = null) {
    const s = bars.findIndex(b => b.date === sig.signal_date);
    if (s < 0) {
        return bars.length && bars[bars.length - 1].date < sig.signal_date
            ? { status: 'pending' } : { status: 'skipped', note: 'Signal date not in price history' };
    }
    let pivot = sig.pivot;
    let structStop = sig.struct_stop ?? sig.stop;
    if (!(pivot > 0) || !(structStop > 0)) return { status: 'skipped', note: 'Missing pivot or stop' };
    // Rescale for splits after the signal.
    const ri = sig.ref_date ? bars.findIndex(b => b.date === sig.ref_date) : -1;
    if (ri >= 0 && sig.ref_close > 0) {
        const k = bars[ri].close / sig.ref_close;
        if (Math.abs(k - 1) > 0.03) { pivot *= k; structStop *= k; }
    }
    S ||= prepare(bars);
    const tr = simulateTrade(S, s, pivot, structStop, sig.family || 'RANGE');
    if (tr.status === 'no_entry') return { status: 'no_entry', note: `Pivot not broken within ${ENTRY_WINDOW} sessions` };
    if (tr.status === 'pending') return { status: 'pending', days_waiting: tr.days_waiting };

    const eb = tr.eb, entry = tr.entry;
    const o = {
        entry_date: bars[eb].date, entry: round(entry, 4), stop: round(tr.stop, 4),
        risk_pct: round(tr.risk_pct), breakout_day: eb - s,
    };
    const endK = tr.status === 'closed' ? tr.xj : tr.last;
    o.days = endK - eb + 1;
    if (tr.trail21) o.trailing = 'ema21';

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

    if (tr.status === 'open') {
        o.status = 'open';
        o.mark = round(tr.mark, 4);
        o.r = round(tr.r);
        o.ret = round(pct(tr.mark, entry));
        return o;
    }
    o.status = 'closed';
    o.exit_reason = tr.reason;
    o.exit_date = bars[tr.xj].date;
    o.exit = round(tr.exit, 4);
    o.r = round(tr.r);
    o.ret = round(tr.ret);
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
            by_year: groupStats(s, x => x.signal_date.slice(0, 4)),
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

// Daily bars from Yahoo's chart API, oldest first, plus split events. Drops
// today's partial bar while the regular session is open (same rule as the
// screener). `range` ('2y') or { period1, period2 } in epoch seconds.
export async function fetchDailyBars(ticker, range, attempts = 3) {
    const span = typeof range === 'string' ? `range=${range}` : `period1=${range.period1}&period2=${range.period2}`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${span}&interval=1d&events=split`;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            if (!res.ok) return null;
            const data = (await res.json()).chart?.result?.[0];
            if (!data) return null;
            const parsed = parseChart(data);
            if (!parsed || !parsed.history.length) return null;
            return { bars: parsed.history, splits: parsed.splits, meta: data.meta };
        } catch (e) {
            if (i === attempts - 1) return null;
            await sleep(1000 * 2 ** i);
        }
    }
    return null;
}
