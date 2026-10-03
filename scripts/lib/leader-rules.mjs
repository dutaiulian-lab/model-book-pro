// Model Book leader rules (2026-10 "F6"), shared by the daily screener, the
// track-record backfill and the research verification harness.
//
// Selected by a 20-year (2006-2026) study of ~4,400 US stocks: a pre-registered
// grid of entry setups, leadership / liquidity filters, market regimes, stops and
// exits, chosen by a portfolio-level walk-forward procedure restricted to setups
// an end-of-day scanner can trade. See the research report for the evidence and
// its limits (the selection procedure itself did not beat SPY out of sample).
//
// A stock is a buy candidate on day s when ALL of these hold:
//   Market:     SPY closes above its 200-day SMA.
//   Leadership: IBD-style RS rank >= 90 (weighted 3/6/9/12-month return,
//               percentile across the liquid US universe that day).
//   Liquidity:  20-day average dollar volume >= $10M and in the top 15% of the
//               universe; price >= $10.
//   Run-up:     close >= 100% above the 52-week low (since IPO for new issues).
//   Depth:      close within 35% of the 52-week high.
//   Setup:      one of
//     RANGE  "Launchpad coil": the original screener coil rules (Stage-2 or IPO,
//            stacked 10/21 MAs, tight, dry volume, no breakdown trap);
//            pivot = prior 10-day high.
//     TIGHT  5-day range <= 1.25x ADR, above a rising 21-EMA, close within 3% of
//            the 5-day high; pivot = 5-day high.
//     BASE   base pivot: highest high of the last 130 sessions, unbroken for >= 20
//            sessions (>= 10 for IPOs), base <= 50% deep, close within 5% below it;
//            pivot = base high.
//     HTF    high tight flag: +90% pole within 40 sessions, flag 5-25 sessions and
//            <= 25% deep, close within 7% of the flag high; pivot = flag high.
//
// Trade plan:
//   Entry: buy stop at the pivot, valid for 5 sessions after the signal day.
//   Stop:  the structural stop, clamped to 3%-8% below the fill.
//   Exit:  first close below the 50-day SMA; once a close is >= 20% above the
//          fill, the first close below the 21-day EMA instead. Max 252 sessions.

export const RULES_VERSION = '2026-10 (F6)';
export const RULES = {
    rsMin: 90, dvPctMin: 85, dvMin: 10e6, priceMin: 10, upLow52Min: 100, depth52Max: 35,
    families: ['RANGE', 'TIGHT', 'BASE', 'HTF'],
    entryWindow: 5, stopMinPct: 3, stopMaxPct: 8, trailAfterGainPct: 20, maxHold: 252,
    // Universe used for RS / dollar-volume percentiles.
    rankPriceMin: 5, rankDvMin: 5e6,
};
// Watchlist (not buy signals): leaders with any setup, looser liquidity, any market.
export const WATCH = { rsMin: 90, dvPctMin: 70 };

export const FAMILY_LABELS = {
    RANGE: 'Launchpad Coil', TIGHT: 'Tight Range', BASE: 'Base Breakout', HTF: 'High Tight Flag', GAP: 'Power Gap',
};
// When a ticker has several setups the same day, keep the one with the lowest
// pivot (the order that would trigger first); ties by this priority.
const FAMILY_PRIORITY = { BASE: 0, TIGHT: 1, RANGE: 2, HTF: 3, GAP: 4 };

// ---------- series helpers (identical to the research code) ----------
export function sma(x, n) {
    const out = new Float64Array(x.length).fill(NaN);
    let s = 0;
    for (let k = 0; k < x.length; k++) {
        s += x[k];
        if (k >= n) s -= x[k - n];
        if (k >= n - 1) out[k] = s / n;
    }
    return out;
}
export function ema(x, n) {
    const out = new Float64Array(x.length).fill(NaN);
    const a = 2 / (n + 1);
    let e = x[0];
    for (let k = 0; k < x.length; k++) {
        e = k === 0 ? x[0] : (x[k] - e) * a + e;
        if (k >= n - 1) out[k] = e;
    }
    return out;
}
function rollMaxIdx(x, n) {
    const idx = new Int32Array(x.length), dq = new Int32Array(x.length);
    let hd = 0, tl = 0;
    for (let k = 0; k < x.length; k++) {
        while (tl > hd && x[dq[tl - 1]] <= x[k]) tl--;
        dq[tl++] = k;
        while (dq[hd] <= k - n) hd++;
        idx[k] = dq[hd];
    }
    return idx;
}
function rollMinIdx(x, n) {
    const idx = new Int32Array(x.length), dq = new Int32Array(x.length);
    let hd = 0, tl = 0;
    for (let k = 0; k < x.length; k++) {
        while (tl > hd && x[dq[tl - 1]] >= x[k]) tl--;
        dq[tl++] = k;
        while (dq[hd] <= k - n) hd++;
        idx[k] = dq[hd];
    }
    return idx;
}
const perf = (c, k, n) => (k >= n ? c[k] / c[k - n] - 1 : NaN);

