// Group / theme study (2026-10-27): do setups in leading industry groups do
// better, and should the tool filter or size up on them?
//
//   node research/fetch-industries.mjs      (once: data/industries.json)
//   node --max-old-space-size=16000 research/group-study.mjs
//
// Needs research/data/{cache.bin,events.bin,earnings.json,industries.json}.
// The trade selection below is copied from research/quality-study.mjs (live
// buy rules, all rules.json families, with the F7 entry skips applied).
import v8 from 'v8';
import fs from 'fs';
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
// All live buy families (F7 includes HTF).
const BUY_FAMS = RULES.families.map(f => fi[f]);
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
const E = (x) => x.ctx.earnCovered;

// ======================= group / theme study (2026-10-27) =======================
// Thesis: Model Book leaders worked when they were in leading themes / industry
// groups. Group strength is measured point-in-time on the setup day from the
// research price cache (classification: today's Nasdaq industry / sector,
// research/fetch-industries.mjs):
//   stock RS rank: IBD-style weighted 3/6/9/12-month return, percentile across
//                  the liquid universe that day (20-day $ volume >= $5M);
//   group score:   mean RS rank of the group's liquid members (>= 4 members);
//   group rank:    percentile of the group score across groups (100 = best);
//   leaders:       other members with RS rank >= 90 that day (theme breadth);
//   group 3m:      median 63-day return of the members, ranked across groups.
const IND = JSON.parse(fs.readFileSync(path.join(DATA, 'industries.json'), 'utf8')).tickers;
const OUT2_MD = path.join(HERE, 'reports', 'group-study.md');
const OUT2_JSON = path.join(HERE, 'reports', 'group-study.json');
const ALL = BASE.filter(x => !((E(x) && x.ctx.earnFromFill === 0) || x.ctx.gapOver > 3 || (x.ctx.pinJump >= 0 && x.ctx.pinRange < 1)));
lap(`live F7 trades: ${ALL.length}`);

// Per-ticker helpers on the cache (local index k <-> global index g).
const TK = Object.keys(cache.tickers);
const tinfo = TK.map(t => {
    const p = cache.tickers[t];
    const cv = new Float64Array(p.c.length + 1);
    for (let k = 0; k < p.c.length; k++) cv[k + 1] = cv[k] + p.c[k] * p.v[k];
    return { t, p, cv, ind: IND[t]?.industry || null, sec: IND[t]?.sector || null };
});
function localIdx(p, g) {
    let lo = 0, hi = p.i.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (p.i[m] < g) lo = m + 1; else hi = m; }
    return lo < p.i.length && p.i[lo] === g ? lo : -1;
}
const perf = (c, k, n) => c[k] / c[k - n] - 1;
function rsScoreAt(c, k) {
    if (k < 63) return NaN;
    const p63 = perf(c, k, 63), p126 = k >= 126 ? perf(c, k, 126) : p63, p189 = k >= 189 ? perf(c, k, 189) : p126, p252 = k >= 252 ? perf(c, k, 252) : p189;
    return 0.4 * p63 + 0.2 * p126 + 0.2 * p189 + 0.2 * p252;
}
// Snapshot of every liquid stock on global day g: Map ticker -> { rank, ret63 },
// plus per-group aggregates for industries and sectors.
const snapCache = new Map();
function snapshot(g) {
    if (snapCache.has(g)) return snapCache.get(g);
    const rows = [];
    for (const ti of tinfo) {
        const k = localIdx(ti.p, g);
        if (k < 63) continue;
        if (k >= 20 && (ti.cv[k + 1] - ti.cv[k - 19]) / 20 < 5e6) continue;
        if (k < 20) continue;
        const sc = rsScoreAt(ti.p.c, k);
        if (!Number.isFinite(sc)) continue;
        rows.push({ ti, sc, ret63: perf(ti.p.c, k, 63) });
    }
    rows.sort((a, b) => a.sc - b.sc);
    rows.forEach((r, i) => { r.rank = i / rows.length * 100; });
    const agg = (key) => {
        const gm = new Map();
        for (const r of rows) {
            const k = r.ti[key];
            if (!k) continue;
            const a = gm.get(k) || gm.set(k, { n: 0, sum: 0, lead: 0, rets: [] }).get(k);
            a.n++; a.sum += r.rank; if (r.rank >= 90) a.lead++; a.rets.push(r.ret63);
        }
        const valid = [...gm.entries()].filter(([, a]) => a.n >= 4);
        for (const [, a] of valid) { a.score = a.sum / a.n; a.rets.sort((x, y) => x - y); a.med63 = a.rets[a.rets.length >> 1]; delete a.rets; }
        const byScore = [...valid].sort((x, y) => x[1].score - y[1].score);
        byScore.forEach(([, a], i) => { a.rank = byScore.length > 1 ? i / (byScore.length - 1) * 100 : 50; });
        const byRet = [...valid].sort((x, y) => x[1].med63 - y[1].med63);
        byRet.forEach(([, a], i) => { a.rank63 = byRet.length > 1 ? i / (byRet.length - 1) * 100 : 50; });
        return { map: gm, count: valid.length };
    };
    const byT = new Map(rows.map(r => [r.ti.t, r]));
    const out = { byT, ind: agg('ind'), sec: agg('sec'), n: rows.length };
    snapCache.set(g, out);
    if (snapCache.size > 400) snapCache.delete(snapCache.keys().next().value);
    return out;
}
function groupCtx(t, g) {
    const S = snapshot(g);
    const ind = IND[t]?.industry, sec = IND[t]?.sector;
    const me = S.byT.get(t);
    const ia = ind ? S.ind.map.get(ind) : null, sa = sec ? S.sec.map.get(sec) : null;
    const lead = ia ? ia.lead - (me && me.rank >= 90 ? 1 : 0) : null;
    return {
        ind, sec, indN: ia?.n ?? 0,
        indRank: ia && ia.n >= 4 ? ia.rank : null, ind63: ia && ia.n >= 4 ? ia.rank63 : null,
        lead: ia && ia.n >= 4 ? lead : null, secRank: sa && sa.n >= 4 ? sa.rank : null,
    };
}
// Attach group context on the setup day, in date order (snapshot cache locality).
ALL.sort((a, b) => C.gi[a.r] - C.gi[b.r]);
let done = 0;
for (const x of ALL) {
    x.grp = groupCtx(x.ctx.t, C.gi[x.r]);
    if (++done % 200 === 0) lap(`group context ${done}/${ALL.length}`);
}
const known = ALL.filter(x => x.grp.indRank != null);
lap(`group context done; industry known for ${known.length}/${ALL.length}`);

