// Walk-forward selection (portfolio-level "WF-P"), one test year per process:
//   node research/select.mjs <year>
// Stage 1: grid candidates ranked by a trade-level objective on the training
//          years (all years before <year>) -> top K.
// Stage 2: cash-limited portfolio simulation of each on the training years;
//          pick the best by score = CAGR - 0.5 * maxDD (pre-registered).
// Then simulate the test year with the pick (entries in the test year).
// Menu: family sets the live screener implements and filter options it
// implements (LIVE_MENU=0 to search the full research grid).
// Writes data/select_<TAG>_<year>.json.
import fs from 'fs';
import v8 from 'v8';
import path from 'path';
import { FAMSETS, decode, NCAND_F, LIVE_FAMSETS, liveMenu } from './grid.mjs';
import { T, mask, portfolio } from './lib.mjs';

const DATA = process.env.RESEARCH_DATA || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const K = Number(process.env.K ?? 150), CAP = 120, MIN_N = 150;
const LIVE = process.env.LIVE_MENU !== '0';
const TAG = process.env.TAG ?? 'live';
const ALLOWED = process.env.ALLOWED ? process.env.ALLOWED.split(',').map(Number) : LIVE_FAMSETS;

export function toSpec(fi, cand) {
    const g = decode(cand);
    const s = { fams: FAMSETS[fi], liveOnly: 1, rawPriceMin: 10, upLow52Min: g.upLow52Min, rsMin: g.rsMin, regime: g.regime, tmpl: g.tmpl, depth52Max: g.depth52Max ?? Infinity };
    if (g.liq === 'dv20') s.dvMin = 20; else if (g.liq === 'dv50') s.dvMin = 50; else { s.dvMin = 10; s.dvPctMin = 85; }
    if (g.extra === 'base12') s.baseCountMax = 1; else if (g.extra === 'rsline') s.rsLineHigh = 1; else if (g.extra === 'inside') s.inside = 1;
    return s;
}
// research spec + exit combo -> scripts/lib/rules.json fields (live menu only).
export function toRules(fi, cand, combo) {
    const g = decode(cand);
    const [stop, exit] = combo.split('|');
    const liq = g.liq === 'dv20' ? { dvPctMin: 0, dvMinM: 20 } : g.liq === 'dv50' ? { dvPctMin: 0, dvMinM: 50 } : { dvPctMin: 85, dvMinM: 10 };
    return {
        families: FAMSETS[fi], regime: g.regime, rsMin: g.rsMin, ...liq, priceMin: 10,
        upLow52Min: g.upLow52Min, depth52Max: Number.isFinite(g.depth52Max) ? g.depth52Max : null, stop, exit,
    };
}

function objective(g, cand, ci, a, b) {
    const { NY, NC } = g;
    let tot = 0, s = 0, s2 = 0, k = 0;
    for (let y = a; y <= b; y++) {
        const o = ((cand * NC + ci) * NY + y) * 5;
        const n = g.out[o], sa = g.out[o + 1];
        tot += n; const ry = n ? (sa / n) * Math.min(n, CAP) : 0; s += ry; s2 += ry * ry; k++;
    }
    if (tot < MIN_N) return -Infinity;
    const m = s / k; return m - 0.5 * Math.sqrt(Math.max(0, s2 / k - m * m));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const yt = Number(process.argv[2]);
    const grids = {};
    for (const fi of ALLOWED) grids[fi] = v8.deserialize(fs.readFileSync(path.join(DATA, `grid_${fi}.bin`)));
    const { y0, NC } = grids[ALLOWED[0]];
    const trainTo = yt - 1 - y0;
    const top = [];
    for (const fi of ALLOWED) for (let cand = 0; cand < NCAND_F; cand++) {
        if (LIVE && !liveMenu(decode(cand))) continue;
        for (let ci = 0; ci < NC; ci++) {
            const ob = objective(grids[fi], cand, ci, 0, trainTo);
            if (ob === -Infinity) continue;
            if (top.length < K || ob > top[top.length - 1].ob) {
                top.push({ ob, fi, cand, ci }); top.sort((a, b) => b.ob - a.ob); if (top.length > K) top.pop();
            }
        }
    }
    let best = null;
    for (const t of top) {
        const spec = toSpec(t.fi, t.cand);
        const pf = portfolio(mask(spec), T.combos[t.ci], '2006', `${yt - 1}-12-31`);
        const score = pf.cagr - 0.5 * pf.maxDD;
        if (!best || score > best.score) best = { ...t, score, train: { cagr: pf.cagr, maxDD: pf.maxDD }, spec };
    }
    const combo = T.combos[best.ci];
    const oos = portfolio(mask(best.spec), combo, `${yt}-01-01`, `${yt}-12-31`);
    const res = {
        year: yt, pick: `${FAMSETS[best.fi].join('+')} ${JSON.stringify(decode(best.cand))} ${combo}`,
        fi: best.fi, cand: best.cand, ci: best.ci, combo, spec: best.spec, rules: toRules(best.fi, best.cand, combo),
        train: best.train, oos: { ret: (oos.final / 100 - 1) * 100, maxDD: oos.maxDD, taken: oos.taken },
    };
    fs.writeFileSync(path.join(DATA, `select_${TAG}_${yt}.json`), JSON.stringify(res));
    console.log(`${yt}: OOS ${res.oos.ret.toFixed(1)}% (DD ${res.oos.maxDD.toFixed(1)}%, ${res.oos.taken} trades) train CAGR ${best.train.cagr.toFixed(1)}% DD ${best.train.maxDD.toFixed(1)}% <= ${res.pick}`);
}
