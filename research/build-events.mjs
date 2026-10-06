// Event builder for the long-history Model Book study.
//
// For every ticker-day (2006+) it detects candidate setups of several Model Book
// entry families, records features known at the setup close, and simulates the
// trade for every initial-stop x management combination.
//
// Families (setup known at the close of day s; order placed for later sessions):
//   RANGE  live "Launchpad coil" rules (rules C core); buy-stop at 10-day high, 5 sessions
//   TIGHT  tight 5-day range (<= 1.25 ADR) above rising 21-EMA; buy-stop at 5-day high
//   BASE   base pivot: highest high of up to 130 sessions not exceeded for >= 20
//          sessions (>= 10 for IPOs), close within 5% below it; buy-stop at the base high
//   HTF    high tight flag: +100% within 40 sessions to a peak within 5% of the 52-week
//          high; flag <= 25% deep, 5-25 sessions from the pole's peak
//   PEB    21-EMA undercut in an uptrend (close < 21 EMA, > 50 SMA); buy-stop at undercut-bar high
//   OOPS   uptrend pullback near 21 EMA / 50 SMA; next day opens below prior low and
//          trades back through it; buy at the prior low (one session)
//   GAP    power gap: gap >= 4%, volume >= 2.5x 50-day avg, close in upper half; buy at the close
//
// Costs: 0.3% round trip deducted from every trade.
import fs from 'fs';
import v8 from 'v8';
import path from 'path';

const DATA = process.env.RESEARCH_DATA || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const cache = v8.deserialize(fs.readFileSync(path.join(DATA, 'cache.bin')));
const { dates, spy } = cache;
const ND = dates.length;
const COST = 0.3; // % round trip
const tickers = Object.keys(cache.tickers).filter(t => {
    const p = cache.tickers[t];
    return p.c.length >= 60 && (p.type == null || p.type === 'EQUITY');
}).sort();
console.log(`tickers ${tickers.length}, dates ${dates[0]}..${dates[ND - 1]}`);

