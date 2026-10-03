// Analysis library over events.bin.
import fs from 'fs';
import v8 from 'v8';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.RESEARCH_DATA || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
export const T = v8.deserialize(fs.readFileSync(path.join(DATA, 'events.bin')));
export const C = T.cols;
export const N = C.gi.length;
export const comboIdx = Object.fromEntries(T.combos.map((c, i) => [c, i]));
export const famIdx = Object.fromEntries(T.fams.map((f, i) => [f, i]));
export const YEAR = new Int16Array(N);
for (let r = 0; r < N; r++) YEAR[r] = Number(T.dates[C.gi[r]].slice(0, 4));
export const YEARS = [...new Set(YEAR)].sort();
const tickerIdx = Object.fromEntries(T.tickers.map((t, i) => [t, i]));

// Rule spec -> boolean mask over events.
export const BASE_SPEC = {
    fams: ['RANGE'], liveOnly: 0, upLow52Min: 0, rsMin: 0, dvMin: 20, dvPctMin: 0, rawPriceMin: 10, depth52Max: Infinity,
    baseDepthMax: Infinity, baseDepthMin: 0, baseLenMin: 0, tmpl: 0, regime: 'none', baseCountMax: Infinity, inside: 0,
    rsLineHigh: 0, volDryMax: Infinity, gapVolMax: 0, dist50Max: Infinity, adrMin: 0, ipoMax: Infinity, riskMax: Infinity,
};
export function mask(spec) {
    const s = { ...BASE_SPEC, ...spec };
    const fams = new Uint8Array(T.fams.length);
    for (const f of s.fams) fams[famIdx[f]] = 1;
    const m = new Uint8Array(N);
    for (let r = 0; r < N; r++) {
        if (!fams[C.fam[r]]) continue;
        if (s.liveOnly && C.fam[r] === famIdx.RANGE && !C.liveC[r]) continue;
        if (C.upLow52[r] < s.upLow52Min) continue;
        if (s.rsMin > 0 && !(C.rs[r] >= s.rsMin)) continue;
        if (C.dv[r] < s.dvMin) continue;
        if (s.dvPctMin > 0 && !(C.dvPct[r] >= s.dvPctMin)) continue;
        if (C.rawPrice[r] < s.rawPriceMin) continue;
        if (C.depth52[r] > s.depth52Max) continue;
        if (C.baseDepth[r] > s.baseDepthMax || C.baseDepth[r] < s.baseDepthMin) continue;
        if (C.baseLen[r] < s.baseLenMin && C.fam[r] === famIdx.BASE) continue;
        if (s.tmpl && !C.tmpl[r] && C.ipoAge[r] >= 252) continue;
        if (s.regime === 'spy50' && !C.spy50[r]) continue;
        if (s.regime === 'spy200' && !C.spy200[r]) continue;
        if (s.regime === 'spy21' && !C.spy21[r]) continue;
        if (s.regime === 'breadth40' && !(C.breadth[r] >= 40)) continue;
        if (s.regime === 'breadth50' && !(C.breadth[r] >= 50)) continue;
        if (s.regime === 'nhnl0' && !(C.nhnl[r] >= 0)) continue;
        if (s.regime?.startsWith?.('health') && !(C.health[r] >= Number(s.regime.slice(6)) / 100)) continue;
        if (s.regime?.startsWith?.('s200h') && !(C.spy200[r] && C.health[r] >= Number(s.regime.slice(5)) / 100)) continue;
        if (s.regime?.startsWith?.('s50h') && !(C.spy50[r] && C.health[r] >= Number(s.regime.slice(4)) / 100)) continue;
        if (C.baseCount[r] > s.baseCountMax) continue;
        if (s.inside && !C.inside[r]) continue;
        if (s.rsLineHigh && !C.rsLineHigh[r]) continue;
        if (C.volDry[r] > s.volDryMax) continue;
        if (s.gapVolMax && C.fam[r] === famIdx.GAP && !C.gapVolMax[r]) continue;
        if (C.dist50[r] > s.dist50Max) continue;
        if (C.adr[r] < s.adrMin) continue;
        if (C.ipoAge[r] > s.ipoMax) continue;
        if (C.riskStruct[r] > s.riskMax) continue;
        m[r] = 1;
    }
    return m;
}

