// EODHD helpers for the research data fetch (delisted stocks).

// EODHD prices are unadjusted; convert to Yahoo's convention (split-adjusted
// OHLCV + split events) so the rest of the pipeline treats both the same.
export function eodToYahoo(rows, splitRows) {
    const splits = (splitRows || []).map(s => {
        const [a, b] = String(s.split).split('/').map(Number);
        return { date: s.date, ratio: a / b };
    }).filter(s => s.ratio > 0 && Number.isFinite(s.ratio)).sort((x, y) => (x.date < y.date ? -1 : 1));
    const bars = [];
    for (const r of rows) {
        if (![r.open, r.high, r.low, r.close, r.volume].every(Number.isFinite)) continue;
        let f = 1;
        for (const s of splits) if (r.date < s.date) f *= s.ratio;
        bars.push({ date: r.date, open: r.open / f, high: r.high / f, low: r.low / f, close: r.close / f, volume: r.volume * f });
    }
    return { bars, splits };
}
