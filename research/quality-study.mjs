// Signal-quality study (2026-10-27): candidate rules that would remove or
// hide live recommendations, tested on the research events.
//
//   node --max-old-space-size=16000 research/quality-study.mjs
//
// Needs research/data/{cache.bin,events.bin} and research/data/earnings.json
// (research/fetch-earnings.mjs). Trades are the live buy rules (rules.json) on
// the live stop|exit combo, exactly as research/cancel-study.mjs selects them.
// A rule is evaluated by removing the trades it would have skipped (the freed
// 10-session no-retrigger lock is ignored; cancel-study showed it adds a
// handful of trades at most). Everything a rule uses is known before the order
// would be filled:
//   earnings dates are scheduled weeks ahead (we use the actual release date);
//   bar data up to the close before the fill (or the fill bar's open for gap rules).
import fs from 'fs';
import v8 from 'v8';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.RESEARCH_DATA || path.join(HERE, 'data');
const RULES = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'scripts/lib/rules.json'), 'utf8'));
const COMBO = `${RULES.stop}|${RULES.exit}`;
const OUT_MD = path.join(HERE, 'reports', 'quality-study.md');
const OUT_JSON = path.join(HERE, 'reports', 'quality-study.json');
const t0 = Date.now();
const lap = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

const L = await import('./lib.mjs');
const { T, simulatePortfolio, idleReturns, yearSpan, comboIdx } = L;
const CI = comboIdx[COMBO];
lap('events loaded');
const cache = v8.deserialize(fs.readFileSync(path.join(DATA, 'cache.bin')));
lap('cache loaded');
const EARN = JSON.parse(fs.readFileSync(path.join(DATA, 'earnings.json'), 'utf8')).tickers;
const G = T.dates.length, G_LAST = G - 1;
if (cache.dates.length !== G || cache.dates[G_LAST] !== T.dates[G_LAST]) throw new Error('cache.bin and events.bin dates differ');
const gOf = new Map(T.dates.map((d, g) => [d, g]));
// First session on/after a calendar date.
function sessionOnOrAfter(d) {
    let lo = 0, hi = G;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T.dates[m] < d) lo = m + 1; else hi = m; }
    return lo;
}

// ---------- live selection (same as cancel-study liveMask) ----------
const fi = Object.fromEntries(T.fams.map((f, i) => [f, i]));
const C = T.cols;
function passes(r, { fams, dvPctMin = RULES.dvPctMin, dvPctMax = Infinity }) {
    if (!fams.includes(C.fam[r])) return false;
    if (C.fam[r] === fi.RANGE && !C.liveC[r]) return false;
    if (C.upLow52[r] < RULES.upLow52Min) return false;
    if (!(C.rs[r] >= RULES.rsMin)) return false;
    if (C.dv[r] < RULES.dvMinM) return false;
    if (!(C.dvPct[r] >= dvPctMin) || C.dvPct[r] >= dvPctMax) return false;
    if (C.rawPrice[r] < (RULES.priceMin ?? 10)) return false;
    if (C.depth52[r] > (RULES.depth52Max ?? Infinity)) return false;
    if (C.baseDepth[r] < 0) return false;
    if (RULES.regime !== 'spy200') throw new Error('regime');
    if (!C.spy200[r]) return false;
    if (C.adr[r] < 0) return false;
    return true;
}
// Baseline = the pre-F7 buy families (HTF is evaluated separately below).
const BUY_FAMS = RULES.families.filter(f => f !== 'HTF').map(f => fi[f]);
const STUDY_YEARS = L.YEARS.filter(y => y >= 2007);
const RECENT = STUDY_YEARS.filter(y => y >= 2023);

