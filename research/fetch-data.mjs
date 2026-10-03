// Research data cache: daily bars from 2005-01-01 for every current US ticker
// (plus the Model Book tickers) that ever met a loose liquidity floor ($5 price,
// $10M 20-day average dollar volume). Float32 to keep it compact.
//
//   node research/fetch-data.mjs            -> research/data/cache.bin
//
// Survivorship: Yahoo only serves tickers that still trade, so stocks that were
// delisted (bankrupt, acquired, taken private) are missing and the backtest is
// biased. If EODHD_API_KEY is set (any paid eodhd.com plan includes delisted
// US stocks), the delisted NYSE/Nasdaq/AMEX common stocks are fetched from
// EODHD and merged in. Without it the re-study reports a survivorship stress
// test instead (research/restudy.mjs).
import fs from 'fs';
import v8 from 'v8';
import path from 'path';
import { eodToYahoo } from './eodhd.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.RESEARCH_DATA || path.join(HERE, 'data');
const { fetchAllUSTickers } = await import(path.join(HERE, '../scripts/lib/universe.mjs'));
const OUT = path.join(DATA, 'cache.bin');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const START = '2005-01-01';
const P1 = Math.floor(Date.parse(START) / 1000);
const P2 = Math.floor(Date.now() / 1000);
fs.mkdirSync(DATA, { recursive: true });

async function fetchBars(ticker, attempts = 4) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${P1}&period2=${P2}&interval=1d&events=split`;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            if (!res.ok) return null;
            const data = (await res.json()).chart?.result?.[0];
            const ts = data?.timestamp;
            if (!ts?.length) return null;
            const q = data.indicators.quote[0];
            const bars = [];
            for (let j = 0; j < ts.length; j++) {
                if (q.close[j] != null && q.volume[j] != null && q.high[j] != null && q.low[j] != null && q.open[j] != null) {
                    bars.push({ date: new Date(ts[j] * 1000).toISOString().slice(0, 10), open: q.open[j], high: q.high[j], low: q.low[j], close: q.close[j], volume: q.volume[j] });
                }
            }
            const splits = Object.values(data.events?.splits || {}).map(e => ({ date: new Date(e.date * 1000).toISOString().slice(0, 10), ratio: e.numerator / e.denominator })).filter(e => e.ratio > 0 && Number.isFinite(e.ratio));
            return { bars, meta: data.meta, splits };
        } catch (e) {
            if (i === attempts - 1) return { error: String(e) };
            await sleep(1500 * 2 ** i);
        }
    }
    return null;
}

// ---------- EODHD (delisted stocks) ----------
const EOD_KEY = process.env.EODHD_API_KEY;
async function eodJson(url, attempts = 4) {
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url);
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            if (i === attempts - 1) return null;
            await sleep(2000 * 2 ** i);
        }
    }
    return null;
}
const spyRes = await fetchBars('SPY');
const dates = spyRes.bars.map(b => b.date);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const pack = (bars, meta, splits = []) => {
    const keep = bars.filter(b => dateIdx.has(b.date) && b.open > 0 && b.high >= b.low);
    return {
        i: Int32Array.from(keep.map(b => dateIdx.get(b.date))),
        o: Float32Array.from(keep.map(b => b.open)),
        h: Float32Array.from(keep.map(b => b.high)),
        l: Float32Array.from(keep.map(b => b.low)),
        c: Float32Array.from(keep.map(b => b.close)),
        v: Float32Array.from(keep.map(b => b.volume)),
        firstTrade: meta?.firstTradeDate ?? null,
        type: meta?.instrumentType ?? null,
        splits,
    };
};
// Ever liquid: raw price >= $5 with 20-day average dollar volume >= $10M.
const everLiquid = (p) => {
    let vsum = 0;
    for (let k = 0; k < p.c.length; k++) {
        vsum += p.v[k];
        if (k >= 20) vsum -= p.v[k - 20];
        if (k >= 19 && p.c[k] >= 5 && (vsum / 20) * p.c[k] >= 10e6) return true;
    }
    return false;
};

// Model Book tickers (some renamed: SQ -> XYZ, FB -> META).
const BOOK = ['NVDA', 'GEV', 'APP', 'TSLA', 'NIO', 'SHOP', 'UBER', 'TTD', 'AMD', 'PLTR', 'PTON', 'ROKU', 'TDOC', 'RBLX', 'FSLR', 'DOCU', 'ASTS', 'CAVA', 'WGS', 'NNOX', 'ELF', 'VKTX', 'NFLX', 'PANW', 'CROX', 'XYZ', 'GOOGL', 'PYPL', 'GOOS', 'SEDG', 'ETSY', 'CHGG', 'MDGL', 'ANAB', 'NKTR', 'EXAS', 'TLRY', 'CYBR', 'OKTA', 'TWLO', 'MDB', 'GSHD', 'INSP', 'INMD', 'SE', 'ARWR', 'PLMR', 'ARVN', 'ZS', 'ZM', 'FVRR', 'FSLY', 'SNAP', 'NET', 'CELH', 'MSTR', 'CRWD', 'ENPH', 'DQ', 'ZG', 'MELI', 'PINS', 'SPCE', 'BEAM', 'ASAN', 'ZIM', 'GME', 'AMC', 'CAR', 'UPST', 'PRTA', 'CUBI', 'BNTX', 'MRNA', 'DVN', 'STNG', 'TMDX', 'AMR', 'OXY', 'LNTH', 'CEG', 'SMCI', 'COIN', 'VRT', 'VST', 'ARM', 'META', 'ANF', 'RDDT', 'ALAB', 'VITL', 'GGAL', 'HOOD', 'EAT', 'SOUN', 'OKLO', 'RKLB', 'SN', 'RBRK', 'IBIT'];
const tickers = [...new Set([...(await fetchAllUSTickers()), ...BOOK])];
const out = { dates, spy: pack(spyRes.bars, spyRes.meta), tickers: {}, sources: { yahoo: 0, eodhdDelisted: 0 } };
let failed = 0, kept = 0, empty = 0;
const failedList = [];
const t0 = Date.now();
for (let i = 0; i < tickers.length; i += 20) {
    if (i % 1000 === 0) console.log(`${i}/${tickers.length} kept ${kept} empty ${empty} failed ${failed} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    await Promise.all(tickers.slice(i, i + 20).map(async (t) => {
        const res = await fetchBars(t);
        if (!res) { empty++; return; }
        if (res.error) { failed++; failedList.push(t); return; }
        const p = pack(res.bars, res.meta, res.splits);
        if (BOOK.includes(t) || everLiquid(p)) { out.tickers[t] = p; kept++; }
    }));
    await sleep(200);
}
out.sources.yahoo = kept;
if (failed > tickers.length * 0.1) {
    console.error(`Aborting: ${failed} of ${tickers.length} Yahoo fetches failed.`);
    process.exit(1);
}