// ---------------- helpers ----------------
function sma(x, n) {
    const out = new Float64Array(x.length).fill(NaN);
    let s = 0;
    for (let k = 0; k < x.length; k++) {
        s += x[k];
        if (k >= n) s -= x[k - n];
        if (k >= n - 1) out[k] = s / n;
    }
    return out;
}
function ema(x, n) {
    const out = new Float64Array(x.length).fill(NaN);
    const a = 2 / (n + 1);
    let e = x[0];
    for (let k = 0; k < x.length; k++) {
        e = k === 0 ? x[0] : (x[k] - e) * a + e;
        if (k >= n - 1) out[k] = e;
    }
    return out;
}
// Rolling max/min with index (monotonic deque), window n ending at k inclusive.
function rollMaxIdx(x, n) {
    const idx = new Int32Array(x.length);
    const dq = new Int32Array(x.length);
    let hd = 0, tl = 0;
    for (let k = 0; k < x.length; k++) {
        while (tl > hd && x[dq[tl - 1]] <= x[k]) tl--; // keep latest on ties
        dq[tl++] = k;
        while (dq[hd] <= k - n) hd++;
        idx[k] = dq[hd];
    }
    return idx;
}
function rollMinIdx(x, n) {
    const idx = new Int32Array(x.length);
    const dq = new Int32Array(x.length);
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

// ---------------- SPY / market ----------------
const spyGi = new Int32Array(ND).fill(-1);
spy.i.forEach((g, k) => { spyGi[g] = k; });
const spyC = Float64Array.from(spy.c);
const spy50 = sma(spyC, 50), spy200 = sma(spyC, 200), spyE21 = ema(spyC, 21);
const mkt = { spy50: new Uint8Array(ND), spy200: new Uint8Array(ND), spy21: new Uint8Array(ND), spyRet: new Float64Array(ND).fill(NaN) };
for (let g = 0; g < ND; g++) {
    const k = spyGi[g];
    if (k < 0) continue;
    mkt.spy50[g] = spyC[k] > spy50[k] ? 1 : 0;
    mkt.spy200[g] = spyC[k] > spy200[k] ? 1 : 0;
    mkt.spy21[g] = spyE21[k] > spy50[k] ? 1 : 0;
}

// ---------------- pass 1: per-ticker series, RS and dollar-volume ranks, breadth ----------------
const S = {};
const rsByDate = Array.from({ length: ND }, () => []);
const dvByDate = Array.from({ length: ND }, () => []);
const above50 = new Float64Array(ND), counted = new Float64Array(ND), nh = new Float64Array(ND), nl = new Float64Array(ND);
for (const t of tickers) {
    const p = cache.tickers[t];
    const n = p.c.length;
    const c = Float64Array.from(p.c), h = Float64Array.from(p.h), l = Float64Array.from(p.l), o = Float64Array.from(p.o), v = Float64Array.from(p.v);
    // Raw (unadjusted) price factor: product of split ratios after each bar.
    const factor = new Float64Array(n).fill(1);
    if (p.splits?.length) {
        for (const sp of p.splits) {
            for (let k = 0; k < n && dates[p.i[k]] < sp.date; k++) factor[k] *= sp.ratio;
        }
    }
    const sma50 = sma(c, 50), vol20 = sma(v, 20);
    const score = new Float64Array(n).fill(NaN);
    const dv = new Float64Array(n).fill(NaN);
    const hi252 = rollMaxIdx(h, 252), lo252 = rollMinIdx(l, 252);
    for (let k = 0; k < n; k++) {
        const g = p.i[k];
        if (k >= 63) {
            const p63 = perf(c, k, 63), p126 = k >= 126 ? perf(c, k, 126) : p63, p189 = k >= 189 ? perf(c, k, 189) : p126, p252 = k >= 252 ? perf(c, k, 252) : p189;
            score[k] = 0.4 * p63 + 0.2 * p126 + 0.2 * p189 + 0.2 * p252;
        }
        if (k >= 19) dv[k] = vol20[k] * c[k];
        const raw = c[k] * factor[k];
        if (raw >= 5 && dv[k] >= 5e6) {
            if (!Number.isNaN(score[k])) rsByDate[g].push(score[k]);
            dvByDate[g].push(dv[k]);
            if (!Number.isNaN(sma50[k])) { counted[g]++; if (c[k] > sma50[k]) above50[g]++; }
            if (k >= 252) { if (h[k] >= h[hi252[k]]) nh[g]++; if (l[k] <= l[lo252[k]]) nl[g]++; }
        }
    }
    S[t] = { c, h, l, o, v, factor, score, dv, sma50, vol20, hi252, lo252 };
}
for (const a of rsByDate) a.sort((x, y) => x - y);
for (const a of dvByDate) a.sort((x, y) => x - y);
const pct = (a, x) => {
    if (!a.length || Number.isNaN(x)) return NaN;
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
    return lo / a.length * 100;
};
mkt.breadth = Float64Array.from(above50, (x, g) => counted[g] ? x / counted[g] * 100 : NaN);
mkt.nhnl = Float64Array.from(nh, (x, g) => (x + nl[g]) ? (x - nl[g]) / (x + nl[g]) * 100 : NaN);
console.log('pass 1 done');

// ---------------- exits ----------------
export const STOPS = ['struct', 'clamp', 'min5', 'fix7', 'fix10'];
export const MGMT = ['t20', 'c10', 'c21', 'c50', 'c50be', 'c50t21', 'c50part'];
const COMBOS = [];
for (const s of STOPS) for (const m of MGMT) COMBOS.push(`${s}|${m}`);
const MAXHOLD = 252;

// Simulate one trade. eb: entry bar, P: fill, Sx: initial stop, entryAtClose: fill at
// the close of eb (stop/exit checks start next bar); entryIntraday: buy-stop fill during eb.
function simulate(A, eb, P, Sx, mg, entryAtClose) {
    const { c, h, l, o, sma10, ema21, sma50 } = A;
    const n = c.length;
    const risk = P - Sx;
    let stop = Sx, partDone = false, partR = 0, trail21 = false;
    const maxHold = mg === 't20' ? 20 : MAXHOLD;
    const last = Math.min(n - 1, eb + maxHold - (entryAtClose ? 0 : 1));
    const ma = mg === 'c10' ? sma10 : mg === 'c21' ? ema21 : sma50;
    let exit = NaN, xj = -1, open = 0;
    for (let j = entryAtClose ? eb + 1 : eb; j <= last; j++) {
        const first = j === eb;
        // Stop: on the (intraday) entry bar only a close below counts (order unknown).
        if (first ? c[j] < stop : l[j] <= stop) { exit = first ? c[j] : Math.min(stop, o[j]); xj = j; break; }
        if (mg === 'c50part' && !partDone && h[j] >= P + 3 * risk) {
            partDone = true; partR = (Math.max(o[j], P + 3 * risk) - P) / risk; stop = Math.max(stop, P);
        }
        if (mg === 'c50be' && h[j] >= P + 2 * risk) stop = Math.max(stop, P);
        if (mg === 'c50t21' && c[j] >= P * 1.2) trail21 = true;
        if (!first && mg !== 't20') {
            const m = trail21 ? ema21[j] : ma[j];
            if (c[j] < m) { exit = c[j]; xj = j; break; }
        }
        if (j === last) { exit = c[j]; xj = j; open = j === n - 1 && j - eb < maxHold - 1 ? 1 : 0; break; }
    }
    if (Number.isNaN(exit)) { // entered on the last bar
        exit = c[n - 1]; xj = n - 1; open = 1;
    }
    let R = (exit - P) / risk;
    if (mg === 'c50part' && partDone) R = partR / 3 + R * 2 / 3;
    const costR = (P * COST / 100) / risk;
    R -= costR;
    return { R, ret: R * risk / P * 100, risk: risk / P * 100, xj, open };
}

// ---------------- pass 2: events ----------------
const FAMS = ['RANGE', 'TIGHT', 'BASE', 'HTF', 'PEB', 'OOPS', 'GAP'];
const FEATS = ['fam', 'tid', 'gi', 'egi', 'xgiRef', 'rawPrice', 'dv', 'dvPct', 'rs', 'upLow52', 'depth52', 'baseDepth', 'baseLen',
    'ipoAge', 'tmpl', 'stack', 'dist50', 'adr', 'inside', 'tight3', 'volDry', 'baseCount', 'rsLineHigh', 'spy50', 'spy200', 'spy21',
    'breadth', 'nhnl', 'distPivot', 'trap', 'gapVolMax', 'gapPct', 'mfe60', 'riskStruct', 'liveC'];
const cols = Object.fromEntries(FEATS.map(f => [f, []]));
const outR = COMBOS.map(() => []), outRet = COMBOS.map(() => []), outRisk = COMBOS.map(() => []), outX = COMBOS.map(() => []), outOpen = COMBOS.map(() => []);
let nEvents = 0;
const FIRST_GI = dates.findIndex(d => d >= '2006-01-01');
const famCount = Object.fromEntries(FAMS.map(f => [f, 0]));

for (let tid = 0; tid < tickers.length; tid++) {
    const t = tickers[tid];
    const p = cache.tickers[t];
    const X = S[t];
    const { c, h, l, o, v, factor, score, dv, sma50, vol20, hi252, lo252 } = X;
    const n = c.length;
    const listedLater = p.i[0] > 5;
    const sma10 = sma(c, 10), ema21 = ema(c, 21), sma150 = sma(c, 150), sma200 = sma(c, 200), vol50 = sma(v, 50);
    const rng = Float64Array.from(h, (x, k) => x - l[k]);
    const r3 = sma(rng, 3), r10 = sma(rng, 10), r20 = sma(rng, 20);
    const adrS = sma(Float64Array.from(rng, (x, k) => x / c[k]), 20);
    const hi130 = rollMaxIdx(h, 131), hi10 = rollMaxIdx(h, 10), hi5 = rollMaxIdx(h, 5), lo5 = rollMinIdx(l, 5);
    const rsLine = Float64Array.from(c, (x, k) => { const sk = spyGi[p.i[k]]; return sk >= 0 ? x / spyC[sk] : NaN; });
    const rsLineHi = rollMaxIdx(rsLine.map(x => (Number.isNaN(x) ? -Infinity : x)), 252);
    const A = { c, h, l, o, sma10, ema21, sma50 };

    // Base breakouts (close above a >= 20-session base high) for base counting.
    let stage2Start = 0;
    const breakouts = [];
    const lastSetup = Object.fromEntries(FAMS.map(f => [f, -1e9]));
    const lastTrigger = Object.fromEntries(FAMS.map(f => [f, -1e9]));
    let fibs = 0;

    for (let s = 30; s < n - 1; s++) {
        const g = p.i[s];
        if (c[s] < sma200[s]) stage2Start = s;
        // Base breakout bookkeeping (uses data through s).
        {
            const j = hi130[s - 1];
            if (s - 1 - j >= 19 && c[s] > h[j] && c[s - 1] <= h[j]) breakouts.push(s);
        }
        if (g < FIRST_GI) continue;
        const raw = c[s] * factor[s];
        if (raw < 5 || !(dv[s] >= 5e6)) continue;
        const ipoAge = listedLater ? s : 99999;
        const isIpo = ipoAge < 252;
        if (!isIpo && s < 252) continue;
        if (!Number.isNaN(sma50[s]) && c[s] <= sma50[s] && !(c[s] > sma50[s] * 0.97)) {
            // Only PEB/OOPS can set up slightly below the 50 SMA; skip the rest quickly.
            continue;
        }
        const lowRef = isIpo ? Math.min(...l.slice(0, s + 1)) : l[lo252[s]];
        const upLow52 = (c[s] / lowRef - 1) * 100;
        if (upLow52 < 20) continue;
        const hiRef = isIpo ? Math.max(...h.slice(0, s + 1)) : h[hi252[s]];
        const depth52 = (hiRef - c[s]) / hiRef * 100;
        const adr = adrS[s] * 100;
        const tmpl = !isIpo && c[s] > sma50[s] && sma50[s] > sma150[s] && sma150[s] > sma200[s] && sma200[s] > sma200[s - 20] ? 1 : 0;
        const stack = c[s] >= sma10[s] && c[s] >= ema21[s] && sma10[s] >= ema21[s] ? 1 : 0;
        const dist10 = (c[s] / sma10[s] - 1) * 100, dist21 = (c[s] / ema21[s] - 1) * 100;
        const s50 = Number.isNaN(sma50[s]) ? NaN : sma50[s];

        const cands = [];
        // ---- RANGE (live coil rules) ----
        {
            const sp1021 = Math.abs(sma10[s] - ema21[s]) / ema21[s] * 100;
            const sp1050 = Number.isNaN(s50) ? 0 : Math.abs(sma10[s] - s50) / s50 * 100;
            const pivot = h[hi10[s - 1]];
            const distPivot = (c[s] / pivot - 1) * 100;
            const dcr = rng[s] > 0 ? (c[s] - l[s]) / rng[s] : 0.5;
            const okTrend = isIpo ? (Number.isNaN(s50) || c[s] > s50) : tmpl;
            if (okTrend && stack && dist10 <= 3.5 && dist21 <= 6.5 && depth52 <= 35 && sp1021 <= 3 && sp1050 <= 12 &&
                rng[s] <= r10[s] && r3[s] <= r20[s] && v[s] < vol20[s] && dcr >= 0.45 && (adr > 0 ? dist10 / adr : 0) <= 0.7 && distPivot <= 2.5) {
                // Breakdown trap (prior 10 sessions).
                let trap = 0;
                for (let j = Math.max(0, s - 10); j < s && !trap; j++) {
                    if ((c[j] < sma10[j] || c[j] < ema21[j]) && v[j] > vol20[j]) {
                        let cleared = false;
                        for (let q = j + 1; q <= s; q++) if (c[q] > h[j]) { cleared = true; break; }
                        if (!cleared) trap = 1;
                    }
                }
                const structStop = Math.max(Math.min(l[s], l[s - 1], l[s - 2]), sma10[s] * 0.985);
                cands.push({ fam: 'RANGE', pivot, W: 5, structStop, baseDepth: (pivot - Math.min(...l.slice(s - 9, s + 1))) / pivot * 100, baseLen: 10, trap, liveC: !trap ? 1 : 0 });
            }
        }
        // ---- TIGHT (5-day range <= 1.25 ADR, above rising 21 EMA) ----
        if (c[s] > ema21[s] && ema21[s] > ema21[s - 5] && adr > 0) {
            const hh = h[hi5[s]], ll = l[lo5[s]];
            if ((hh - ll) / c[s] * 100 <= 1.25 * adr && c[s] >= hh * 0.97) {
                cands.push({ fam: 'TIGHT', pivot: hh, W: 5, structStop: ll * 0.995, baseDepth: (hh - ll) / hh * 100, baseLen: 5 });
            }
        }
        // ---- BASE / HTF ----
        {
            const j = hi130[s];
            const len = s - j;
            const P = h[j];
            if (len >= (isIpo ? 10 : 20) && c[s] < P && c[s] >= P * 0.95) {
                let mn = Infinity;
                for (let q = j; q <= s; q++) if (l[q] < mn) mn = l[q];
                const bd = (P - mn) / P * 100;
                if (bd <= 50) {
                    const ls = Math.min(l[s], l[s - 1], l[s - 2]);
                    cands.push({ fam: 'BASE', pivot: P, W: 5, structStop: ls * 0.995, baseDepth: bd, baseLen: len });
                }
            }
            // HTF: pivot = highest high of the last 25 sessions. The flag starts at the
            // pole's peak: the first bar (up to 25 sessions before the pivot) with a
            // high within 2% of it, so a marginal new high does not restart the flag
            // (it expires after 25 sessions instead). Pole: +100% from the lowest low
            // of the 40 sessions before the flag start. The pivot must be within 5%
            // of the 52-week high (a rebound inside a crash is not a flag).
            const j2 = rollIdxMax(h, s, 25);
            let jf = j2;
            for (let q = Math.max(0, j2 - 25); q <= j2; q++) if (h[q] >= h[j2] * 0.98) { jf = q; break; }
            const len2 = s - jf;
            if (len2 >= 5 && len2 <= 25 && c[s] < h[j2] && c[s] >= h[j2] * 0.93) {
                let mnPole = Infinity, mnFlag = Infinity;
                for (let q = Math.max(0, jf - 40); q <= jf; q++) if (l[q] < mnPole) mnPole = l[q];
                for (let q = jf; q <= s; q++) if (l[q] < mnFlag) mnFlag = l[q];
                const fd = (h[j2] - mnFlag) / h[j2] * 100;
                const hi52AtPeak = isIpo ? hiRef : h[hi252[j2]];
                if (h[j2] / mnPole >= 2 && fd <= 25 && h[j2] >= hi52AtPeak * 0.95) {
                    cands.push({ fam: 'HTF', pivot: h[j2], W: 5, structStop: Math.min(l[s], l[s - 1], l[s - 2]) * 0.995, baseDepth: fd, baseLen: len2 });
                }
            }
        }
        // ---- PEB (21 EMA undercut in uptrend) ----
        if (c[s] < ema21[s] && !Number.isNaN(s50) && c[s] > s50 && ema21[s] > s50) {
            let wasAbove = 0;
            for (let q = s - 10; q < s; q++) if (c[q] > ema21[q]) wasAbove++;
            if (wasAbove >= 7) {
                cands.push({ fam: 'PEB', pivot: h[s], W: 5, structStop: l[s] * 0.995, baseDepth: (h[hi10[s]] - l[s]) / h[hi10[s]] * 100, baseLen: 0 });
            }
        }
        // ---- OOPS (pullback near 21 EMA / 50 SMA; next day gap below prior low) ----
        if (!Number.isNaN(s50) && ema21[s] > s50 && (Math.abs(c[s] / ema21[s] - 1) <= 0.03 || Math.abs(c[s] / s50 - 1) <= 0.03)) {
            cands.push({ fam: 'OOPS', pivot: l[s], W: 1, oops: true, structStop: NaN, baseDepth: (h[hi10[s]] - l[s]) / h[hi10[s]] * 100, baseLen: 0 });
        }
        // ---- GAP (power gap, buy at the close) ----
        if (s >= 51) {
            const gapPct = (o[s] / c[s - 1] - 1) * 100;
            if (gapPct >= 4 && v[s] >= 2.5 * vol50[s - 1] && rng[s] > 0 && (c[s] - l[s]) / rng[s] >= 0.5 && c[s] >= c[s - 1] * 1.05) {
                let vmax = 1;
                for (let q = Math.max(0, s - 252); q < s; q++) if (v[q] >= v[s]) { vmax = 0; break; }
                cands.push({ fam: 'GAP', pivot: c[s], W: 0, atClose: true, structStop: l[s] * 0.995, baseDepth: NaN, baseLen: 0, gapVolMax: vmax, gapPct });
            }
        }
        if (!cands.length) continue;

        // Shared features.
        const rs = pct(rsByDate[g], score[s]);
        const dvPct = pct(dvByDate[g], dv[s]);
        let baseCount = 0;
        for (let q = breakouts.length - 1; q >= 0 && breakouts[q] > stage2Start; q--) if (breakouts[q] < s) baseCount++;
        const shared = {
            tid, gi: g, rawPrice: raw, dv: dv[s] / 1e6, dvPct, rs, upLow52, depth52, ipoAge, tmpl, stack,
            dist50: Number.isNaN(s50) ? NaN : (c[s] / s50 - 1) * 100, adr,
            inside: h[s] <= h[s - 1] && l[s] >= l[s - 1] ? 1 : 0, tight3: r3[s] / r20[s], volDry: v[s] / vol50[s],
            baseCount, rsLineHigh: rsLine[s] >= rsLine[rsLineHi[s]] * 0.99 ? 1 : 0,
            spy50: mkt.spy50[g], spy200: mkt.spy200[g], spy21: mkt.spy21[g], breadth: mkt.breadth[g], nhnl: mkt.nhnl[g],
        };
        for (const cd of cands) {
            // New-setup rule: same family not set up within prior 5 sessions; and no
            // same-family trigger within the prior 10 sessions.
            const ls = lastSetup[cd.fam];
            lastSetup[cd.fam] = s;
            if (s - ls <= 5 && cd.fam !== 'GAP') continue;
            if (s - lastTrigger[cd.fam] <= 10) continue;
            // Entry.
            let eb = -1, P = NaN;
            if (cd.atClose) { eb = s; P = c[s]; }
            else if (cd.oops) {
                const m = s + 1;
                if (m < n && o[m] < l[s] && h[m] > l[s]) { eb = m; P = l[s]; }
            } else {
                for (let m = s + 1; m <= Math.min(n - 1, s + cd.W); m++) {
                    if (h[m] > cd.pivot) { eb = m; P = Math.max(o[m], cd.pivot); break; }
                }
            }
            if (eb >= 0) lastTrigger[cd.fam] = eb;
            const row = {
                ...shared, fam: FAMS.indexOf(cd.fam), egi: eb >= 0 ? p.i[eb] : -1, xgiRef: -1,
                baseDepth: cd.baseDepth, baseLen: cd.baseLen, distPivot: (c[s] / cd.pivot - 1) * 100, trap: cd.trap ?? 0,
                gapVolMax: cd.gapVolMax ?? 0, gapPct: cd.gapPct ?? 0, mfe60: NaN, riskStruct: NaN, liveC: cd.liveC ?? 0,
            };
            if (eb >= 0) {
                let mh = -Infinity;
                for (let j = eb + (cd.atClose ? 1 : 0); j < Math.min(n, eb + 61); j++) if (h[j] > mh) mh = h[j];
                row.mfe60 = (mh / P - 1) * 100;
            }
            // Stops (known before the entry bar).
            let struct = cd.structStop;
            if (cd.oops || Number.isNaN(struct)) struct = P * 0.95;
            if (eb >= 0 && !cd.atClose && !cd.oops) {
                // For buy-stops placed later in the window, use the lowest low up to the bar before entry.
                let mn = struct;
                if (cd.fam !== 'RANGE') for (let q = s + 1; q < eb; q++) mn = Math.min(mn, l[q] * 0.995);
                struct = mn;
            }
            if (eb >= 0) row.riskStruct = (P - struct) / P * 100;
            for (const f of FEATS) cols[f].push(row[f]);
            let ci = 0;
            for (const st of STOPS) {
                let Sx = NaN;
                if (eb >= 0) {
                    const sr = P - struct;
                    if (st === 'struct') Sx = struct;
                    else if (st === 'clamp') Sx = P * (1 - Math.min(0.08, Math.max(0.03, sr / P)));
                    else if (st === 'min5') Sx = Math.min(struct, P * 0.95);
                    else if (st === 'fix7') Sx = P * 0.93;
                    else if (st === 'fix10') Sx = P * 0.90;
                }
                for (const mg of MGMT) {
                    if (eb >= 0 && Sx < P && Sx > 0) {
                        const r = simulate(A, eb, P, Sx, mg, !!cd.atClose);
                        outR[ci].push(r.R); outRet[ci].push(r.ret); outRisk[ci].push(r.risk); outX[ci].push(p.i[r.xj]); outOpen[ci].push(r.open);
                    } else {
                        outR[ci].push(NaN); outRet[ci].push(NaN); outRisk[ci].push(NaN); outX[ci].push(-1); outOpen[ci].push(0);
                    }
                    ci++;
                }
            }
            nEvents++; famCount[cd.fam]++;
        }
    }
    if (tid % 500 === 0) console.log(`${tid}/${tickers.length} events ${nEvents} ${JSON.stringify(famCount)}`);
}

function rollIdxMax(h, s, w) {
    let j = s - w, m = -Infinity;
    for (let q = Math.max(0, s - w); q <= s; q++) if (h[q] >= m) { m = h[q]; j = q; }
    return j;
}

const table = {
    dates, tickers, fams: FAMS, combos: COMBOS, feats: FEATS, mkt: { spy50: mkt.spy50, spy200: mkt.spy200, breadth: mkt.breadth, nhnl: mkt.nhnl },
    spy: { i: spy.i, c: spy.c },
    cols: Object.fromEntries(FEATS.map(f => [f, Float32Array.from(cols[f])])),
    R: outR.map(a => Float32Array.from(a)), ret: outRet.map(a => Float32Array.from(a)), risk: outRisk.map(a => Float32Array.from(a)),
    xgi: outX.map(a => Int16Array.from(a)), open: outOpen.map(a => Uint8Array.from(a)),
};
for (const f of ['tid', 'gi', 'egi']) table.cols[f] = Int32Array.from(cols[f]);
fs.writeFileSync(path.join(DATA, 'events.bin'), v8.serialize(table));
console.log(`events ${nEvents} ${JSON.stringify(famCount)}; ${(fs.statSync(path.join(DATA, 'events.bin')).size / 1e6).toFixed(0)} MB`);