// ---------- per-trade context from the bars ----------
const tick = new Map();
function bars(tid) {
    if (tick.has(tid)) return tick.get(tid);
    const p = cache.tickers[T.tickers[tid]];
    const loc = new Map();
    for (let k = 0; k < p.i.length; k++) loc.set(p.i[k], k);
    const v50 = new Float64Array(p.c.length).fill(NaN);
    { let s = 0; for (let k = 0; k < p.c.length; k++) { s += p.v[k]; if (k >= 50) s -= p.v[k - 50]; if (k >= 49) v50[k] = s / 50; } }
    const sma50 = new Float64Array(p.c.length).fill(NaN);
    { let s = 0; for (let k = 0; k < p.c.length; k++) { s += p.c[k]; if (k >= 50) s -= p.c[k - 50]; if (k >= 49) sma50[k] = s / 50; } }
    const o = { p, loc, v50, sma50 };
    tick.set(tid, o);
    return o;
}
// Earnings reaction sessions (global index) per ticker; null = not covered.
const earnCache = new Map();
function earnSessions(t) {
    if (earnCache.has(t)) return earnCache.get(t);
    const e = EARN[t];
    let out = null;
    if (e?.ev?.length) {
        const set = new Set();
        for (const x of e.ev) {
            if (x.amend) continue;
            let g = sessionOnOrAfter(x.date);
            if (g < G && T.dates[g] === x.date && x.hm != null && x.hm >= 1600) g++;
            if (g < G) set.add(g);
        }
        const list = [...set].sort((a, b) => a - b);
        out = { list, from: list[0], to: list[list.length - 1] + 70 };
    }
    earnCache.set(t, out);
    return out;
}
const nextEarn = (es, g) => { if (!es) return null; for (const x of es.list) if (x >= g) return x; return null; };
const prevEarn = (es, g) => { if (!es) return null; let p = null; for (const x of es.list) { if (x > g) break; p = x; } return p; };

function context(r) {
    const tid = C.tid[r], t = T.tickers[tid];
    const B = bars(tid), { p } = B;
    const s = B.loc.get(C.gi[r]), e = C.egi[r] >= 0 ? B.loc.get(C.egi[r]) : -1;
    const pivot = p.c[s] / (1 + C.distPivot[r] / 100);
    const x = { t, s, e, pivot, gs: C.gi[r], ge: C.egi[r] };
    if (e >= 0) {
        x.gapOver = (p.o[e] / pivot - 1) * 100;           // fill-bar open vs pivot (>0: gapped through the stop)
        x.distPrev = (p.c[e - 1] / pivot - 1) * 100;      // last close before the fill vs pivot
    }
    // Deal pin: big jump in the 15 sessions up to s, then a dead-flat tape.
    let jump = -1;
    for (let k = Math.max(1, s - 15); k <= s - 3; k++) {
        const up = p.c[k] / p.c[k - 1] - 1;
        if (up >= 0.15 && p.v[k] >= 4 * B.v50[k - 1]) jump = k;
    }
    let rngAfter = NaN;
    if (jump >= 0) { let sum = 0, n = 0; for (let k = jump + 1; k <= s; k++) { sum += (p.h[k] - p.l[k]) / p.c[k]; n++; } rngAfter = sum / n * 100; }
    x.pinJump = jump >= 0 ? s - jump : -1;
    x.pinRange = rngAfter;
    { let sum = 0; for (let k = s - 4; k <= s; k++) sum += (p.h[k] - p.l[k]) / p.c[k]; x.range5 = sum / 5 * 100; }
    // Earnings.
    const es = earnSessions(t);
    x.earnCovered = !!es && C.gi[r] >= es.from - 70 && C.gi[r] <= es.to;
    if (x.earnCovered) {
        const ne = nextEarn(es, C.gi[r] + 1), pe = prevEarn(es, C.gi[r]);
        x.earnFromSetup = ne == null ? Infinity : ne - C.gi[r];            // sessions from setup to next reaction
        x.earnFromFill = e >= 0 ? (() => { const n2 = nextEarn(es, C.egi[r]); return n2 == null ? Infinity : n2 - C.egi[r]; })() : null;
        x.earnSince = pe == null ? Infinity : C.gi[r] - pe;                 // sessions since the last reaction
    }
    return x;
}

