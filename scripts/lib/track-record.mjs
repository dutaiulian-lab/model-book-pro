// Track record: turns daily screener picks into "signals" and measures what
// happened next, so the screener's rules can be judged on evidence.
//
// Trade model (deliberately simple and mechanical):
//   - A ticker becomes a new signal on the first scan day it appears after
//     being absent for NEW_SIGNAL_LOOKBACK scan days.
//   - Entry: the next session's open (the scan runs after the close, so the
//     signal-day close is not tradable).
//   - Exit: the suggested stop if any later low touches it (filled at the stop,
//     or at the open if it gaps through), otherwise the close of day HOLD_DAYS.
//   - R = (exit - entry) / (entry - stop). If the stock opens at or below the
//     stop, the trade is "skipped" and excluded from R statistics.
import fs from 'fs';
import path from 'path';

export const HOLD_DAYS = 20;
export const HORIZONS = [1, 5, 10, 20];
export const NEW_SIGNAL_LOOKBACK = 5;
export const EXPIRE_CALENDAR_DAYS = 60;

export const TRACK_RECORD_PATH = path.join(process.cwd(), 'public', 'track-record.json');
export const PICK_DAYS_PATH = path.join(process.cwd(), 'public', 'pick-days.json');

export const SETTINGS = {
    entry: 'Next session open',
    exit: `Suggested stop, or close of trading day ${HOLD_DAYS}`,
    hold_days: HOLD_DAYS,
    new_signal_lookback: NEW_SIGNAL_LOOKBACK,
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
        stop: round(m.suggested_stop, 4),
        stop_pct: round(((m.price - m.suggested_stop) / m.price) * 100),
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

// `bars`: the ticker's daily bars (oldest first) covering at least the signal
// date onwards. `spyByDate`: Map date -> SPY bar.
export function computeOutcome(sig, bars, spyByDate) {
    const start = bars.findIndex(b => b.date > sig.signal_date);
    if (start < 0) return { status: 'pending' };
    const fwd = bars.slice(start, start + HOLD_DAYS);
    const entry = fwd[0].open;
    if (!(entry > 0)) return { status: 'pending' };

    const o = { entry_date: fwd[0].date, entry: round(entry, 4), days: fwd.length };
    const spyEntry = spyByDate.get(fwd[0].date)?.open;
    for (const h of HORIZONS) {
        if (fwd.length < h) continue;
        const bar = fwd[h - 1];
        o[`ret_${h}d`] = round(pct(bar.close, entry));
        const spyClose = spyByDate.get(bar.date)?.close;
        if (spyEntry && spyClose) o[`xs_${h}d`] = round(o[`ret_${h}d`] - pct(spyClose, spyEntry));
    }
    o.max_gain = round(pct(Math.max(...fwd.map(b => b.high)), entry));
    o.max_dd = round(pct(Math.min(...fwd.map(b => b.low)), entry));
    const bo = sig.pivot ? fwd.findIndex(b => b.high > sig.pivot) : -1;
    o.breakout_day = bo >= 0 ? bo + 1 : null;

    if (!(sig.stop > 0)) {
        o.status = fwd.length >= HOLD_DAYS ? 'closed' : 'open';
        o.r = null;
        return o;
    }
    if (entry <= sig.stop) {
        o.status = 'skipped';
        o.note = 'Opened at or below the stop';
        return o;
    }
    const risk = entry - sig.stop;
    let exit = null;
    for (let i = 0; i < fwd.length; i++) {
        if (fwd[i].low <= sig.stop) {
            // Entry day opened above the stop, so a touch fills at the stop;
            // later days can gap through it and fill at the open.
            exit = i === 0 ? sig.stop : Math.min(sig.stop, fwd[i].open);
            o.exit_reason = 'stop';
            o.exit_day = i + 1;
            break;
        }
    }
    if (exit === null) {
        const last = fwd[fwd.length - 1];
        if (fwd.length < HOLD_DAYS) {
            o.status = 'open';
            o.mark = round(last.close, 4);
            o.r = round((last.close - entry) / risk);
            return o;
        }
        exit = last.close;
        o.exit_reason = 'time';
        o.exit_day = HOLD_DAYS;
    }
    o.status = 'closed';
    o.exit = round(exit, 4);
    o.r = round((exit - entry) / risk);
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
    const with20 = list.filter(s => s.outcome?.ret_20d != null);
    const xs20 = with20.map(s => s.outcome.xs_20d).filter(x => x != null);
    return {
        signals: list.length,
        closed: closed.length,
        open: list.filter(s => ['open', 'pending'].includes(s.outcome?.status)).length,
        skipped: list.filter(s => s.outcome?.status === 'skipped').length,
        win_rate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
        avg_r: round(mean(rs)),
        median_r: round(median(rs)),
        avg_win_r: round(mean(wins)),
        avg_loss_r: round(mean(losses)),
        profit_factor: losses.length && sum(losses) < 0 ? round(sum(wins) / -sum(losses)) : null,
        stop_rate: closed.length
            ? round((closed.filter(s => s.outcome.exit_reason === 'stop').length / closed.length) * 100, 1) : null,
        breakout_rate: entered.length
            ? round((entered.filter(s => s.outcome.breakout_day != null).length / entered.length) * 100, 1) : null,
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
