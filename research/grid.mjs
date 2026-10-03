// Pre-registered candidate grid. Run one process per family set:
//   node research/grid.mjs <famsetIndex>
// Writes per-candidate, per-year (n, sumAcct, sumR, wins, big) to data/grid_<i>.bin.
// Indices are stable (reports and select results refer to them).
import fs from 'fs';
import v8 from 'v8';
import path from 'path';
const DATA = process.env.RESEARCH_DATA || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const { T, C, N, famIdx, YEAR, YEARS, acct } = process.argv[2] !== undefined && import.meta.url === `file://${process.argv[1]}` ? await import('./lib.mjs') : {};
export const FAMSETS = [
    ['RANGE'], ['TIGHT'], ['BASE'], ['HTF'], ['PEB'], ['OOPS'], ['GAP'],
    ['RANGE', 'BASE'], ['BASE', 'HTF', 'GAP'], ['RANGE', 'TIGHT', 'BASE', 'HTF'],
    ['RANGE', 'TIGHT', 'BASE', 'HTF', 'GAP'], ['RANGE', 'TIGHT', 'BASE', 'HTF', 'PEB', 'OOPS', 'GAP'],
    // 12-20: the remaining subsets of the live families (added for the HTF review).
    ['RANGE', 'TIGHT'], ['RANGE', 'HTF'], ['TIGHT', 'BASE'], ['TIGHT', 'HTF'], ['BASE', 'HTF'],
    ['RANGE', 'TIGHT', 'BASE'], ['RANGE', 'TIGHT', 'HTF'], ['RANGE', 'BASE', 'HTF'], ['TIGHT', 'BASE', 'HTF'],
];
export const GRID = {
    upLow52Min: [0, 50, 100, 200],
    rsMin: [0, 80, 90],
    liq: ['dv20', 'dv50', 'pct85'],
    regime: ['none', 'spy50', 'spy200', 'breadth50'],
    tmpl: [0, 1],
    depth52Max: [25, 35, Infinity],
    extra: ['none', 'base12', 'rsline', 'inside'],
};
export const KEYS = Object.keys(GRID);
// Families the live screener implements (scripts/lib/leader-rules.mjs), the
// family sets made only of them, and the filter options it implements (no
// trend-template / base-count / RS-line / inside-day extras).
export const LIVE_FAMILIES = ['RANGE', 'TIGHT', 'BASE', 'HTF'];
export const LIVE_FAMSETS = FAMSETS.map((f, i) => [f, i]).filter(([f]) => f.every(x => LIVE_FAMILIES.includes(x))).map(([, i]) => i);
export const liveMenu = (spec) => spec.tmpl === 0 && spec.extra === 'none';
export const NCAND_F = KEYS.reduce((p, k) => p * GRID[k].length, 1);
export function decode(idx) {
    const spec = {};
    for (const k of [...KEYS].reverse()) { const v = GRID[k]; spec[k] = v[idx % v.length]; idx = Math.floor(idx / v.length); }
    return spec;
}

if (process.argv[2] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    const fi = Number(process.argv[2]);
    const fams = new Set(FAMSETS[fi].map(f => famIdx[f]));
    const rows = [];
    for (let r = 0; r < N; r++) if (fams.has(C.fam[r]) && C.egi[r] >= 0 && C.rawPrice[r] >= 10) rows.push(r);
    const NY = YEARS.length, y0 = YEARS[0];
    const NC = T.combos.length;
    // Per-row acct and R per combo.
    const Acc = T.combos.map((_, ci) => Float32Array.from(rows, r => acct(T.ret[ci][r], T.risk[ci][r])));
    const Rr = T.combos.map((_, ci) => Float32Array.from(rows, r => T.R[ci][r]));
    const yi = Int16Array.from(rows, r => YEAR[r] - y0);
    // Stats layout: [cand][combo][year][5]
    const out = new Float32Array(NCAND_F * NC * NY * 5);
    const pass = new Int32Array(rows.length);
    for (let cand = 0; cand < NCAND_F; cand++) {
        const s = decode(cand);
        let np = 0;
        for (let q = 0; q < rows.length; q++) {
            const r = rows[q];
            if (C.upLow52[r] < s.upLow52Min) continue;
            if (s.rsMin && !(C.rs[r] >= s.rsMin)) continue;
            if (s.liq === 'dv20' ? C.dv[r] < 20 : s.liq === 'dv50' ? C.dv[r] < 50 : !(C.dvPct[r] >= 85 && C.dv[r] >= 10)) continue;
            if (s.regime === 'spy50' && !C.spy50[r]) continue;
            if (s.regime === 'spy200' && !C.spy200[r]) continue;
            if (s.regime === 'breadth50' && !(C.breadth[r] >= 50)) continue;
            if (s.tmpl && !C.tmpl[r] && C.ipoAge[r] >= 252) continue;
            if (C.depth52[r] > s.depth52Max) continue;
            if (s.extra === 'base12' && C.baseCount[r] > 1) continue;
            if (s.extra === 'rsline' && !C.rsLineHigh[r]) continue;
            if (s.extra === 'inside' && !C.inside[r]) continue;
            if (C.fam[r] === famIdx.RANGE && !C.liveC[r]) continue; // live rules include the trap check
            pass[np++] = q;
        }
        for (let ci = 0; ci < NC; ci++) {
            const A = Acc[ci], R = Rr[ci];
            const base = (cand * NC + ci) * NY * 5;
            for (let z = 0; z < np; z++) {
                const q = pass[z];
                const a = A[q];
                if (a !== a) continue; // NaN
                const o = base + yi[q] * 5;
                out[o]++; out[o + 1] += a; out[o + 2] += R[q];
                if (R[q] > 0) out[o + 3]++;
                if (C.mfe60[rows[q]] >= 30) out[o + 4]++;
            }
        }
        if (cand % 500 === 0) console.log(`famset ${fi} cand ${cand}/${NCAND_F}`);
    }
    fs.writeFileSync(path.join(DATA, `grid_${fi}.bin`), v8.serialize({ fi, NY, y0, NC, out }));
    console.log(`famset ${fi} done`);
}