// Precompute everything for one ticker. bars: oldest first. ipoStart: true if
// the first bar is the listing day (new issue), so the "IPO" rules apply for its
// first 252 sessions. factor (optional): raw/adjusted price multiplier per bar.
export function prepare(bars, { ipoStart = false, factor = null } = {}) {
    const n = bars.length;
    const o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
    for (let k = 0; k < n; k++) { const b = bars[k]; o[k] = b.open; h[k] = b.high; l[k] = b.low; c[k] = b.close; v[k] = b.volume; }
    const rng = Float64Array.from(h, (x, k) => x - l[k]);
    const S = {
        n, o, h, l, c, v, rng, ipoStart, factor,
        dates: bars.map(b => b.date),
        sma10: sma(c, 10), ema21: ema(c, 21), sma50: sma(c, 50), sma150: sma(c, 150), sma200: sma(c, 200),
        vol20: sma(v, 20), vol50: sma(v, 50),
        r3: sma(rng, 3), r10: sma(rng, 10), r20: sma(rng, 20),
        adrS: sma(Float64Array.from(rng, (x, k) => x / c[k]), 20),
        hi252: rollMaxIdx(h, 252), lo252: rollMinIdx(l, 252), hi130: rollMaxIdx(h, 131), hi10: rollMaxIdx(h, 10),
        hi5: rollMaxIdx(h, 5), lo5: rollMinIdx(l, 5),
    };
    return S;
}

// IBD-style RS score at bar k (NaN with < 63 bars).
export function rsScore(S, k) {
    const { c } = S;
    if (k < 63) return NaN;
    const p63 = perf(c, k, 63), p126 = k >= 126 ? perf(c, k, 126) : p63, p189 = k >= 189 ? perf(c, k, 189) : p126, p252 = k >= 252 ? perf(c, k, 252) : p189;
    return 0.4 * p63 + 0.2 * p126 + 0.2 * p189 + 0.2 * p252;
}
export const dollarVol = (S, k) => (k >= 19 ? S.vol20[k] * S.c[k] : NaN);
export const rawPrice = (S, k) => S.c[k] * (S.factor ? S.factor[k] : 1);
// Member of the ranking universe on bar k?
export const inRankUniverse = (S, k) => rawPrice(S, k) >= RULES.rankPriceMin && dollarVol(S, k) >= RULES.rankDvMin;

function rollIdxMax(h, s, w) {
    let j = s - w, m = -Infinity;
    for (let q = Math.max(0, s - w); q <= s; q++) if (h[q] >= m) { m = h[q]; j = q; }
    return j;
}

