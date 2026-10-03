// Live price lookup for the dashboard. Returns { SYMBOL: price, ... }.
const SYMBOL_RE = /^[A-Z0-9.^=-]{1,12}$/;
const MAX_SYMBOLS = 50;

export default async function handler(req, res) {
  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const symbols = [...new Set(
    raw.split(',').map(s => s.trim().toUpperCase()).filter(s => SYMBOL_RE.test(s))
  )].slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    return res.status(400).json({ error: `Symbols parameter is required (comma-separated, max ${MAX_SYMBOLS})` });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=1m`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) {
      return res.status(502).json({ error: `Upstream quote request failed (${response.status})` });
    }
    const data = await response.json();

    const prices = {};
    if (data.spark && data.spark.result) {
      data.spark.result.forEach(r => {
        const px = r.response?.[0]?.meta?.regularMarketPrice;
        if (typeof px === 'number') prices[r.symbol] = px;
      });
      res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=59");
      return res.status(200).json(prices);
    }
    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