// ---------- 1: buckets ----------
const bucket = (list, fn, edges) => edges.map(([lo, hi, label]) => {
    const l = list.filter(x => { const v = fn(x); return v != null && v >= lo && v < hi; });
    return { label, all: st(l), recent: st(l.filter(x => x.year >= 2023)), h1: st(l.filter(x => x.year < 2017)), h2: st(l.filter(x => x.year >= 2017)) };
});
const Q5 = [[0, 20, '0-20 (weakest)'], [20, 40, '20-40'], [40, 60, '40-60'], [60, 80, '60-80'], [80, 101, '80-100 (leading)']];
const B = {
    indRank: bucket(known, x => x.grp.indRank, Q5),
    ind63: bucket(known, x => x.grp.ind63, Q5),
    secRank: bucket(ALL.filter(x => x.grp.secRank != null), x => x.grp.secRank, Q5),
    lead: bucket(known, x => x.grp.lead, [[0, 1, '0 other leaders'], [1, 2, '1'], [2, 4, '2-3'], [4, 8, '4-7'], [8, 1e9, '8+']]),
    unknown: st(ALL.filter(x => x.grp.indRank == null)),
};
// Share of leaders in group (normalizes for big industries).
B.leadShare = bucket(known, x => x.grp.indN ? (x.grp.lead / x.grp.indN) * 100 : null, [[0, 5, '<5% of members RS 90+'], [5, 10, '5-10%'], [10, 20, '10-20%'], [20, 101, '20%+']]);