// Raw setup detection at bar s (before leadership/liquidity/regime filters).
// Returns { feats, cands } or null if the stock fails the common pre-filters.
export function detect(S, s, { withGap = false } = {}) {
    const { c, h, l, o, v, rng, sma10, ema21, sma50, sma150, sma200, vol20, vol50, r3, r10, r20, adrS, hi252, lo252, hi130, hi10, hi5, lo5 } = S;
    if (s < 30 || s >= S.n) return null;
    const raw = rawPrice(S, s), dv = dollarVol(S, s);
    if (raw < 5 || !(dv >= 5e6)) return null;
    const ipoAge = S.ipoStart ? s : 99999;
    const isIpo = ipoAge < 252;
    if (!isIpo && s < 252) return null;
    if (!Number.isNaN(sma50[s]) && c[s] <= sma50[s] && !(c[s] > sma50[s] * 0.97)) return null;
    let lowRef, hiRef;
    if (isIpo) {
        lowRef = Infinity; hiRef = -Infinity;
        for (let q = 0; q <= s; q++) { if (l[q] < lowRef) lowRef = l[q]; if (h[q] > hiRef) hiRef = h[q]; }
    } else { lowRef = l[lo252[s]]; hiRef = h[hi252[s]]; }
    const upLow52 = (c[s] / lowRef - 1) * 100;
    if (upLow52 < 20) return null;
    const depth52 = (hiRef - c[s]) / hiRef * 100;
    const adr = adrS[s] * 100;
    const tmpl = !isIpo && c[s] > sma50[s] && sma50[s] > sma150[s] && sma150[s] > sma200[s] && sma200[s] > sma200[s - 20] ? 1 : 0;
    const stack = c[s] >= sma10[s] && c[s] >= ema21[s] && sma10[s] >= ema21[s] ? 1 : 0;
    const dist10 = (c[s] / sma10[s] - 1) * 100, dist21 = (c[s] / ema21[s] - 1) * 100;
    const s50 = Number.isNaN(sma50[s]) ? NaN : sma50[s];
    const cands = [];
    // RANGE
    {
        const sp1021 = Math.abs(sma10[s] - ema21[s]) / ema21[s] * 100;
        const sp1050 = Number.isNaN(s50) ? 0 : Math.abs(sma10[s] - s50) / s50 * 100;
        const pivot = h[hi10[s - 1]];
        const distPivot = (c[s] / pivot - 1) * 100;
        const dcr = rng[s] > 0 ? (c[s] - l[s]) / rng[s] : 0.5;
        const okTrend = isIpo ? (Number.isNaN(s50) || c[s] > s50) : tmpl;
        if (okTrend && stack && dist10 <= 3.5 && dist21 <= 6.5 && depth52 <= 35 && sp1021 <= 3 && sp1050 <= 12 &&
            rng[s] <= r10[s] && r3[s] <= r20[s] && v[s] < vol20[s] && dcr >= 0.45 && (adr > 0 ? dist10 / adr : 0) <= 0.7 && distPivot <= 2.5) {
            let trap = 0;
            for (let j = Math.max(0, s - 10); j < s && !trap; j++) {
                if ((c[j] < sma10[j] || c[j] < ema21[j]) && v[j] > vol20[j]) {
                    let cleared = false;
                    for (let q = j + 1; q <= s; q++) if (c[q] > h[j]) { cleared = true; break; }
                    if (!cleared) trap = 1;
                }
            }
            const structStop = Math.max(Math.min(l[s], l[s - 1], l[s - 2]), sma10[s] * 0.985);
            let mn = Infinity;
            for (let q = s - 9; q <= s; q++) mn = Math.min(mn, l[q]);
            cands.push({ fam: 'RANGE', pivot, structStop, baseDepth: (pivot - mn) / pivot * 100, baseLen: 10, trap });
        }
    }
    // TIGHT
    if (c[s] > ema21[s] && ema21[s] > ema21[s - 5] && adr > 0) {
        const hh = h[hi5[s]], ll = l[lo5[s]];
        if ((hh - ll) / c[s] * 100 <= 1.25 * adr && c[s] >= hh * 0.97) {
            cands.push({ fam: 'TIGHT', pivot: hh, structStop: ll * 0.995, baseDepth: (hh - ll) / hh * 100, baseLen: 5 });
        }
    }
    // BASE / HTF
    {
        const j = hi130[s];
        const len = s - j;
        const P = h[j];
        if (len >= (isIpo ? 10 : 20) && c[s] < P && c[s] >= P * 0.95) {
            let mn = Infinity;
            for (let q = j; q <= s; q++) if (l[q] < mn) mn = l[q];
            const bd = (P - mn) / P * 100;
            if (bd <= 50) cands.push({ fam: 'BASE', pivot: P, structStop: Math.min(l[s], l[s - 1], l[s - 2]) * 0.995, baseDepth: bd, baseLen: len });
        }
        const j2 = rollIdxMax(h, s, 25);
        const len2 = s - j2;
        if (len2 >= 5 && len2 <= 25 && c[s] < h[j2] && c[s] >= h[j2] * 0.93) {
            let mnPole = Infinity, mnFlag = Infinity;
            for (let q = Math.max(0, j2 - 40); q <= j2; q++) if (l[q] < mnPole) mnPole = l[q];
            for (let q = j2; q <= s; q++) if (l[q] < mnFlag) mnFlag = l[q];
            const fd = (h[j2] - mnFlag) / h[j2] * 100;
            if (h[j2] / mnPole >= 1.9 && fd <= 25) {
                cands.push({ fam: 'HTF', pivot: h[j2], structStop: Math.min(l[s], l[s - 1], l[s - 2]) * 0.995, baseDepth: fd, baseLen: len2 });
            }
        }
    }
    // Power gap (watchlist only; research entered at the gap-day close, which an
    // end-of-day scanner cannot do).
    if (withGap && s >= 51) {
        const gapPct = (o[s] / c[s - 1] - 1) * 100;
        if (gapPct >= 4 && v[s] >= 2.5 * vol50[s - 1] && rng[s] > 0 && (c[s] - l[s]) / rng[s] >= 0.5 && c[s] >= c[s - 1] * 1.05) {
            cands.push({ fam: 'GAP', pivot: h[s], structStop: l[s] * 0.995, baseDepth: NaN, baseLen: 0, gapPct });
        }
    }
    return {
        feats: { rawPrice: raw, dv, upLow52, depth52, adr, ipoAge, isIpo, tmpl, dist10, dist21 },
        cands,
    };
}