function tradesOf(fams, opts = {}) {
    const out = [];
    for (let r = 0; r < C.gi.length; r++) {
        if (!passes(r, { fams, ...opts })) continue;
        const year = Number(T.dates[C.gi[r]].slice(0, 4));
        if (year < 2007) continue;
        const R = T.R[CI][r];
        if (Number.isNaN(R)) continue;
        out.push({ r, year, fam: T.fams[C.fam[r]], e: C.egi[r], x: T.xgi[CI][r], R, ret: T.ret[CI][r], risk: T.risk[CI][r], tid: C.tid[r], rs: C.rs[r], key: C.rs[r], ctx: context(r) });
    }
    return out;
}
function st(list) {
    const n = list.length;
    if (!n) return { n: 0, win: NaN, avgR: NaN, totR: 0, se: NaN };
    let s = 0, s2 = 0, w = 0;
    for (const x of list) { s += x.R; s2 += x.R * x.R; if (x.R > 0) w++; }
    const avg = s / n, sd = Math.sqrt(Math.max(0, s2 / n - avg * avg));
    return { n, win: w / n * 100, avgR: avg, totR: s, se: sd / Math.sqrt(n) };
}
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
const G2007 = yearSpan(2007)[0], G2023 = yearSpan(2023)[0];
const idleRet = idleReturns(RULES.idleCash?.mode ? RULES.idleCash : { mode: 'none' });
function accounts(list) {
    const tr = list.filter(x => x.e >= G2007);
    const rand = rng(12345), c = [], dd = [];
    for (let i = 0; i < 40; i++) { const p = simulatePortfolio(tr.map(x => ({ ...x, key: rand() }))); c.push(p.cagr); dd.push(p.maxDD); }
    c.sort((a, b) => a - b); dd.sort((a, b) => a - b);
    const q = (a, f) => a[Math.floor(f * (a.length - 1))];
    const rsCash = simulatePortfolio(tr);
    const rsSpy = simulatePortfolio(tr, { idleRet, span: [G2007, G_LAST] });
    const tr23 = tr.filter(x => x.e >= G2023);
    const r23Spy = simulatePortfolio(tr23, { idleRet, span: [G2023, G_LAST] });
    // Walk-forward-free robustness: CAGR in each half.
    const mid = yearSpan(2017)[0];
    const h1 = simulatePortfolio(tr.filter(x => x.e < mid), { idleRet, span: [G2007, mid - 1] });
    const h2 = simulatePortfolio(tr.filter(x => x.e >= mid), { idleRet, span: [mid, G_LAST] });
    return {
        mc: { p10: q(c, 0.1), med: q(c, 0.5), p90: q(c, 0.9), dd: q(dd, 0.5) },
        rsCash: { cagr: rsCash.cagr, dd: rsCash.maxDD, taken: rsCash.taken, yr: rsCash.yr },
        rsSpy: { cagr: rsSpy.cagr, dd: rsSpy.maxDD, yr: rsSpy.yr },
        r23Spy: { cagr: r23Spy.cagr, dd: r23Spy.maxDD },
        h1: h1.cagr, h2: h2.cagr,
    };
}

// ---------- baseline ----------
const BASE = tradesOf(BUY_FAMS);
lap(`baseline ${BASE.length} trades`);
const cov = BASE.filter(x => x.ctx.earnCovered).length;

