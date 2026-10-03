// Yearly re-study of the Model Book leader rules.
//
//   node research/restudy.mjs [--fetch] [--apply] [--year=YYYY] [--skip-build]
//
// 1. data:   research/data/cache.bin (Yahoo, + delisted stocks from EODHD when
//            EODHD_API_KEY is set); fetched when missing or with --fetch.
// 2. events: every setup of every family 2006+, with features and the trade
//            outcome for every stop x exit combination (build-events.mjs).
// 3. grid:   per family set, per candidate filter, per exit, per year stats.
// 4. select: the pre-registered walk-forward procedure (select.mjs) for each
//            year 2010..YEAR, restricted to what the live screener implements.
//            The pick for YEAR (trained on all data before YEAR) is the proposal.
// 5. report: research/reports/restudy-<date>.md / .json: out-of-sample record
//            of the procedure vs SPY, current vs proposed rules, every family
//            (including separately tracked ones), and survivorship.
// 6. --apply: writes the proposal to scripts/lib/rules.json when it differs.
//            The yearly GitHub workflow opens a pull request with the result;
//            nothing changes in production until that PR is merged.
import fs from 'fs';
import os from 'os';
import v8 from 'v8';
import path from 'path';
import { spawn } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(HERE, '..');
const DATA = process.env.RESEARCH_DATA || path.join(HERE, 'data');
const RULES_PATH = path.join(REPO, 'scripts/lib/rules.json');
const REPORTS = path.join(HERE, 'reports');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k) => argv.find(a => a.startsWith(`${k}=`))?.split('=')[1];
const now = new Date();
const TODAY = now.toISOString().slice(0, 10);
// Run in January: the pick for this year. Run later in the year: for next year.
const YEAR = Number(opt('--year')) || now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0);
const FIRST_TEST_YEAR = 2010;
const NODE_ARGS = ['--max-old-space-size=12000'];
const CONC = Math.max(1, Math.min(os.cpus().length, Math.floor(os.totalmem() / 5e9)));
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(REPORTS, { recursive: true });

function run(script, args = [], env = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [...NODE_ARGS, path.join(HERE, script), ...args], {
            stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, RESEARCH_DATA: DATA, ...env },
        });
        p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${script} ${args.join(' ')} exited with ${code}`))));
    });
}
async function pool(items, n, fn) {
    const queue = [...items];
    await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
        while (queue.length) await fn(queue.shift());
    }));
}
const t0 = Date.now();
const lap = (msg) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] ${msg}`);

// ---------- 1-4: pipeline ----------
if (flag('--fetch') || !fs.existsSync(path.join(DATA, 'cache.bin'))) { lap('fetching data'); await run('fetch-data.mjs'); }
const { LIVE_FAMSETS, LIVE_FAMILIES, FAMSETS } = await import('./grid.mjs');
if (!flag('--skip-build')) {
    lap('building events'); await run('build-events.mjs');
    lap(`grid for ${LIVE_FAMSETS.length} family sets (${CONC} parallel)`);
    await pool(LIVE_FAMSETS, CONC, fi => run('grid.mjs', [String(fi)]));
    const years = []; for (let y = FIRST_TEST_YEAR; y <= YEAR; y++) years.push(y);
    lap(`walk-forward selection ${FIRST_TEST_YEAR}..${YEAR}`);
    await pool(years, CONC, y => run('select.mjs', [String(y)], { TAG: 'live' }));
}

