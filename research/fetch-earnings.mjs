// Historical earnings-release dates from SEC EDGAR (2026-10-27).
//
//   node research/fetch-earnings.mjs [TICKER ...]   -> research/data/earnings.json
//
// Source: every 8-K with Item 2.02 ("Results of Operations and Financial
// Condition"), i.e. the earnings press release, back to 2003 when the item was
// introduced. The acceptance timestamp tells when the market could react:
// accepted at/after 16:00 ET -> next session; otherwise the same session.
// Foreign private issuers (20-F / 6-K filers) and delisted names are not
// covered; the study reports coverage.
// Tickers: the arguments, or every ticker with a setup near the live filters
// in research/data/events.bin.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.RESEARCH_DATA || path.join(HERE, 'data');
const OUT = path.join(DATA, 'earnings.json');
const UA = process.env.SEC_UA || 'ModelBookPro research contact@example.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 4) {
    for (let i = 0; ; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (res.status === 404) return null;
            if (res.ok) return await res.json();
            if (i >= tries - 1) throw new Error(`${url}: HTTP ${res.status}`);
        } catch (e) {
            if (i >= tries - 1) throw e;
        }
        await sleep(1000 * 2 ** i);
    }
}

let tickers = process.argv.slice(2);
if (!tickers.length) {
    const { T, C, N } = await import('./lib.mjs');
    const set = new Set();
    for (let r = 0; r < N; r++) {
        if (C.rs[r] >= 85 && C.dvPct[r] >= 60 && C.dv[r] >= 5 && C.upLow52[r] >= 80) set.add(T.tickers[C.tid[r]]);
    }
    tickers = [...set].sort();
}
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { tickers: {} };
const map = await get('https://www.sec.gov/files/company_tickers.json');
const cikOf = new Map(Object.values(map).map(x => [x.ticker.toUpperCase(), x.cik_str]));
console.log(`${tickers.length} tickers, ${tickers.filter(t => cikOf.has(t.replace('.', '-'))).length} with a CIK`);

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function extract(f, out) {
    const n = f.form.length;
    for (let i = 0; i < n; i++) {
        if (!(f.form[i] === '8-K' || f.form[i] === '8-K/A')) continue;
        if (!String(f.items?.[i] || '').split(',').includes('2.02')) continue;
        const acc = f.acceptanceDateTime?.[i];
        let et = null;
        if (acc) {
            const g = Object.fromEntries(fmt.formatToParts(new Date(acc)).map(p => [p.type, p.value]));
            et = { date: `${g.year}-${g.month}-${g.day}`, hm: (Number(g.hour) % 24) * 100 + Number(g.minute) };
        }
        out.push({ filed: f.filingDate[i], date: et?.date ?? f.filingDate[i], hm: et?.hm ?? null, amend: f.form[i] === '8-K/A' ? 1 : 0 });
    }
}

let done = 0, covered = 0;
for (const t of tickers) {
    if (prev.tickers[t]) { done++; if (prev.tickers[t].ev?.length) covered++; continue; }
    const cik = cikOf.get(t.replace('.', '-'));
    if (!cik) { prev.tickers[t] = { cik: null, ev: [] }; done++; continue; }
    const pad = String(cik).padStart(10, '0');
    const sub = await get(`https://data.sec.gov/submissions/CIK${pad}.json`);
    await sleep(120);
    const ev = [];
    if (sub) {
        extract(sub.filings.recent, ev);
        for (const fl of sub.filings.files || []) {
            if (fl.filingTo < '2005-01-01') continue;
            const more = await get(`https://data.sec.gov/submissions/${fl.name}`);
            await sleep(120);
            if (more) extract(more, ev);
        }
    }
    ev.sort((a, b) => a.date.localeCompare(b.date));
    prev.tickers[t] = { cik, name: sub?.name ?? null, foreign: sub ? !sub.filings.recent.form.some(f => f === '10-Q' || f === '10-K') : null, ev };
    if (ev.length) covered++;
    if (++done % 100 === 0) {
        console.log(`${done}/${tickers.length} (${covered} with earnings dates)`);
        fs.writeFileSync(OUT, JSON.stringify(prev));
    }
}
prev.generated_at = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(prev));
console.log(`done: ${done} tickers, ${covered} with earnings dates -> ${OUT}`);