// ---------- candidate rules (true = skip the trade) ----------
const E = (x) => x.ctx.earnCovered;
const RULESET = {
    // Earnings
    'E-fill0': ['Earnings gap triggers the fill (reaction on the fill day)', x => E(x) && x.ctx.earnFromFill === 0],
    'E-hold5': ['Earnings within 5 sessions after the fill (not the fill day)', x => E(x) && x.ctx.earnFromFill >= 1 && x.ctx.earnFromFill <= 5],
    'E-hold10': ['Earnings within 10 sessions after the fill (not the fill day)', x => E(x) && x.ctx.earnFromFill >= 1 && x.ctx.earnFromFill <= 10],
    'E-0to5': ['Earnings on the fill day or within 5 sessions after', x => E(x) && x.ctx.earnFromFill >= 0 && x.ctx.earnFromFill <= 5],
    'E-0to10': ['Earnings on the fill day or within 10 sessions after', x => E(x) && x.ctx.earnFromFill >= 0 && x.ctx.earnFromFill <= 10],
    'E-setup7': ['Earnings within 7 sessions of the setup day (card warning today)', x => E(x) && x.ctx.earnFromSetup >= 1 && x.ctx.earnFromSetup <= 7],
    'E-setup15': ['Earnings within 15 sessions of the setup day', x => E(x) && x.ctx.earnFromSetup >= 1 && x.ctx.earnFromSetup <= 15],
    // Deal pin / dead tape
    'M-pin1': ['Deal pin: +15% jump on 4x volume in the last 15 sessions, then avg daily range < 1%', x => x.ctx.pinJump >= 0 && x.ctx.pinRange < 1],
    'M-pin15': ['Deal pin: same, avg daily range < 1.5%', x => x.ctx.pinJump >= 0 && x.ctx.pinRange < 1.5],
    'M-flat1': ['Dead tape: 5-day avg daily range < 1%', x => x.ctx.range5 < 1],
    // Entry quality
    'G-gap3': ['Fill bar opens > 3% above the pivot (gap through the buy stop)', x => x.ctx.gapOver > 3],
    'G-gap5': ['Fill bar opens > 5% above the pivot', x => x.ctx.gapOver > 5],
    'G-gap8': ['Fill bar opens > 8% above the pivot', x => x.ctx.gapOver > 8],
    // Combinations
    'E-fill0+G-gap3': ['Earnings-gap fill or open > 3% above the pivot', x => (E(x) && x.ctx.earnFromFill === 0) || x.ctx.gapOver > 3],
    'E-fill0+pin': ['Earnings-gap fill or deal pin', x => (E(x) && x.ctx.earnFromFill === 0) || (x.ctx.pinJump >= 0 && x.ctx.pinRange < 1)],
    // Risk / extension (the grid already searched riskMax and dist50Max walk-forward; in-sample check only)
    'R-risk10': ['Structural risk > 10% (stop clamped well inside the structure)', x => C.riskStruct[x.r] > 10],
    'R-risk15': ['Structural risk > 15%', x => C.riskStruct[x.r] > 15],
    'X-ext25': ['Setup close > 25% above the 50-day SMA', x => C.dist50[x.r] > 25],
    'X-ext40': ['Setup close > 40% above the 50-day SMA', x => C.dist50[x.r] > 40],
};
const RK = Object.keys(RULESET);
const res = {};
const baseByR = new Set(BASE.map(x => x.r));
function evaluate(label, skip) {
    const kept = BASE.filter(x => !skip(x)), removed = BASE.filter(x => skip(x));
    return {
        label, all: st(kept), recent: st(kept.filter(x => x.year >= 2023)), removed: st(removed),
        removedRecent: st(removed.filter(x => x.year >= 2023)),
        removedList: removed.slice(0, 400).map(x => ({ t: x.ctx.t, d: T.dates[C.gi[x.r]], fam: x.fam, R: +x.R.toFixed(2) })),
        acct: accounts(kept),
    };
}
function byYear(skip) { const o = {}; for (const x of BASE) if (skip(x)) { const b = (o[x.year] ||= { n: 0, R: 0 }); b.n++; b.R += x.R; } return o; }
res.base = evaluate('Baseline (live rules)', () => false);
for (const k of RK) { res[k] = evaluate(RULESET[k][0], RULESET[k][1]); res[k].removedByYear = byYear(RULESET[k][1]); lap(`${k}: removed ${res[k].removed.n} avgR ${res[k].removed.avgR?.toFixed(3)}`); }

// ---------- deal-pin census (survivorship check) ----------
const pinCensus = (() => {
    let n = 0, nf = 0, sumR = 0; const ex = [];
    for (let r = 0; r < C.gi.length; r++) {
        if (!BUY_FAMS.includes(C.fam[r]) || C.rawPrice[r] < 5 || C.dv[r] < 5) continue;
        if (Number(T.dates[C.gi[r]].slice(0, 4)) < 2007) continue;
        const B = bars(C.tid[r]), { p } = B, s = B.loc.get(C.gi[r]);
        let jump = -1;
        for (let k = Math.max(1, s - 15); k <= s - 3; k++) if (p.c[k] / p.c[k - 1] - 1 >= 0.15 && p.v[k] >= 4 * B.v50[k - 1]) jump = k;
        if (jump < 0) continue;
        let sum = 0, m = 0; for (let k = jump + 1; k <= s; k++) { sum += (p.h[k] - p.l[k]) / p.c[k]; m++; }
        if (sum / m * 100 >= 1) continue;
        n++;
        if (!Number.isNaN(T.R[CI][r])) { nf++; sumR += T.R[CI][r]; }
        if (ex.length < 30) ex.push(`${T.tickers[C.tid[r]]} ${T.dates[C.gi[r]]} R=${Number.isNaN(T.R[CI][r]) ? 'nofill' : T.R[CI][r].toFixed(2)}`);
    }
    return { n, filled: nf, avgR: nf ? sumR / nf : NaN, ex };
})();
lap(`pin census ${JSON.stringify(pinCensus)}`);

