// Account-level simulation of the track record: one account trading every
// signal under the sizing rules, with limited cash and daily mark-to-market.
// It answers "would this have beaten SPY?", which per-trade R cannot.
//
// Rules (the same sizing the rule study used):
//   - Start with START dollars. Risk RISK_PCT of equity per trade; a position
//     is capped at MAX_POS_PCT of equity. Equity = cash + open positions at the
//     previous close.
//   - One position per ticker. Same-day fills are taken in RS-rank order.
//   - If cash covers less than MIN_FILL_FRAC of the wanted size, the signal is
//     skipped ("no cash"); otherwise the position is sized down to the cash.
//   - Fills are processed before that day's exits, so cash freed by an exit is
//     available the next session (conservative).
//   - Positions are marked at each session's close, using outcome.path (daily
//     % change of the close from the fill; the last value of a closed trade is
//     its exit return). Each session of a path is the next SPY session.
//   - The benchmark is SPY total return (dividend-adjusted close), indexed to
//     the same start date.
//   - Idle cash (opts.idle: Map date -> { on }, from leader-rules idleCashByDate):
//     on sessions after a close where `on` is true, the cash left after that
//     session's fills earns SPY's total return for the session (SPY is sold to
//     fund buys; exit proceeds arrive at the close). Without opts.idle cash
//     earns nothing.
export const PORTFOLIO = { START: 100000, RISK_PCT: 1, MAX_POS_PCT: 25, MIN_FILL_FRAC: 0.5 };

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

function maxDrawdown(series) {
    let peak = -Infinity, dd = 0;
    for (const v of series) {
        peak = Math.max(peak, v);
        dd = Math.max(dd, (1 - v / peak) * 100);
    }
    return dd;
}

function cagr(first, last, fromDate, toDate) {
    const years = (Date.parse(toDate) - Date.parse(fromDate)) / (365.25 * 86400e3);
    if (!(years > 0) || !(first > 0)) return null;
    // Annualizing very short windows produces silly numbers.
    if (years < 0.5) return null;
    return ((last / first) ** (1 / years) - 1) * 100;
}

function monthlyReturns(dates, values) {
    const out = [];
    let prevEnd = values[0];
    for (let k = 0; k < dates.length; k++) {
        const endOfMonth = k === dates.length - 1 || dates[k + 1].slice(0, 7) !== dates[k].slice(0, 7);
        if (!endOfMonth) continue;
        out.push({ month: dates[k].slice(0, 7), ret: (values[k] / prevEnd - 1) * 100 });
        prevEnd = values[k];
    }
    return out;
}

