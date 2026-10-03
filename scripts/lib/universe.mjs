// US equity universe for the screener and backfill.

export async function fetchAllUSTickers() {
    try {
        console.log("Downloading the master list of all US Market Tickers...");
        const res = await fetch("https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/all/all_tickers.txt");
        const text = await res.text();
        const tickers = text.split('\n')
            .map(t => t.trim())
            .filter(t => t.length > 0 && !t.includes('-') && !t.includes('.'))
            // Nasdaq marks warrants/units/rights with a 5th letter W/U/R. Only
            // strip those; a bare endsWith('W'/'U') also dropped MU, NOW, SNOW...
            .filter(t => !(t.length === 5 && /[WUR]$/.test(t)));
        console.log(`Successfully loaded ${tickers.length} master tickers.`);
        return tickers;
    } catch (e) {
        return ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "PLTR", "APP", "MSTR", "HOOD", "CAVA", "VST", "UBER"];
    }
}