// ---------- display: distance to pivot while pending ----------
// For every live setup row (filled or not) and every pending close k = s..s+4
// (order live for k+1..s+5): does it fill later, and with what R?
const pend = [];
const bucketsDef = [[-Infinity, -15], [-15, -10], [-10, -8], [-8, -6], [-6, -4], [-4, -2], [-2, Infinity]];
const buckets = bucketsDef.map(([a, b]) => ({ a, b, n: 0, fill: 0, sumR: 0, R: [] }));
for (let r = 0; r < C.gi.length; r++) {
    if (!passes(r, { fams: BUY_FAMS })) continue;
    if (Number(T.dates[C.gi[r]].slice(0, 4)) < 2007) continue;
    const B = bars(C.tid[r]), { p } = B;
    const s = B.loc.get(C.gi[r]);
    const e = C.egi[r] >= 0 ? B.loc.get(C.egi[r]) : -1;
    const pivot = p.c[s] / (1 + C.distPivot[r] / 100);
    const W = 5;
    for (let k = s; k < Math.min(p.c.length - 1, s + W); k++) {
        if (e >= 0 && e <= k) break; // already filled
        const d = (p.c[k] / pivot - 1) * 100;
        const b = buckets.find(q => d >= q.a && d < q.b);
        b.n++;
        if (e > k && !Number.isNaN(T.R[CI][r])) { b.fill++; b.sumR += T.R[CI][r]; b.R.push(T.R[CI][r]); }
    }
}
const pendTable = buckets.map(b => ({ range: `${b.a}..${b.b}`, closes: b.n, fillRate: b.n ? b.fill / b.n * 100 : NaN, fills: b.fill, avgR: b.fill ? b.sumR / b.fill : NaN }));
// Filled trades by distance of the last close before the fill.
const fillDist = bucketsDef.map(([a, b]) => { const l = BASE.filter(x => x.ctx.distPrev >= a && x.ctx.distPrev < b); return { range: `${a}..${b}`, ...st(l) }; });

// ---------- watchlist band and tracked families ----------
const WATCH = tradesOf(BUY_FAMS, { dvPctMin: 70, dvPctMax: RULES.dvPctMin });
const HTF = fi.HTF != null ? tradesOf([fi.HTF]) : [];
const bands = {
    watch70_85: st(WATCH), watch70_85_recent: st(WATCH.filter(x => x.year >= 2023)),
    htf: st(HTF), htf_recent: st(HTF.filter(x => x.year >= 2023)),
    htf_acct_alone: HTF.length ? accounts(HTF).rsSpy : null,
};
// Do they add to the account if traded alongside the buy rules?
const withWatch = accounts([...BASE, ...WATCH]);
const withHtf = accounts([...BASE, ...HTF]);
// Adopted package (rules 2026-10-27): HTF as a buy family + earnings-session skip + 3% gap limit + deal pin.
const ADOPT_SKIP = (x) => (E(x) && x.ctx.earnFromFill === 0) || x.ctx.gapOver > 3 || (x.ctx.pinJump >= 0 && x.ctx.pinRange < 1);
const ALL4 = [...BASE, ...HTF];
const adopted = { label: 'HTF + earnings-session skip + gap limit 3% + deal pin', all: st(ALL4.filter(x => !ADOPT_SKIP(x))), recent: st(ALL4.filter(x => !ADOPT_SKIP(x) && x.year >= 2023)), removed: st(ALL4.filter(ADOPT_SKIP)), acct: accounts(ALL4.filter(x => !ADOPT_SKIP(x))), htfOnly: st(HTF.filter(x => !ADOPT_SKIP(x))), withHtf };

fs.writeFileSync(OUT_JSON, JSON.stringify({ rules: RULES.version, combo: COMBO, coverage: { trades: BASE.length, earnCovered: cov }, res, pendTable, fillDist, bands, pinCensus, adopted, withWatch, withHtf }, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x), 1));
lap(`wrote ${OUT_JSON}`);