// Research de-duplication: per family, a setup counts only if the same family
// was not detected in the prior 5 sessions, and not within 10 sessions after a
// same-family trigger. Replays detection from `from` to `to` (inclusive) and
// returns the counted setups (with their trigger bar if the order filled).
export function countedSetups(S, from, to) {
    const lastSetup = {}, lastTrigger = {};
    const out = [];
    for (let s = Math.max(30, from); s <= to; s++) {
        const d = detect(S, s);
        if (!d) continue;
        for (const cd of d.cands) {
            const ls = lastSetup[cd.fam] ?? -1e9;
            lastSetup[cd.fam] = s;
            if (s - ls <= 5) continue;
            if (s - (lastTrigger[cd.fam] ?? -1e9) <= 10) continue;
            const eb = triggerBar(S, s, cd.pivot);
            if (eb >= 0) lastTrigger[cd.fam] = eb;
            out.push({ s, ...cd, feats: d.feats, eb });
        }
    }
    return out;
}

// First bar in (s, s+entryWindow] whose high clears the pivot, or -1.
export function triggerBar(S, s, pivot) {
    for (let m = s + 1; m <= Math.min(S.n - 1, s + RULES.entryWindow); m++) if (S.h[m] > pivot) return m;
    return -1;
}

// Leadership / liquidity / run-up / depth / regime filter for a counted setup.
// ranks: { rs, dvPct } percentiles (0-100); spyAbove200: boolean.
export function passesBuyRules(setup, ranks, spyAbove200) {
    const f = setup.feats;
    if (!RULES.families.includes(setup.fam)) return false;
    if (setup.fam === 'RANGE' && setup.trap) return false;
    if (!spyAbove200) return false;
    if (!(ranks.rs >= RULES.rsMin)) return false;
    if (!(ranks.dvPct >= RULES.dvPctMin) || !(f.dv >= RULES.dvMin)) return false;
    if (f.rawPrice < RULES.priceMin) return false;
    if (f.upLow52 < RULES.upLow52Min) return false;
    if (f.depth52 > RULES.depth52Max) return false;
    return true;
}
export function passesWatch(setup, ranks) {
    if (setup.fam === 'RANGE' && setup.trap) return false;
    return ranks.rs >= WATCH.rsMin && ranks.dvPct >= WATCH.dvPctMin && setup.feats.dv >= RULES.dvMin && setup.feats.rawPrice >= RULES.priceMin;
}

// Pick one setup per ticker: lowest pivot, then family priority.
export function bestSetup(list) {
    return [...list].sort((a, b) => a.pivot - b.pivot || FAMILY_PRIORITY[a.fam] - FAMILY_PRIORITY[b.fam])[0];
}

