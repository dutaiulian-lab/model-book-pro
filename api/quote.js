export default async function handler(req, res) {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'Symbols parameter is required (comma-separated)' });
  
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols}&range=1d&interval=1m`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    const data = await response.json();
    
    const prices = {};
    if (data.spark && data.spark.result) {
        data.spark.result.forEach(r => {
            if (r.response && r.response[0] && r.response[0].meta) {
                prices[r.symbol] = r.response[0].meta.regularMarketPrice;
            }
        });
        return res.status(200).json(prices);
    }
    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
