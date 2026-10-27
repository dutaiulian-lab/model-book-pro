// Earnings dates for the F7 entry rule (no fill on an earnings-reaction
// session) and for the dashboard cards.
//
//   secEarnings(ticker)       past releases from SEC EDGAR: every 8-K with Item
//                             2.02 (the earnings press release), with the
//                             acceptance time -> [{ date, amc }]. Same source as
//                             the study (research/fetch-earnings.mjs). Foreign
//                             filers (6-K) have none.
//   upcomingEarnings(ticker)  the next scheduled release: Yahoo calendarEvents
//                             (passed in, or fetched), falling back to Nasdaq's
//                             earnings-date API -> { date, amc, source } | null.
//
// amc: true = after the close (the market reacts the next session), false =
// before the open or during the session (reacts that session), null = unknown.
import YahooFinance from 'yahoo-finance2';

const UA = process.env.SEC_UA || 'ModelBookPro screener duta.iulian@gmail.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ET = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
// Calendar date and HHMM in New York for a Date.
export function nyTime(d) {
    const g = Object.fromEntries(ET.formatToParts(d).map(p => [p.type, p.value]));
    return { date: `${g.year}-${g.month}-${g.day}`, hm: (Number(g.hour) % 24) * 100 + Number(g.minute) };
}

// SEC allows 10 requests/s; stay well below it across concurrent callers.
let nextSlot = 0;
async function secGet(url, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        const wait = nextSlot - Date.now();
        nextSlot = Math.max(Date.now(), nextSlot) + 150;
        if (wait > 0) await sleep(wait);
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (res.status === 404) return null;
            if (res.ok) return await res.json();
        } catch (e) {
            // network error: retry
        }
        await sleep(1000 * 2 ** i);
    }
    throw new Error(`SEC request failed: ${url}`);
}

let cikMap = null;
async function cikOf(ticker) {
    if (!cikMap) {
        const j = await secGet('https://www.sec.gov/files/company_tickers.json');
        cikMap = new Map(Object.values(j || {}).map(x => [String(x.ticker).toUpperCase(), x.cik_str]));
    }
    return cikMap.get(ticker.toUpperCase().replace('.', '-')) ?? null;
}

function extract(f, out, since) {
    for (let i = 0; i < f.form.length; i++) {
        if (f.form[i] !== '8-K') continue;
        if (!String(f.items?.[i] || '').split(',').includes('2.02')) continue;
        if (f.filingDate[i] < since) continue;
        const acc = f.acceptanceDateTime?.[i];
        if (acc) {
            const t = nyTime(new Date(acc));
            out.push({ date: t.date, amc: t.hm >= 1600 });
        } else out.push({ date: f.filingDate[i], amc: null });
    }
}

// Past earnings releases since `since` (YYYY-MM-DD), oldest first. [] when the
// company has no SEC earnings filings; throws when SEC cannot be reached.
const secCache = new Map();
export async function secEarnings(ticker, since = '2005-01-01') {
    const key = `${ticker}|${since}`;
    if (secCache.has(key)) return secCache.get(key);
    const p = (async () => {
        const cik = await cikOf(ticker);
        if (!cik) return [];
        const sub = await secGet(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`);
        if (!sub) return [];
        const out = [];
        extract(sub.filings.recent, out, since);
        for (const fl of sub.filings.files || []) {
            if (fl.filingTo < since) continue;
            const more = await secGet(`https://data.sec.gov/submissions/${fl.name}`);
            if (more) extract(more, out, since);
        }
        const seen = new Set();
        return out.filter(e => !seen.has(e.date) && seen.add(e.date)).sort((a, b) => a.date.localeCompare(b.date));
    })();
    secCache.set(key, p);
    try { return await p; } catch (e) { secCache.delete(key); throw e; }
}

// Merge earnings event lists (dedupe by date; a known time wins over null).
export function mergeEarnings(...lists) {
    const by = new Map();
    for (const l of lists) for (const e of l || []) {
        if (!e?.date) continue;
        const prev = by.get(e.date);
        if (!prev || (prev.amc == null && e.amc != null)) by.set(e.date, { date: e.date, amc: e.amc ?? null });
    }
    return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

let yf = null;
async function yahooNext(ticker, summary) {
    if (!summary) {
        yf ||= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
        summary = await yf.quoteSummary(ticker, { modules: ['calendarEvents'] }, { validateResult: false });
    }
    const e = summary?.calendarEvents?.earnings;
    const d0 = e?.earningsDate?.[0];
    if (!d0) return null;
    const t = nyTime(new Date(d0));
    // Yahoo uses a midnight-UTC stamp (20:00 ET the day before) when the time is
    // unknown; a range of two dates means the date itself is an estimate.
    const midnightUtc = new Date(d0).getUTCHours() === 0 && new Date(d0).getUTCMinutes() === 0;
    if (midnightUtc) return { date: new Date(d0).toISOString().slice(0, 10), amc: null, estimate: !!e.isEarningsDateEstimate, source: 'yahoo' };
    return { date: t.date, amc: t.hm >= 1600 ? true : t.hm < 930 ? false : null, estimate: !!e.isEarningsDateEstimate, source: 'yahoo' };
}

async function nasdaqNext(ticker) {
    const res = await fetch(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(ticker)}/earnings-date`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', Accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok) throw new Error(`Nasdaq HTTP ${res.status}`);
    const txt = (await res.json())?.data?.reportText || '';
    const m = txt.match(/on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(after market close|before market open)?/i);
    if (!m) return null;
    const date = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const when = (m[4] || '').toLowerCase();
    return { date, amc: when.startsWith('after') ? true : when.startsWith('before') ? false : null, estimate: /expected\*/.test(txt), source: 'nasdaq' };
}

// Next scheduled earnings on or after `today`; null when none is known.
// Throws only when every source failed.
export async function upcomingEarnings(ticker, today, { summary = null } = {}) {
    const errors = [];
    for (const src of [() => yahooNext(ticker, summary), () => nasdaqNext(ticker)]) {
        for (let i = 0; i < 2; i++) {
            try {
                const r = await src();
                if (r && r.date >= today) return r;
                break; // answered, but nothing upcoming: try the next source
            } catch (e) {
                errors.push(String(e.message || e).slice(0, 120));
                await sleep(1500 * (i + 1));
            }
        }
        summary = null;
    }
    if (errors.length >= 4) throw new Error(errors.join(' | '));
    return null;
}