// Account % per trade at 1% risk, max 25% position.
export const acct = (ret, risk) => ret * Math.min(1 / risk, 0.25);
const mean = (x) => x.reduce((s, v) => s + v, 0) / (x.length || 1);

// Per-year trade stats for one exit combo.
export function yearly(m, combo) {
    const ci = typeof combo === 'number' ? combo : comboIdx[combo];
    const R = T.R[ci], ret = T.ret[ci], risk = T.risk[ci];
    const by = {};
    for (let r = 0; r < N; r++) {
        if (!m[r] || Number.isNaN(R[r])) continue;
        const y = YEAR[r];
        const b = (by[y] ||= { n: 0, sumR: 0, sumA: 0, sumA2: 0, wins: 0, big: 0, sumWinR: 0, sumLossR: 0 });
        const a = acct(ret[r], risk[r]);
        b.n++; b.sumR += R[r]; b.sumA += a; b.sumA2 += a * a;
        if (R[r] > 0) { b.wins++; b.sumWinR += R[r]; } else b.sumLossR -= R[r];
        if (C.mfe60[r] >= 30) b.big++;
    }
    return by;
}
export function summarize(by, years = null) {
    let n = 0, sumR = 0, sumA = 0, sumA2 = 0, wins = 0, big = 0, w = 0, lo = 0;
    const ys = years ?? Object.keys(by).map(Number);
    for (const y of ys) {
        const b = by[y]; if (!b) continue;
        n += b.n; sumR += b.sumR; sumA += b.sumA; sumA2 += b.sumA2; wins += b.wins; big += b.big; w += b.sumWinR; lo += b.sumLossR;
    }
    if (!n) return { n: 0 };
    const mA = sumA / n, sd = Math.sqrt(Math.max(0, sumA2 / n - mA * mA));
    return { n, avgR: sumR / n, win: wins / n * 100, pf: lo > 0 ? w / lo : Infinity, avgA: mA, t: mA / (sd / Math.sqrt(n)), big: big / n * 100 };
}

// Cash-limited portfolio. trades: rows with combo; one position per ticker.
export function tradesFor(m, combo, from = '0000', to = '9999', order = 'rs') {
    const ci = typeof combo === 'number' ? combo : comboIdx[combo];
    const out = [];
    for (let r = 0; r < N; r++) {
        if (!m[r] || Number.isNaN(T.R[ci][r])) continue;
        const e = C.egi[r];
        const d = T.dates[e];
        if (d < from || d > to) continue;
        out.push({ r, e, x: T.xgi[ci][r], ret: T.ret[ci][r], risk: T.risk[ci][r], tid: C.tid[r], key: order === 'rs' ? C.rs[r] : order === 'up' ? C.upLow52[r] : order === 'risk' ? -T.risk[ci][r] : order === 'dv' ? C.dv[r] : Math.random() });
    }
    return out;
}
export function portfolio(m, combo, from = '0000', to = '9999', { riskPct = 1, maxPos = 0.25, order = 'rs', maxOpen = Infinity } = {}) {
    return simulatePortfolio(tradesFor(m, combo, from, to, order), { riskPct, maxPos, maxOpen });
}
// trades: [{ e, x (global date indices), ret %, risk %, tid, key, r? }].
export function simulatePortfolio(trades, { riskPct = 1, maxPos = 0.25, maxOpen = Infinity } = {}) {
    const byEntry = new Map();
    let g0 = Infinity, g1 = -Infinity;
    for (const tr of trades) {
        (byEntry.get(tr.e) || byEntry.set(tr.e, []).get(tr.e)).push(tr);
        g0 = Math.min(g0, tr.e); g1 = Math.max(g1, tr.x);
    }
    let equity = 100, peak = 100, maxDD = 0, taken = 0, skipped = 0;
    let open = [];
    const held = new Set();
    const yEq = {};
    const takenRows = [];
    if (g0 === Infinity) return { taken: 0, final: 100, cagr: 0, maxDD: 0, yr: {} };
    for (let gi = g0; gi <= g1; gi++) {
        const y = T.dates[gi].slice(0, 4);
        if (!(y in yEq)) yEq[y] = { start: equity };
        const todays = (byEntry.get(gi) || []).sort((a, b) => (b.key ?? -1e9) - (a.key ?? -1e9));
        let used = open.reduce((s, p) => s + p.cost, 0);
        for (const t of todays) {
            if (held.has(t.tid) || open.length >= maxOpen) { skipped++; continue; }
            const size = Math.min(equity * riskPct / 100 / (t.risk / 100), equity * maxPos);
            if (size > equity - used + 1e-9) { skipped++; continue; }
            open.push({ ...t, cost: size }); used += size; held.add(t.tid); taken++; takenRows.push(t.r);
        }
        const still = [];
        for (const p of open) {
            if (p.x <= gi) { equity += p.cost * p.ret / 100; held.delete(p.tid); } else still.push(p);
        }
        open = still;
        peak = Math.max(peak, equity);
        maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
        yEq[y].end = equity;
    }
    const days = g1 - g0 + 1, yrs = days / 252;
    const yr = Object.fromEntries(Object.entries(yEq).map(([y, e]) => [y, (e.end / e.start - 1) * 100]));
    return { taken, skipped, final: equity, cagr: (Math.pow(equity / 100, 1 / yrs) - 1) * 100, maxDD, yrs, yr, takenRows };
}