// ---------- 2: Model Book leaders: group rank when their run started ----------
// Start of the run = the session in the leader year with the best forward
// 63-session return; group rank on that day.
const bookRows = [];
for (const { ticker, year } of L.BOOK) {
    const ti = tinfo.find(x => x.t === ticker);
    if (!ti || !ti.ind) continue;
    const [g0, g1] = yearSpan(year);
    let best = -Infinity, bg = -1;
    for (let k = 0; k + 63 < ti.p.i.length; k++) {
        const g = ti.p.i[k];
        if (g < g0 || g > g1) continue;
        const f = ti.p.c[k + 63] / ti.p.c[k] - 1;
        if (f > best) { best = f; bg = g; }
    }
    if (bg < 0) continue;
    const gc = groupCtx(ticker, bg);
    if (gc.indRank == null) continue;
    bookRows.push({ ticker, year, date: T.dates[bg], fwd63: +(best * 100).toFixed(0), ind: gc.ind, indRank: +gc.indRank.toFixed(0), ind63: +gc.ind63.toFixed(0), lead: gc.lead, secRank: gc.secRank != null ? +gc.secRank.toFixed(0) : null });
}
const share = (rows, f) => rows.length ? rows.filter(f).length / rows.length * 100 : NaN;
const bookStats = {
    n: bookRows.length,
    top20: share(bookRows, r => r.indRank >= 80), top40: share(bookRows, r => r.indRank >= 60), bottom40: share(bookRows, r => r.indRank < 40),
    medRank: bookRows.map(r => r.indRank).sort((a, b) => a - b)[bookRows.length >> 1],
    lead2: share(bookRows, r => r.lead >= 2),
};
const tradeShare = {
    top20: share(known, x => x.grp.indRank >= 80), top40: share(known, x => x.grp.indRank >= 60), bottom40: share(known, x => x.grp.indRank < 40),
    medRank: known.map(x => x.grp.indRank).sort((a, b) => a - b)[known.length >> 1],
    lead2: share(known, x => x.grp.lead >= 2),
};
lap(`book leaders with group data: ${bookRows.length}`);

// ---------- 3: policies (account) ----------
const strong = (x, thr) => x.grp.indRank != null && x.grp.indRank >= thr;
const weak = (x, thr) => x.grp.indRank != null && x.grp.indRank < thr;
const POL = {
    base: ['Live F7 rules (no group rule)', ALL],
    f40: ['Filter: skip industry rank < 40', ALL.filter(x => !weak(x, 40))],
    f50: ['Filter: skip industry rank < 50', ALL.filter(x => !weak(x, 50))],
    f67: ['Filter: industry rank >= 67 only (unknown kept)', ALL.filter(x => !weak(x, 67))],
    f80: ['Filter: industry rank >= 80 only (unknown kept)', ALL.filter(x => !weak(x, 80))],
    fLead2: ['Filter: >= 2 other RS-90 leaders in the industry', ALL.filter(x => x.grp.lead == null || x.grp.lead >= 2)],
    c80: ['Conviction: 1.5% risk when industry rank >= 80', ALL.map(x => ({ ...x, riskMult: strong(x, 80) ? 1.5 : 1 }))],
    c80w: ['Conviction: 1.5% risk rank >= 80, 0.5% risk rank < 40', ALL.map(x => ({ ...x, riskMult: strong(x, 80) ? 1.5 : weak(x, 40) ? 0.5 : 1 }))],
    c67: ['Conviction: 1.5% risk when industry rank >= 67', ALL.map(x => ({ ...x, riskMult: strong(x, 67) ? 1.5 : 1 }))],
    cLead: ['Conviction: 1.5% risk when >= 2 other RS-90 leaders in the industry', ALL.map(x => ({ ...x, riskMult: x.grp.lead >= 2 ? 1.5 : 1 }))],
    r125: ['Control: 1.25% risk on every trade', ALL.map(x => ({ ...x, riskMult: 1.25 }))],
    r15: ['Control: 1.5% risk on every trade', ALL.map(x => ({ ...x, riskMult: 1.5 }))],
};
const polRes = {};
for (const [k, [label, list]] of Object.entries(POL)) {
    polRes[k] = { label, all: st(list), recent: st(list.filter(x => x.year >= 2023)), acct: accounts(list) };
    lap(`policy ${k}`);
}
// Robustness for the strongest split: avg R by year, leading (>= 80) vs the rest.
const yearSplit = {};
for (const y of STUDY_YEARS) {
    const l = known.filter(x => x.year === y);
    yearSplit[y] = { lead: st(l.filter(x => x.grp.indRank >= 80)), rest: st(l.filter(x => x.grp.indRank < 80)) };
}