// signals: the signals of one source. spy: [{ date, close, adjclose }], oldest
// first. Returns null when there is nothing to simulate.
export function simulatePortfolio(signals, spy, opts = {}) {
    const P = { ...PORTFOLIO, ...opts };
    if (!signals.length || !spy?.length) return null;
    const start = signals.reduce((m, s) => (s.signal_date < m ? s.signal_date : m), signals[0].signal_date);
    const cal = spy.filter(b => b.date >= start);
    if (cal.length < 2) return null;
    const dates = cal.map(b => b.date);
    // First session on or after a date.
    const sessionOf = (d) => {
        let lo = 0, hi = dates.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; }
        return lo;
    };

    const trades = signals.filter(s => s.outcome?.entry_date && s.outcome.risk_pct > 0
        && Array.isArray(s.outcome.path) && s.outcome.path.length);
    const byEntry = new Map();
    for (const t of trades) {
        const k = sessionOf(t.outcome.entry_date);
        if (k >= dates.length) continue;
        (byEntry.get(k) || byEntry.set(k, []).get(k)).push(t);
    }
    for (const list of byEntry.values()) {
        list.sort((a, b) => (b.rs_rank ?? 0) - (a.rs_rank ?? 0) || a.ticker.localeCompare(b.ticker));
    }

    const spyTR = cal.map(b => b.adjclose ?? b.close);
    let cash = P.START;
    const spyShare = [];
    let held = [];
    let prevEquity = P.START;
    const equity = [], exposure = [], positions = [];
    const pnl = [];
    let taken = 0, skippedCash = 0, skippedHeld = 0, resized = 0;
    for (let k = 0; k < dates.length; k++) {
        for (const t of byEntry.get(k) || []) {
            if (held.some(p => p.t.ticker === t.ticker)) { skippedHeld++; continue; }
            const want = prevEquity * Math.min(P.RISK_PCT / t.outcome.risk_pct, P.MAX_POS_PCT / 100);
            const amt = Math.min(want, cash);
            if (amt < want * P.MIN_FILL_FRAC || amt <= 0) { skippedCash++; continue; }
            if (amt < want) resized++;
            cash -= amt;
            held.push({ t, cost: amt, k0: k });
            taken++;
        }
        let parked = 0;
        if (k > 0 && P.idle?.get(dates[k - 1])?.on && cash > 0) {
            cash *= spyTR[k] / spyTR[k - 1];
            parked = cash;
        }
        let value = 0;
        const still = [];
        for (const p of held) {
            const path = p.t.outcome.path;
            const j = Math.min(k - p.k0, path.length - 1);
            const closed = p.t.outcome.status === 'closed';
            if (closed && k - p.k0 >= path.length - 1) {
                const proceeds = p.cost * (1 + path[path.length - 1] / 100);
                cash += proceeds;
                pnl.push({ id: p.t.id, ticker: p.t.ticker, pnl: proceeds - p.cost, open: false });
            } else {
                value += p.cost * (1 + path[j] / 100);
                still.push(p);
            }
        }
        held = still;
        const eq = cash + value;
        equity.push(eq);
        exposure.push(eq > 0 ? (value / eq) * 100 : 0);
        spyShare.push(eq > 0 ? (parked / eq) * 100 : 0);
        positions.push(held.length);
        prevEquity = eq;
    }
    for (const p of held) {
        const path = p.t.outcome.path;
        const j = Math.min(dates.length - 1 - p.k0, path.length - 1);
        pnl.push({ id: p.t.id, ticker: p.t.ticker, pnl: p.cost * (path[j] / 100), open: true });
    }

    const last = dates.length - 1;
    const months = monthlyReturns(dates, equity);
    const worst = months.reduce((w, m) => (!w || m.ret < w.ret ? m : w), null);
    const totalPnl = pnl.reduce((a, x) => a + x.pnl, 0);
    const top5 = [...pnl].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
    const top5Pnl = top5.reduce((a, x) => a + x.pnl, 0);

    const stats = {
        from: dates[0], to: dates[last], sessions: dates.length,
        start_equity: P.START, end_equity: round(equity[last], 0),
        total_return: round((equity[last] / P.START - 1) * 100),
        spy_total_return: round((spyTR[last] / spyTR[0] - 1) * 100),
        cagr: round(cagr(P.START, equity[last], dates[0], dates[last])),
        spy_cagr: round(cagr(spyTR[0], spyTR[last], dates[0], dates[last])),
        max_dd: round(maxDrawdown(equity)),
        spy_max_dd: round(maxDrawdown(spyTR)),
        worst_month: worst ? { month: worst.month, ret: round(worst.ret) } : null,
        avg_exposure: round(exposure.reduce((a, x) => a + x, 0) / exposure.length, 1),
        avg_spy_share: round(spyShare.reduce((a, x) => a + x, 0) / spyShare.length, 1),
        pct_days_flat: round((positions.filter(n => n === 0).length / positions.length) * 100, 1),
        max_positions: Math.max(...positions),
        trades_taken: taken, skipped_cash: skippedCash, skipped_held: skippedHeld, resized,
        // Share of the total profit from the 5 best trades (null if no profit).
        top5_share: totalPnl > 0 ? round((top5Pnl / totalPnl) * 100, 1) : null,
        top5: top5.map(x => ({ ticker: x.ticker, pnl: round(x.pnl, 0), open: x.open })),
        rules: { risk_pct: P.RISK_PCT, max_pos_pct: P.MAX_POS_PCT, start: P.START, min_fill_frac: P.MIN_FILL_FRAC },
    };
    return {
        stats,
        daily: {
            dates,
            equity: equity.map(v => round((v / P.START) * 100)),
            spy: spyTR.map(v => round((v / spyTR[0]) * 100)),
            exposure: exposure.map(v => round(v, 1)),
            spy_share: spyShare.map(v => round(v, 1)),
        },
    };
}