// Initial stop for a fill at P with structural stop `struct` (clamped 3-8%).
export function initialStop(P, struct) {
    const sr = (P - struct) / P;
    return P * (1 - Math.min(RULES.stopMaxPct / 100, Math.max(RULES.stopMinPct / 100, sr)));
}

// Simulate the trade for a setup at bar s (pivot, structStop, fam). Returns
// { status: 'no_entry' | 'pending' | 'open' | 'closed', ... } using bars up to S.n-1.
export function simulateTrade(S, s, pivot, structStop, fam) {
    const { o, h, l, c, sma50, ema21 } = S;
    const n = S.n;
    let eb = -1;
    for (let m = s + 1; m <= Math.min(n - 1, s + RULES.entryWindow); m++) if (h[m] > pivot) { eb = m; break; }
    if (eb < 0) return n - 1 - s >= RULES.entryWindow ? { status: 'no_entry' } : { status: 'pending', days_waiting: n - 1 - s };
    const P = Math.max(o[eb], pivot);
    let struct = structStop;
    if (fam !== 'RANGE') for (let q = s + 1; q < eb; q++) struct = Math.min(struct, l[q] * 0.995);
    const stop = initialStop(P, struct);
    const risk = P - stop;
    let trail21 = false, exit = NaN, xj = -1, reason = null;
    const last = Math.min(n - 1, eb + RULES.maxHold - 1);
    for (let j = eb; j <= last; j++) {
        const first = j === eb;
        if (first ? c[j] < stop : l[j] <= stop) { exit = first ? c[j] : Math.min(stop, o[j]); xj = j; reason = 'stop'; break; }
        if (c[j] >= P * (1 + RULES.trailAfterGainPct / 100)) trail21 = true;
        if (!first) {
            const m = trail21 ? ema21[j] : sma50[j];
            if (c[j] < m) { exit = c[j]; xj = j; reason = trail21 ? 'ema21' : 'sma50'; break; }
        }
        if (j === eb + RULES.maxHold - 1) { exit = c[j]; xj = j; reason = 'time'; break; }
    }
    const base = { eb, entry: P, stop, struct, risk_pct: risk / P * 100, trail21 };
    if (Number.isNaN(exit)) return { ...base, status: 'open', mark: c[n - 1], r: (c[n - 1] - P) / risk, last: n - 1 };
    return { ...base, status: 'closed', xj, exit, reason, r: (exit - P) / risk, ret: (exit / P - 1) * 100 };
}

// Percentile helper: share of `sorted` strictly below x, in percent.
export function percentile(sorted, x) {
    if (!sorted.length || Number.isNaN(x)) return NaN;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
    return lo / sorted.length * 100;
}

// Raw/adjusted price multiplier per bar from Yahoo split events
// ([{ date: 'YYYY-MM-DD', ratio }]); null when there were no splits.
export function splitFactors(dates, splits) {
    if (!splits || !splits.length) return null;
    const f = new Float64Array(dates.length).fill(1);
    for (const sp of splits) for (let k = 0; k < dates.length && dates[k] < sp.date; k++) f[k] *= sp.ratio;
    return f;
}

// Parse a Yahoo v8 chart result into { history, splits }. Drops bars with
// missing fields and, while the regular session is open, today's partial bar.
export function parseChart(data) {
    const quotes = data.indicators?.quote?.[0];
    const ts = data.timestamp;
    if (!quotes || !ts || !ts.length) return null;
    const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
    const history = [];
    for (let i = 0; i < ts.length; i++) {
        if (quotes.open[i] != null && quotes.close[i] != null && quotes.volume[i] != null && quotes.high[i] != null && quotes.low[i] != null) {
            history.push({ date: day(ts[i]), open: quotes.open[i], high: quotes.high[i], low: quotes.low[i], close: quotes.close[i], volume: quotes.volume[i] });
        }
    }
    const regular = data.meta?.currentTradingPeriod?.regular;
    const lastTs = ts[ts.length - 1];
    if (regular && Date.now() / 1000 < regular.end && lastTs >= regular.start && history.length && history[history.length - 1].date === day(lastTs)) history.pop();
    const splits = Object.values(data.events?.splits || {})
        .map(e => ({ date: day(e.date), ratio: e.numerator / e.denominator }))
        .filter(e => Number.isFinite(e.ratio) && e.ratio > 0);
    return { history, splits };
}