// ---------- report ----------
const f1 = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '-';
const sg2 = (v, d = 2) => Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '-';
const rowB = (b) => `| ${b.label} | ${b.all.n} | ${f1(b.all.win)}% | ${sg2(b.all.avgR)} ± ${f1(b.all.se, 2)} | ${b.h1.n} / ${sg2(b.h1.avgR)} | ${b.h2.n} / ${sg2(b.h2.avgR)} | ${b.recent.n} / ${sg2(b.recent.avgR)} |`;
const hdrB = ['| Bucket | Trades | Win | Avg R ± se | 2007-16 n / R | 2017-26 n / R | 2023-26 n / R |', '|---|---|---|---|---|---|---|'];
const M2 = [
    '# Group / theme study (2026-10-27)', '',
    `Generated by \`research/group-study.mjs\`. Trades: the live F7 rules (${ALL.length} trades 2007-2026, all four families, earnings-session / gap-limit / deal-pin skips applied), live stop and exit (${COMBO}).`,
    `Industry classification: Nasdaq screener (${new Set(Object.values(IND).map(x => x.industry)).size} industries, 12 sectors), today's classification applied to history. Industry known for ${known.length} of ${ALL.length} trades (unknown: ${B.unknown.n} trades, avg R ${sg2(B.unknown.avgR)}).`,
    'Group rank = percentile of the industry\'s mean member RS rank across industries with >= 4 liquid members, on the setup day (100 = strongest). Leaders = other members with RS rank >= 90 that day.', '',
    '## 1. Trade results by group strength on the setup day', '',
    '### Industry rank (mean member RS)', '', ...hdrB, ...B.indRank.map(rowB), '',
    '### Industry rank (median 3-month return)', '', ...hdrB, ...B.ind63.map(rowB), '',
    '### Sector rank (12 sectors)', '', ...hdrB, ...B.secRank.map(rowB), '',
    '### Other RS-90 leaders in the same industry', '', ...hdrB, ...B.lead.map(rowB), '',
    '### Share of the industry\'s members at RS 90+', '', ...hdrB, ...B.leadShare.map(rowB), '',
    '## 2. Were the Model Book leaders in leading groups?', '',
    `Book leaders with data: ${bookStats.n}. Industry rank on the day their best 3-month run started:`, '',
    '| | Book leaders | Our trades (setup day) |', '|---|---|---|',
    `| Median industry rank | ${f1(bookStats.medRank, 0)} | ${f1(tradeShare.medRank, 0)} |`,
    `| In top 20% industries | ${f1(bookStats.top20, 0)}% | ${f1(tradeShare.top20, 0)}% |`,
    `| In top 40% industries | ${f1(bookStats.top40, 0)}% | ${f1(tradeShare.top40, 0)}% |`,
    `| In bottom 40% industries | ${f1(bookStats.bottom40, 0)}% | ${f1(tradeShare.bottom40, 0)}% |`,
    `| >= 2 other RS-90 leaders in the industry | ${f1(bookStats.lead2, 0)}% | ${f1(tradeShare.lead2, 0)}% |`, '',
    '<details><summary>Book leaders</summary>', '', '| Ticker | Year | Run start | +3m | Industry | Ind. rank | Leaders |', '|---|---|---|---|---|---|---|',
    ...bookRows.map(r => `| ${r.ticker} | ${r.year} | ${r.date} | +${r.fwd63}% | ${r.ind} | ${r.indRank} | ${r.lead} |`), '', '</details>', '',
    '## 3. Policies: filter vs conviction (account, 1% base risk, positions <= 25%)', '',
    '| Policy | Trades | Avg R | 2023-26 n / R | CAGR random p10 / med / p90 | Med max DD | RS order + idle SPY CAGR / DD | 2007-16 / 2017-26 | 2023-26 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...Object.values(polRes).map(p => `| ${p.label} | ${p.all.n} | ${sg2(p.all.avgR, 3)} | ${p.recent.n} / ${sg2(p.recent.avgR)} | ${f1(p.acct.mc.p10)} / ${f1(p.acct.mc.med)} / ${f1(p.acct.mc.p90)}% | ${f1(p.acct.mc.dd)}% | ${f1(p.acct.rsSpy.cagr)}% / ${f1(p.acct.rsSpy.dd)}% | ${f1(p.acct.h1)} / ${f1(p.acct.h2)}% | ${f1(p.acct.r23Spy.cagr)}% |`), '',
    '## 4. By year: leading industries (rank >= 80) vs the rest', '',
    '| Year | Leading n / avg R | Rest n / avg R |', '|---|---|---|',
    ...STUDY_YEARS.map(y => `| ${y} | ${yearSplit[y].lead.n} / ${sg2(yearSplit[y].lead.avgR)} | ${yearSplit[y].rest.n} / ${sg2(yearSplit[y].rest.avgR)} |`), '',
];
fs.writeFileSync(OUT2_MD, M2.join('\n') + '\n');
fs.writeFileSync(OUT2_JSON, JSON.stringify({ generated: new Date().toISOString(), buckets: B, book: { stats: bookStats, trades: tradeShare, rows: bookRows }, policies: polRes, yearSplit }, null, 1));
lap(`wrote ${OUT2_MD}`);
console.log(M2.join('\n'));
