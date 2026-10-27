// Industry / sector per ticker from Nasdaq's stock screener (one request,
// every NASDAQ/NYSE/AMEX listing) -> research/data/industries.json.
//   node research/fetch-industries.mjs
// Classification is today's (not point-in-time); companies rarely change
// industry, and delisted tickers are missing from the research data anyway.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(process.env.RESEARCH_DATA || path.join(HERE, 'data'), 'industries.json');
const res = await fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true', {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', Accept: 'application/json, text/plain, */*' },
});
if (!res.ok) throw new Error(`Nasdaq HTTP ${res.status}`);
const rows = (await res.json())?.data?.rows || [];
const tickers = {};
for (const r of rows) {
    const t = String(r.symbol || '').trim().replace('/', '-').replace('^', '-P');
    if (!t || !r.industry) continue;
    tickers[t] = { industry: r.industry.trim(), sector: (r.sector || '').trim(), cap: Number(r.marketCap) || null };
}
fs.writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), source: 'api.nasdaq.com screener', tickers }));
console.log(`${Object.keys(tickers).length} tickers, ${new Set(Object.values(tickers).map(x => x.industry)).size} industries, ${new Set(Object.values(tickers).map(x => x.sector)).size} sectors -> ${OUT}`);