// ---------- 5: analysis ----------
lap('analysis');
const L = await import('./lib.mjs');
const { T, C, N, mask, yearly, summarize, portfolio, simulatePortfolio, tradesFor, recall, BOOK, spyYear, YEARS, comboIdx, idleReturns, yearSpan } = L;
const { toRules } = await import('./select.mjs');
const cache = v8.deserialize(fs.readFileSync(path.join(DATA, 'cache.bin')));
const current = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
const sel = {};
for (let y = FIRST_TEST_YEAR; y <= YEAR; y++) sel[y] = JSON.parse(fs.readFileSync(path.join(DATA, `select_live_${y}.json`), 'utf8'));
const lastDate = T.dates[T.dates.length - 1];
const lastYear = Number(lastDate.slice(0, 4));
const f1 = (x) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(1));
const f2 = (x) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(2));
const sgn = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}`);

// Rules (rules.json shape) -> research spec + exit combo.
const specOf = (r, fams = r.families) => ({
    fams, liveOnly: 1, rawPriceMin: r.priceMin ?? 10, rsMin: r.rsMin, regime: r.regime, dvMin: r.dvMinM,
    dvPctMin: r.dvPctMin, upLow52Min: r.upLow52Min, depth52Max: r.depth52Max ?? Infinity,
});
const comboOf = (r) => `${r.stop}|${r.exit}`;
const STUDY_YEARS = YEARS.filter(y => y >= 2007);
const recentYears = (k) => STUDY_YEARS.filter(y => y > lastYear - k);

function dropTop(m, combo, frac) {
    const ci = comboIdx[combo];
    const rows = [];
    for (let r = 0; r < N; r++) if (m[r] && !Number.isNaN(T.R[ci][r])) rows.push(r);
    rows.sort((a, b) => T.R[ci][b] - T.R[ci][a]);
    const m2 = Uint8Array.from(m);
    for (const r of rows.slice(0, Math.ceil(rows.length * frac))) m2[r] = 0;
    return m2;
}
function mc(trades, seeds = 40) {
    const c = [], dd = [];
    for (let i = 0; i < seeds; i++) {
        const p = simulatePortfolio(trades.map(t => ({ ...t, key: Math.random() })));
        c.push(p.cagr); dd.push(p.maxDD);
    }
    c.sort((a, b) => a - b); dd.sort((a, b) => a - b);
    const q = (a, f) => a[Math.floor(f * (a.length - 1))];
    return { p10: q(c, 0.1), med: q(c, 0.5), p90: q(c, 0.9), dd: q(dd, 0.5) };
}
function evaluate(rules, fams = rules.families) {
    const spec = specOf(rules, fams), combo = comboOf(rules);
    const m = mask(spec);
    const by = yearly(m, combo);
    const s = summarize(by, STUDY_YEARS);
    const active = STUDY_YEARS.filter(y => by[y]);
    const pos = active.filter(y => by[y].sumR > 0).length;
    const r3 = summarize(by, recentYears(3));
    const d1 = summarize(yearly(dropTop(m, combo, 0.01), combo), STUDY_YEARS);
    return { spec, combo, m, by, s, pos, active: active.length, r3, d1 };
}
function evaluateFull(rules) {
    const e = evaluate(rules);
    e.mc = mc(tradesFor(e.m, e.combo, '2007'));
    e.pf = portfolio(e.m, e.combo, '2007');
    e.book = recall(e.m, e.combo, BOOK);
    return e;
}

// Out-of-sample record of the procedure.
const oos = [];
let eq = 1, spyEq = 1, peak = 1, ddMax = 0;
for (let y = FIRST_TEST_YEAR; y < YEAR && y <= lastYear; y++) {
    const r = sel[y].oos.ret, sp = spyYear[y] ?? 0;
    eq *= 1 + r / 100; spyEq *= 1 + sp / 100; peak = Math.max(peak, eq); ddMax = Math.max(ddMax, 1 - eq / peak);
    oos.push({ year: y, ret: r, spy: sp, trades: sel[y].oos.taken, pick: sel[y].pick, partial: y === lastYear && lastDate < `${y}-12-31` });
}
const nY = oos.length;
const oosCagr = (eq ** (1 / nY) - 1) * 100, spyCagr = (spyEq ** (1 / nY) - 1) * 100;
const last5 = oos.slice(-5);
const cagrOf = (rows, k) => (rows.reduce((a, r) => a * (1 + r[k] / 100), 1) ** (1 / rows.length) - 1) * 100;

// Idle cash in SPY (rules.json idleCash). The same out-of-sample picks, with
// idle cash earning SPY under the rule: conservative (SPY sold at the prior
// close to fund a fill) and optimistic (at the fill-day close). Daily drawdowns
// are on realized equity chained across years.
const IDLE_CFG = current.idleCash?.mode && current.idleCash.mode !== 'none' ? current.idleCash : { mode: 'spy200band', band: 3 };
const idleRet = idleReturns(IDLE_CFG);
function oosChain(opts) {
    let e = 1, pk = 1, dd = 0;
    const rows = [];
    for (const r of oos) {
        const s = sel[r.year];
        const spec = { ...s.spec, depth52Max: s.spec.depth52Max ?? Infinity };
        const p = simulatePortfolio(tradesFor(mask(spec), s.combo, `${r.year}-01-01`, `${r.year}-12-31`), { ...opts, span: yearSpan(r.year) });
        for (const v of p.curve) { const q = e * v / 100; pk = Math.max(pk, q); dd = Math.max(dd, 1 - q / pk); }
        const ret = (p.final / 100 - 1) * 100;
        e *= 1 + ret / 100;
        rows.push({ year: r.year, ret, in_setups: p.inSetups, in_spy: p.inSpy });
    }
    return { rows, cagr: (e ** (1 / rows.length) - 1) * 100, dailyDD: dd * 100, last5: cagrOf(rows.slice(-5), 'ret'), beat: rows.filter((x, i) => x.ret > oos[i].spy).length };
}
const idleOos = {
    cash: oosChain({}),
    spy: oosChain({ idleRet }),
    spyOpt: oosChain({ idleRet, preFill: true }),
};

// Proposal and comparison.
const pick = sel[YEAR];
const proposal = toRules(pick.fi, pick.cand, pick.combo);
const FIELDS = ['families', 'regime', 'rsMin', 'dvPctMin', 'dvMinM', 'priceMin', 'upLow52Min', 'depth52Max', 'stop', 'exit'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diffs = FIELDS.filter(k => !same(k === 'families' ? [...current[k]].sort() : current[k] ?? null, k === 'families' ? [...proposal[k]].sort() : proposal[k] ?? null));
const changed = diffs.length > 0;
const evCur = evaluateFull(current);
const evNew = changed ? evaluateFull(proposal) : evCur;

// Families under the proposed filters (incl. the ones not in the buy rules).
const famRows = LIVE_FAMILIES.map(f => {
    const e = evaluate(proposal, [f]);
    return { fam: f, inBuy: proposal.families.includes(f), ...e };
});
const notBuy = LIVE_FAMILIES.filter(f => !proposal.families.includes(f));
const famNote = (f) => {
    const r = famRows.find(x => x.fam === f);
    return `${f}: ${sgn(r.s.avgR, 2)}R per trade 2007-${lastYear} over ${r.s.n} trades (positive in ${r.pos} of ${r.active} years), ${sgn(r.r3.avgR, 2)}R over ${r.r3.n ?? 0} trades in the last 3 years`;
};

// ---------- survivorship ----------
const WB_FALLBACK = { 2005: 5145, 2006: 5133, 2007: 5109, 2008: 4666, 2009: 4401, 2010: 4279, 2011: 4171, 2012: 4102, 2013: 4180, 2014: 4369, 2015: 4381, 2016: 4331, 2017: 4336, 2018: 4013, 2019: 3910, 2020: 4104, 2021: 4774, 2022: 4642, 2023: 4317, 2024: 4010, 2025: 3908 };
let WB = WB_FALLBACK, wbSource = 'embedded copy of World Bank CM.MKT.LDOM.NO';
try {
    const res = await fetch('https://api.worldbank.org/v2/country/US/indicator/CM.MKT.LDOM.NO?format=json&per_page=80', { signal: AbortSignal.timeout(20000) });
    const rows = (await res.json())[1].filter(x => x.value);
    if (rows.length > 10) { WB = Object.fromEntries(rows.map(x => [x.date, x.value])); wbSource = 'World Bank API, CM.MKT.LDOM.NO'; }
} catch { /* keep fallback */ }
const alive = {};
let delistedInCache = 0;
for (const p of Object.values(cache.tickers)) {
    if (p.type && p.type !== 'EQUITY') continue;
    if (p.delisted) delistedInCache++;
    const ys = new Set();
    for (let k = 0; k < p.c.length; k++) ys.add(cache.dates[p.i[k]].slice(0, 4));
    for (const y of ys) alive[y] = (alive[y] || 0) + 1;
}
const wbYears = Object.keys(WB).map(Number).sort();
const covOf = (y) => {
    const ref = WB[y] ?? WB[wbYears[wbYears.length - 1]];
    return Math.min(1, (alive[y] || 0) / ref);
};
// Busts among the trades of a rule set: price <= 25% of the entry within 3 years.
function bustInfo(trades) {
    const out = [];
    for (const tr of trades) {
        const p = cache.tickers[T.tickers[tr.tid]];
        if (!p) continue;
        let lo = 0, hi = p.i.length - 1, k = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (p.i[mid] < tr.e) lo = mid + 1; else { k = mid; hi = mid - 1; } }
        if (k < 0) continue;
        const P = p.c[k];
        let mn = Infinity;
        for (let j = k; j < Math.min(p.c.length, k + 756); j++) mn = Math.min(mn, p.c[j]);
        out.push({ ...tr, bust: mn <= 0.25 * P });
    }
    return out;
}
function stress(ev) {
    const base = tradesFor(ev.m, ev.combo, '2007');
    const info = bustInfo(base);
    const busts = info.filter(t => t.bust);
    const ci = comboIdx[ev.combo];
    const meanR = (rows) => rows.reduce((a, t) => a + T.R[ci][t.r], 0) / (rows.length || 1);
    const byYear = {};
    for (const t of base) (byYear[T.dates[t.e].slice(0, 4)] ||= []).push(t);
    const scen = [];
    const mk = (name, short, q, outcome) => {
        let id = 1e7, extraN = 0, extraR = 0;
        const runs = [];
        for (let seed = 0; seed < 20; seed++) {
            const synth = [];
            for (const [y, list] of Object.entries(byYear)) {
                const cov = covOf(Number(y));
                const k = Math.round(list.length * q * (1 - cov) / Math.max(cov, 0.05));
                for (let i = 0; i < k; i++) {
                    const tpl = list[Math.floor(Math.random() * list.length)];
                    const o = outcome(tpl);
                    synth.push({ e: tpl.e, x: Math.min(T.dates.length - 1, tpl.e + o.hold), ret: o.ret, risk: tpl.risk, tid: id++, R: o.R });
                }
            }
            if (seed === 0) { extraN = synth.length; extraR = synth.reduce((a, t) => a + t.R, 0); }
            runs.push(synth);
        }
        const n0 = base.length, r0 = base.reduce((a, t) => a + T.R[ci][t.r], 0);
        const c = [], dd = [];
        for (const synth of runs) {
            const p = simulatePortfolio([...base, ...synth].map(t => ({ ...t, key: Math.random() })));
            c.push(p.cagr); dd.push(p.maxDD);
        }
        c.sort((a, b) => a - b); dd.sort((a, b) => a - b);
        scen.push({ name, short, added: extraN, avgR: (r0 + extraR) / (n0 + extraN), cagr: c[10], dd: dd[10] });
    };
    mk('As measured (survivors only)', 'as measured', 0, () => ({ hold: 1, ret: 0, R: 0 }));
    const bustOutcome = () => {
        const b = busts.length ? busts[Math.floor(Math.random() * busts.length)] : null;
        return b ? { hold: b.x - b.e, ret: T.ret[ci][b.r] * 1, R: T.R[ci][b.r] } : { hold: 10, ret: -5, R: -1 };
    };
    mk('Missing stocks trade like survivors that later busted (half as many setups)', 'bust-like x0.5', 0.5, bustOutcome);
    mk('Missing stocks trade like survivors that later busted (as many setups)', 'bust-like x1', 1, bustOutcome);
    mk('Extreme bound: every missing trade is a full stop-out (-1R)', 'all -1R', 1, (tpl) => ({ hold: 5, ret: -tpl.risk - 0.3, R: -1 - 0.3 / tpl.risk }));
    mk('Extreme bound: every missing trade gaps through its stop (-1.5R)', 'all -1.5R', 1, (tpl) => ({ hold: 5, ret: -1.5 * tpl.risk - 0.3, R: -1.5 - 0.3 / tpl.risk }));
    return { trades: base.length, busts: busts.length, bustR: meanR(busts), otherR: meanR(info.filter(t => !t.bust)), scen };
}
const stressNew = stress(evNew);
const stressCur = changed ? stress(evCur) : stressNew;

// ---------- report ----------
const rulesLine = (r) => [
    `families ${r.families.join('+')}`, `market ${r.regime}`, `RS ≥ ${r.rsMin}`,
    r.dvPctMin > 0 ? `liquidity top ${100 - r.dvPctMin}% and ≥ $${r.dvMinM}M` : `≥ $${r.dvMinM}M/day`,
    `≥ +${r.upLow52Min}% off 52w low`, r.depth52Max != null ? `≤ ${r.depth52Max}% off 52w high` : 'any depth',
    `stop ${r.stop}`, `exit ${r.exit}`,
].join(' · ');
const evRow = (name, e) => `| ${name} | ${e.s.n} | ${f1(e.s.win)}% | ${sgn(e.s.avgR, 3)} | ${f2(e.s.pf)} | ${e.pos}/${e.active} | ${sgn(e.d1.avgR, 3)} | ${sgn(e.r3.avgR, 2)} (${e.r3.n ?? 0}) | ${f1(e.mc.p10)} / ${f1(e.mc.med)} / ${f1(e.mc.p90)}% | ${f1(e.mc.dd)}% | ${f1(e.book.flagged)}% / ${f1(e.book.caught)}% |`;
const md = [];
md.push(`# Model Book rules: yearly re-study ${TODAY}`, '');
md.push(`Data ${T.dates[0]} to ${lastDate}: ${Object.keys(cache.tickers).length} stocks (${cache.sources?.yahoo ?? '?'} from Yahoo, ${cache.sources?.eodhdDelisted ?? 0} delisted from EODHD), ${N.toLocaleString()} setups.`);
md.push(`Selection: the pre-registered walk-forward procedure (research/select.mjs), restricted to family sets and options the live screener implements. Pick for **${YEAR}** is trained on all data before ${YEAR}.`, '');
md.push('## Decision', '');
if (changed) {
    md.push(`**The procedure proposes new rules for ${YEAR}** (changed: ${diffs.join(', ')}).`, '');
    md.push(`- Current (${current.version}): ${rulesLine(current)}`);
    md.push(`- Proposed: ${rulesLine(proposal)}`);
    md.push(`- Families not in the proposed buy rules are tracked separately: ${notBuy.join(', ') || 'none'}.`, '');
} else {
    md.push(`**No change.** The procedure's pick for ${YEAR} equals the current rules (${current.version}): ${rulesLine(current)}.`, '');
}
md.push('> The selection procedure itself is the thing being trusted here. Its record below is out of sample', `> (each year chosen only from earlier years). Merge the PR only if you accept that record.`, '');
md.push('## Out-of-sample record of the procedure', '');
md.push(`${FIRST_TEST_YEAR}-${oos[oos.length - 1].year}: **${f1(oosCagr)}%/yr** vs SPY ${f1(spyCagr)}%/yr (price only), worst year-end drawdown ${f1(ddMax * 100)}% (daily, realized: ${f1(idleOos.cash.dailyDD)}%). Last 5 years: ${f1(cagrOf(last5, 'ret'))}%/yr vs SPY ${f1(cagrOf(last5, 'spy'))}%/yr. Idle cash left in cash; see Idle cash in SPY below.`, '');
md.push('| Year | Procedure | SPY | Trades | Rules picked (trained on earlier years) |', '|---|---|---|---|---|');
for (const r of oos) md.push(`| ${r.year}${r.partial ? ' (YTD)' : ''} | ${sgn(r.ret)}% | ${sgn(r.spy)}% | ${r.trades} | ${r.pick} |`);
md.push('', `Pick for ${YEAR}: ${pick.pick} (training CAGR ${f1(pick.train.cagr)}%, max drawdown ${f1(pick.train.maxDD)}%).`, '');
md.push('## Idle cash in SPY', '');
md.push(`Rule (rules.json idleCash): ${IDLE_CFG.mode === 'always' ? 'idle cash always in SPY' : `idle cash in SPY while SPY is above its 200-day SMA, to cash below -${IDLE_CFG.band}%, back above +${IDLE_CFG.band}%`}. Same out-of-sample picks as above; daily max drawdown on realized equity.`, '');
md.push('| Idle cash | CAGR | Last 5 years | Daily max DD | Years ahead of SPY | Avg in setups / in SPY |', '|---|---|---|---|---|---|');
const avgOf = (rows, k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
for (const [name, o] of [['In cash', idleOos.cash], ['In SPY (conservative: SPY sold at the prior close)', idleOos.spy], ['In SPY (optimistic: SPY sold at the fill-day close)', idleOos.spyOpt]]) {
    md.push(`| ${name} | ${f1(o.cagr)}% | ${f1(o.last5)}% | ${f1(o.dailyDD)}% | ${o.beat}/${o.rows.length} | ${f1(avgOf(o.rows, 'in_setups'))}% / ${f1(avgOf(o.rows, 'in_spy'))}% |`);
}
md.push(`| SPY buy and hold (price) | ${f1(spyCagr)}% | ${f1(cagrOf(last5, 'spy'))}% | | | |`, '');
md.push('| Year | ' + oos.map(r => String(r.year)).join(' | ') + ' |', '|' + '---|'.repeat(oos.length + 1));
md.push('| Cash | ' + idleOos.cash.rows.map(r => sgn(r.ret)).join(' | ') + ' |');
md.push('| SPY (cons.) | ' + idleOos.spy.rows.map(r => sgn(r.ret)).join(' | ') + ' |', '');

md.push(`## Current vs proposed, 2007-${lastYear} (in sample)`, '');
md.push('| Rules | Trades | Win | Avg R | PF | Positive years | Avg R without top 1% | Last 3 years avg R (n) | Account CAGR p10 / median / p90 | Median max DD | Model Book leaders flagged / caught |', '|---|---|---|---|---|---|---|---|---|---|---|');
md.push(evRow(`Current ${current.version}`, evCur));
if (changed) md.push(evRow('Proposed', evNew));
md.push('', 'Account: 1% risk per trade, positions capped at 25%, one position per ticker, cash-limited, 40 random orderings of same-day signals; realized equity only (drawdowns understated).', '');
md.push(`## Every family under the ${changed ? 'proposed' : 'current'} filters`, '');
md.push('| Family | In buy rules | Trades | Win | Avg R | Positive years | Last 3 years avg R (n) |', '|---|---|---|---|---|---|---|');
for (const r of famRows) md.push(`| ${r.fam} | ${r.inBuy ? 'yes' : 'tracked separately'} | ${r.s.n ?? 0} | ${f1(r.s.win)}% | ${sgn(r.s.avgR, 3)} | ${r.pos}/${r.active} | ${sgn(r.r3.avgR, 2)} (${r.r3.n ?? 0}) |`);
md.push('', 'A family outside the buy rules comes back only through this procedure (it is in the search menu every year). Compare with its live tracked results on the Track Record tab.', '');
md.push('## Survivorship', '');
if ((cache.sources?.eodhdDelisted ?? 0) > 0) {
    md.push(`Delisted stocks are **included** (${cache.sources.eodhdDelisted} from EODHD). The stress test below is a residual check.`, '');
} else {
    md.push('Delisted stocks are **not included**: Yahoo only serves stocks that still trade, so bankruptcies, acquisitions and', 'take-privates are missing. Set the `EODHD_API_KEY` repository secret (any paid eodhd.com plan) to include them.', '');
}
md.push(`Coverage: stocks in the data alive each year vs US listed domestic companies (${wbSource}; the data also holds foreign ADRs, so coverage is overstated in recent years).`, '');
md.push('| ' + ['Year', ...STUDY_YEARS.filter(y => WB[y]).map(String)].join(' | ') + ' |', '|' + '---|'.repeat(STUDY_YEARS.filter(y => WB[y]).length + 1));
md.push('| Coverage | ' + STUDY_YEARS.filter(y => WB[y]).map(y => `${Math.round(covOf(y) * 100)}%`).join(' | ') + ' |', '');
md.push(`Among the ${stressNew.trades} trades of the ${changed ? 'proposed' : 'current'} rules, ${stressNew.busts} (${f1(stressNew.busts / stressNew.trades * 100)}%) were in stocks that later fell to 25% or less of the entry price within 3 years; those trades averaged ${sgn(stressNew.bustR, 2)}R vs ${sgn(stressNew.otherR, 2)}R for the rest (the exit rules usually get out before the collapse).`, '');
md.push('Stress test: add the trades the missing stocks might have produced (missing share per year from the coverage above; pessimistic, since most missing stocks were too small or illiquid to qualify) with the outcomes below.', '');
md.push('| Scenario | Trades added | Avg R | Account CAGR (median) | Median max DD |', '|---|---|---|---|---|');
for (const s of stressNew.scen) md.push(`| ${s.name} | ${s.added} | ${sgn(s.avgR, 3)} | ${f1(s.cagr)}% | ${f1(s.dd)}% |`);
if (changed) {
    md.push('', `Current rules under the same scenarios: ` + stressCur.scen.map(s => `${s.short}: ${sgn(s.avgR, 2)}R, ${f1(s.cagr)}%`).join('; ') + '.');
}
md.push('', '## Method and limits', '');
md.push('- Families: RANGE (launchpad coil), TIGHT, BASE, HTF; PEB / OOPS / GAP are studied but not implemented live, so not in the menu.');
md.push('- Grid per family set: run-up (0/50/100/200%), RS (0/80/90), liquidity ($20M, $50M, top 15%), market (none, SPY>50d, SPY>200d, breadth ≥ 50%), depth (25/35%/any) x 5 stops x 7 exits. 0.3% round-trip costs.');
md.push('- Procedure: top 150 candidates by a trade-level objective on the training years, then the best cash-limited account by CAGR - 0.5 x max drawdown.');
md.push('- In-sample tables flatter; trust the out-of-sample record. Results depend on a few big winners. Price-only rules (no point-in-time fundamentals).');
md.push('- After merging a rules change, the daily workflow re-runs the track-record backfill automatically (rules version changed).');
const reportBase = path.join(REPORTS, `restudy-${TODAY}`);
fs.writeFileSync(`${reportBase}.md`, md.join('\n') + '\n');
fs.writeFileSync(`${reportBase}.json`, JSON.stringify({
    date: TODAY, year: YEAR, data_to: lastDate, changed, diffs, current, proposal, pick: { pick: pick.pick, train: pick.train },
    oos: { rows: oos, cagr: oosCagr, spy_cagr: spyCagr, max_year_end_dd: ddMax * 100 },
    idle_cash: { rule: IDLE_CFG, cash: idleOos.cash, spy_conservative: idleOos.spy, spy_optimistic: idleOos.spyOpt },
    families: famRows.map(r => ({ fam: r.fam, in_buy: r.inBuy, n: r.s.n, avg_r: r.s.avgR, pos_years: r.pos, years: r.active, last3_avg_r: r.r3.avgR, last3_n: r.r3.n })),
    survivorship: { delisted_included: cache.sources?.eodhdDelisted ?? 0, coverage: Object.fromEntries(STUDY_YEARS.filter(y => WB[y]).map(y => [y, covOf(y)])), proposed: stressNew, current: stressCur },
}, null, 1));
lap(`report: ${path.relative(REPO, reportBase)}.md (changed: ${changed})`);

// ---------- 6: apply ----------
if (flag('--apply') && changed) {
    const next = {
        version: `${YEAR} (WF-P)`,
        adopted: TODAY,
        selected_by: `Yearly re-study ${TODAY}: walk-forward pick for ${YEAR} (research/reports/restudy-${TODAY}.md).`,
        families: proposal.families,
        trackFamilies: notBuy,
        trackNote: notBuy.length ? `under these filters in the ${TODAY} re-study, ${notBuy.map(famNote).join('; ')}.` : '',
        ...Object.fromEntries(FIELDS.filter(k => k !== 'families').map(k => [k, proposal[k]])),
        ...(current.idleCash ? { idleCash: current.idleCash, idleCashNote: current.idleCashNote } : {}),
    };
    fs.writeFileSync(RULES_PATH, JSON.stringify(next, null, 2) + '\n');
    lap(`wrote ${path.relative(REPO, RULES_PATH)} (${next.version})`);
}
if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nreport=research/reports/restudy-${TODAY}.md\nyear=${YEAR}\n`);
}
