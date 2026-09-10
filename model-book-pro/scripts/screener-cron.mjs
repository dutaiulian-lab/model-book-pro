import fs from 'fs';
import path from 'path';

// Top liquid growth / tech stocks to scan
const TICKERS = [
  "NVDA", "APP", "PLTR", "GEV", "CRWD", "TSLA", "META", "CELH", "SMCI", 
  "AMD", "UBER", "SHOP", "SQ", "CAVA", "ASTS", "HOOD", "COIN", "MSTR", "TTD",
  "AAPL", "MSFT", "AMZN", "GOOGL", "NFLX", "SNOW", "DDOG", "NET", "PANW",
  "NOW", "CRM", "AVGO", "QCOM", "ARM", "MU", "INTC", "TSM", "ASML", "LRCX"
];

async function fetchYahooData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json.chart.result[0];
    const quotes = result.indicators.quote[0];
    const closes = quotes.close;
    const lows = quotes.low;
    const volumes = quotes.volume;
    
    let validData = [];
    for(let i = 0; i < closes.length; i++) {
        if(closes[i] !== null && lows[i] !== null && volumes[i] !== null) {
            validData.push({ close: closes[i], low: lows[i], volume: volumes[i] });
        }
    }
    return validData;
  } catch (e) {
    return null;
  }
}

function calculateSMA(data, period, key) {
    if(data.length < period) return null;
    let sum = 0;
    for(let i = data.length - period; i < data.length; i++) sum += data[i][key];
    return sum / period;
}

function calculateEMA(data, period) {
    if(data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data[0].close;
    for (let i = 1; i < data.length; i++) ema = (data[i].close - ema) * k + ema;
    return ema;
}

async function sendDiscordAlert(matches) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) return;
    
    if (matches.length === 0) return; // Only alert if setups found

    const embeds = matches.map(m => ({
        title: `🎯 MODEL BOOK SETUP: ${m.ticker}`,
        url: `https://www.tradingview.com/chart/?symbol=${m.ticker}`,
        color: 0x10b981, // Emerald green
        description: "A perfect 21-EMA Pullback / Volatility Contraction pattern triggered today.",
        fields: [
            { name: "Price", value: `$${m.price.toFixed(2)}`, inline: true },
            { name: "21-EMA Proximity", value: m.distance_pct, inline: true },
            { name: "Volume Status", value: m.vol_status, inline: true }
        ],
        footer: { text: "Model Book Pro · Automated Scanner" }
    }));

    try {
        await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: `🚨 **Institutional Setups Detected for Tomorrow's Open** 🚨`,
                embeds
            })
        });
    } catch (e) {
        console.error("Discord webhook failed", e);
    }
}

async function run() {
    console.log(`Starting Market Scan on ${TICKERS.length} tickers...`);
    const matches = [];

    // Parallel fetch with simple concurrency limit to avoid Yahoo rate limits
    for (let i = 0; i < TICKERS.length; i++) {
        const ticker = TICKERS[i];
        console.log(`Scanning ${ticker}...`);
        const data = await fetchYahooData(ticker);
        
        if (data && data.length > 200) {
            const current = data[data.length - 1];
            const sma50 = calculateSMA(data, 50, 'close');
            const sma200 = calculateSMA(data, 200, 'close');
            const ema21 = calculateEMA(data, 21);
            const volSma20 = calculateSMA(data, 20, 'volume');

            const trendUp = current.close > sma50 && sma50 > sma200;
            const distanceTo21 = Math.abs((current.low - ema21) / ema21);
            const touching21 = distanceTo21 <= 0.03; 
            const lowVolume = current.volume < volSma20;

            if (trendUp && touching21 && lowVolume) {
                matches.push({
                    ticker,
                    price: current.close,
                    distance_pct: `${(distanceTo21 * 100).toFixed(2)}%`,
                    vol_status: "Below 20d Average"
                });
            }
        }
        
        // Small delay to be polite to Yahoo
        await new Promise(r => setTimeout(r, 200));
    }

    const output = {
        timestamp: new Date().toISOString(),
        total_scanned: TICKERS.length,
        matches
    };

    // Save to public folder for React app
    const outPath = path.join(process.cwd(), 'public', 'market-state.json');
    if (!fs.existsSync(path.dirname(outPath))) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
    }
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log("Saved results to public/market-state.json");

    // Send Discord alerts
    if (matches.length > 0) {
        await sendDiscordAlert(matches);
        console.log("Discord alerts fired.");
    }
}

run();