// SPY return per calendar year.
export const spyYear = (() => {
    const out = {};
    const { i, c } = T.spy;
    let prevY = null, start = null, last = null;
    for (let k = 0; k < i.length; k++) {
        const y = T.dates[i[k]].slice(0, 4);
        if (y !== prevY) { if (prevY) out[prevY] = (last / start - 1) * 100; start = k ? c[k - 1] : c[k]; prevY = y; }
        last = c[k];
    }
    out[prevY] = (last / start - 1) * 100;
    return out;
})();

// Leader recall. leaders: [{ticker, year}] ; a leader is "flagged" if a triggered
// trade with setup in [year-1 Oct, year Dec] exists; "caught" if one returned >= 20%.
export function recall(m, combo, leaders) {
    const ci = comboIdx[combo];
    const byT = new Map();
    for (let r = 0; r < N; r++) {
        if (!m[r] || Number.isNaN(T.R[ci][r])) continue;
        (byT.get(C.tid[r]) || byT.set(C.tid[r], []).get(C.tid[r])).push(r);
    }
    let flagged = 0, caught = 0, n = 0;
    const detail = [];
    for (const { ticker, year } of leaders) {
        const tid = tickerIdx[ticker];
        if (tid === undefined) { detail.push({ ticker, year, status: 'nodata' }); continue; }
        n++;
        const from = `${year - 1}-10-01`, to = `${year}-12-31`;
        let best = -Infinity, cnt = 0;
        for (const r of byT.get(tid) || []) {
            const d = T.dates[C.gi[r]];
            if (d < from || d > to) continue;
            cnt++; best = Math.max(best, T.ret[ci][r]);
        }
        if (cnt) flagged++;
        if (best >= 20) caught++;
        detail.push({ ticker, year, trades: cnt, best: cnt ? +best.toFixed(1) : null });
    }
    return { n, flagged: flagged / n * 100, caught: caught / n * 100, detail };
}

export const BOOK = JSON.parse(fs.readFileSync(path.join(DIR, 'book_leaders.json'))).leaders
    .map(([ticker, year]) => ({ ticker, year })).filter(x => x.year >= 2007);
export const fmtS = (s) => s.n ? `n=${String(s.n).padStart(5)} win=${s.win.toFixed(1).padStart(5)}% avgR=${s.avgR.toFixed(3).padStart(6)} PF=${s.pf.toFixed(2).padStart(5)} acct/tr=${s.avgA.toFixed(3).padStart(6)}% t=${s.t.toFixed(2).padStart(5)} big30=${s.big.toFixed(1)}%` : 'n=0';