if (EOD_KEY) {
    console.log('EODHD_API_KEY set: fetching delisted US common stocks...');
    const list = await eodJson(`https://eodhd.com/api/exchange-symbol-list/US?delisted=1&fmt=json&api_token=${EOD_KEY}`);
    if (!Array.isArray(list)) {
        console.error('::warning::EODHD delisted list unavailable; continuing without delisted stocks.');
    } else {
        const codes = list.filter(x => x.Type === 'Common Stock' && !/OTC|PINK|GREY|NMFQS|EXPM/i.test(x.Exchange || ''))
            .map(x => x.Code).filter(c => c && !c.includes('.') && !c.includes('-'));
        console.log(`EODHD: ${codes.length} delisted NYSE/Nasdaq/AMEX common stocks`);
        let added = 0, done = 0;
        for (let i = 0; i < codes.length; i += 8) {
            await Promise.all(codes.slice(i, i + 8).map(async (code) => {
                const rows = await eodJson(`https://eodhd.com/api/eod/${encodeURIComponent(code)}.US?from=${START}&fmt=json&api_token=${EOD_KEY}`);
                done++;
                if (!Array.isArray(rows) || rows.length < 60) return;
                const sp = await eodJson(`https://eodhd.com/api/splits/${encodeURIComponent(code)}.US?from=${START}&fmt=json&api_token=${EOD_KEY}`);
                const { bars, splits } = eodToYahoo(rows, Array.isArray(sp) ? sp : []);
                const p = pack(bars, { instrumentType: 'EQUITY' }, splits);
                if (p.c.length < 60 || !everLiquid(p)) return;
                // A delisted symbol may since have been reused by another company.
                let key = code;
                for (let n = 1; out.tickers[key]; n++) key = `${code}.D${n}`;
                p.delisted = true;
                out.tickers[key] = p; added++;
            }));
            if (i % 800 === 0) console.log(`EODHD ${done}/${codes.length}, added ${added}`);
        }
        out.sources.eodhdDelisted = added;
        console.log(`EODHD: added ${added} delisted stocks that were ever liquid`);
    }
}
out.failedList = failedList;
fs.writeFileSync(OUT, v8.serialize(out));
console.log(`done: ${dates.length} sessions ${dates[0]}..${dates[dates.length - 1]}, kept ${kept} (+${out.sources.eodhdDelisted} delisted), empty ${empty}, failed ${failed}, ${(fs.statSync(OUT).size / 1e6).toFixed(0)} MB, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