// ---------- report ----------
const f = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(d));
const sg = (x, d = 2) => (x == null || !Number.isFinite(x) ? '–' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}`);
const M = [];
M.push('# Signal-quality study', '', `Generated ${new Date().toISOString().slice(0, 10)} by \`research/quality-study.mjs\`. Rules ${RULES.version}, combo ${COMBO}, setups 2007-${STUDY_YEARS.at(-1)}, data to ${T.dates[G_LAST]}.`);
M.push(`Earnings dates (SEC 8-K Item 2.02) cover ${cov} of ${BASE.length} trades (${f(cov / BASE.length * 100)}%); uncovered trades are never skipped by an earnings rule.`, '');
M.push('## Rules', '', '| Rule | Removed | Removed avg R ± SE | Removed 23-26 n / avg R | Kept avg R | CAGR random p10/med/p90 | Med DD | RS + idle SPY CAGR / DD | 2007-16 / 2017-26 CAGR | 2023-26 CAGR |', '|---|---|---|---|---|---|---|---|---|---|');
for (const k of ['base', ...RK]) {
    const r = res[k], a = r.acct;
    M.push(`| ${k === 'base' ? 'Baseline' : `${k}: ${r.label}`} | ${k === 'base' ? '–' : r.removed.n} | ${k === 'base' ? '–' : `${sg(r.removed.avgR, 3)} ± ${f(r.removed.se, 3)}`} | ${k === 'base' ? '–' : `${r.removedRecent.n} / ${sg(r.removedRecent.avgR, 2)}`} | ${sg(r.all.avgR, 3)} (n ${r.all.n}) | ${f(a.mc.p10)} / ${f(a.mc.med)} / ${f(a.mc.p90)}% | ${f(a.mc.dd)}% | ${f(a.rsSpy.cagr)}% / ${f(a.rsSpy.dd)}% | ${f(a.h1)} / ${f(a.h2)}% | ${f(a.r23Spy.cagr)}% |`);
}
M.push('', '## Pending setups: distance of the close below the pivot', '', '| Close vs pivot % | Pending closes | Fill later % | Fills | Avg R of those fills |', '|---|---|---|---|---|');
for (const b of pendTable) M.push(`| ${b.range} | ${b.closes} | ${f(b.fillRate)} | ${b.fills} | ${sg(b.avgR)} |`);
M.push('', 'Filled trades by the last close before the fill:', '', '| Close vs pivot % | Trades | Win | Avg R | Total R |', '|---|---|---|---|---|');
for (const b of fillDist) M.push(`| ${b.range} | ${b.n} | ${f(b.win)}% | ${sg(b.avgR, 3)} | ${sg(b.totR, 0)} |`);
M.push('', `Deal-pin census (buy families, any RS/liquidity, price >= $5, $5M+/day, 2007+): ${pinCensus.n} setups, ${pinCensus.filled} filled, avg R ${sg(pinCensus.avgR)}. Examples: ${pinCensus.ex.join('; ')}.`);
M.push('', '## Watchlist band and tracked families', '');
M.push(`- Liquidity rank 70-85 (today's watchlist band), same rules: ${bands.watch70_85.n} trades, avg R ${sg(bands.watch70_85.avgR, 3)} ± ${f(bands.watch70_85.se, 3)}; 2023-26 ${bands.watch70_85_recent.n} / ${sg(bands.watch70_85_recent.avgR, 3)}. Added to the buy rules: CAGR med ${f(withWatch.mc.med)}% (base ${f(res.base.acct.mc.med)}%), RS+SPY ${f(withWatch.rsSpy.cagr)}% / DD ${f(withWatch.rsSpy.dd)}%.`);
M.push(`- High Tight Flags, same rules: ${bands.htf.n} trades, avg R ${sg(bands.htf.avgR, 3)} ± ${f(bands.htf.se, 3)}; 2023-26 ${bands.htf_recent.n} / ${sg(bands.htf_recent.avgR, 3)}. Added: CAGR med ${f(withHtf.mc.med)}%, RS+SPY ${f(withHtf.rsSpy.cagr)}% / DD ${f(withHtf.rsSpy.dd)}%.`);
{ const a = adopted.acct; M.push('', '## Adopted package', '', `${adopted.label}: ${adopted.all.n} trades, avg R ${sg(adopted.all.avgR, 3)} (2023-26 ${adopted.recent.n} / ${sg(adopted.recent.avgR, 3)}); removed ${adopted.removed.n} at ${sg(adopted.removed.avgR, 3)}. CAGR random p10/med/p90 ${f(a.mc.p10)} / ${f(a.mc.med)} / ${f(a.mc.p90)}%, med DD ${f(a.mc.dd)}%; RS + idle SPY ${f(a.rsSpy.cagr)}% / DD ${f(a.rsSpy.dd)}%; 2007-16 / 2017-26 ${f(a.h1)} / ${f(a.h2)}%; 2023-26 ${f(a.r23Spy.cagr)}%.`); }
fs.writeFileSync(OUT_MD, M.join('\n') + '\n');
console.log(M.join('\n'));
