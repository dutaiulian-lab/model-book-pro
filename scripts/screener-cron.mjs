import fs from 'fs';
import path from 'path';

// Fetch the ENTIRE US MARKET dynamically
async function fetchAllUSTickers() {
    try {
        console.log("Downloading the master list of all US Market Tickers...");
        const res = await fetch("https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/all/all_tickers.txt");
        const text = await res.text();
        const tickers = text.split('\n')
            .map(t => t.trim())
            .filter(t => t.length > 0 && !t.includes('-') && !t.includes('.') && !t.endsWith('W') && !t.endsWith('U')); 
        // Filter out warrants (W), units (U), and preferred shares (-) to stick to common stock
        console.log(`Successfully loaded ${tickers.length} master tickers.`);
        return tickers;
    } catch (e) {
        console.error("Failed to fetch master list, falling back to emergency list.", e);
        return ["AAPL", "MSFT", "NVDA", "SPCX", "CRCL"];
    }
}

async function fetchYahooData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.chart.result) return null;
    
    const result = json.chart.result[0];
    const quotes = result.indicators.quote[0];
    
    let validData = [];
    if (!quotes.close) return null;
    
    for(let i = 0; i < quotes.close.length; i++) {
        if(quotes.close[i] !== null && quotes.low[i] !== null && quotes.volume[i] !== null) {
            validData.push({ 
                close: quotes.close[i], 
                low: quotes.low[i],
                high: quotes.high[i],
                volume: quotes.volume[i] 
            });
        }
    }
    
    return {
      history: validData,
      meta: result.meta
    };
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

function calculatePerformance(data, daysAgo) {
    if (data.length <= daysAgo) return null;
    const pastPrice = data[data.length - 1 - daysAgo].close;
    const currentPrice = data[data.length - 1].close;
    return ((currentPrice - pastPrice) / pastPrice) * 100;
}


async function sendDiscordAlert(matches) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook || matches.length === 0) return;

    const embeds = matches.slice(0, 10).map(m => ({
        title: `🎯 APEX SETUP: ${m.ticker}`,
        url: `https://www.tradingview.com/chart/?symbol=${m.ticker}`,
        color: 0x10b981,
        description: "Perfect 21-EMA Pullback + Relative Strength + Institutional Demand",
        fields: [
            { name: "Daily Close", value: `${m.price.toFixed(2)}`, inline: true },
            { name: "21-EMA Support", value: `${m.ema21.toFixed(2)}`, inline: true },
            { name: "Base Depth", value: m.base_depth, inline: true },
            { name: "3-Mo RS vs SPY", value: `+${m.relative_strength_3mo.toFixed(1)}%`, inline: true },
            { name: "Volatility (ADR)", value: `${m.adr.toFixed(1)}%`, inline: true }
        ],
        footer: { text: "Model Book Pro · Apex Screener" }
    }));

    try {
        await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: `🚨 **APEX Setups Detected (${matches.length} found)** 🚨\nMonitor the Dashboard for Realtime Intraday Proximity!`,
                embeds
            })
        });
    } catch (e) {}
}

async function run() {
    console.log(`Fetching S&P 500 Market Benchmark (SPY)...`);
    const spyDataResult = await fetchYahooData('SPY');
    if (!spyDataResult || spyDataResult.history.length < 125) {
        console.error("Failed to fetch SPY benchmark. Aborting.");
        return;
    }
    const spyData = spyDataResult.history;
    const spy3mo = calculatePerformance(spyData, 63); 

    const tickers = await fetchAllUSTickers();
    console.log(`Starting WHOLE MARKET Apex Scan on ${tickers.length} tickers... This may take a few minutes.`);
    const matches = [];

    // Increase batch size to 20 for speed, but add a slight delay to prevent Yahoo IP bans
    const batchSize = 20;
    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch = tickers.slice(i, i + batchSize);
        if (i % 500 === 0) {
            console.log(`Scanning progress: ${i} / ${tickers.length}...`);
        }
        
        await Promise.all(batch.map(async (ticker) => {
            const result = await fetchYahooData(ticker);
            if (result && result.history.length > 200) {
                const data = result.history;
                const meta = result.meta;
                
                const current = data[data.length - 1];
                
                // PENNY STOCK / ILLIQUID FILTER (Model Book standard: Price > $5, Vol > 100k)
                if (current.close < 5.0 || current.volume < 100000) return;

                const sma50 = calculateSMA(data, 50, 'close');
                const sma150 = calculateSMA(data, 150, 'close');
                const sma200 = calculateSMA(data, 200, 'close');
                const ema21 = calculateEMA(data, 21);
                
                const old200SMAData = data.slice(0, data.length - 20);
                const sma200_20days_ago = calculateSMA(old200SMAData, 200, 'close');

                const volSma20 = calculateSMA(data, 20, 'volume');
                const volSma50 = calculateSMA(data, 50, 'volume');

                // 1. Minervini Trend Template (ULTRA STRICT)
                const trendUp = (
                    current.close > sma50 &&
                    sma50 > sma150 &&
                    sma150 > sma200 &&
                    sma200 > sma200_20days_ago 
                );
                
                // 2. Base Depth Filter
                const high52 = meta.fiftyTwoWeekHigh || Math.max(...data.slice(-252).map(d => d.high));
                const distanceFromHigh = ((high52 - current.close) / high52) * 100;
                const isShallowBase = distanceFromHigh <= 15.0; 
                
                // 3. 21-EMA Proximity & Respect 
                const distanceTo21 = Math.abs((current.low - ema21) / ema21);
                const touching21 = distanceTo21 <= 0.02; 
                const closedAbove21 = current.close >= ema21; 
                
                // 4. Volume Contraction 
                const lowVolume = current.volume < volSma20 && current.volume < volSma50;
                
                // 5. VCP Tightness (Daily Range Contraction)
                const todayRange = current.high - current.low;
                const avgRange = data.slice(-10).reduce((sum, d) => sum + (d.high - d.low), 0) / 10;
                const isTight = todayRange <= avgRange; 

                // 6. RELATIVE STRENGTH (RS)
                const stock3mo = calculatePerformance(data, 63);
                const outperforming = stock3mo > (Math.max(spy3mo, 0) * 1.5) && stock3mo > 10; 

                // 7. ADR% (Average Daily Range)
                const adr = (data.slice(-20).reduce((sum, d) => sum + ((d.high - d.low) / d.close), 0) / 20) * 100;
                const goodVolatility = adr >= 2.0 && adr <= 8.0;

                // 8. INSTITUTIONAL DEMAND
                let hasInstitutionalDemand = false;
                for (let j = data.length - 15; j < data.length; j++) {
                    const prevClose = data[j-1].close;
                    const dayVolume = data[j].volume;
                    const dailyVolAvg = calculateSMA(data.slice(0, j), 50, 'volume');
                    if (data[j].close > prevClose && dayVolume > (dailyVolAvg * 1.5)) {
                        hasInstitutionalDemand = true;
                        break;
                    }
                }

                if (trendUp && isShallowBase && touching21 && closedAbove21 && lowVolume && isTight && outperforming && goodVolatility && hasInstitutionalDemand) {
                    matches.push({
                        ticker,
                        price: current.close,
                        ema21: ema21,
                        base_depth: `-${distanceFromHigh.toFixed(1)}%`,
                        adr: adr,
                        relative_strength_3mo: stock3mo - spy3mo,
                        vol_status: "Whole Market Elite"
                    });
                }
            }
        }));
        
        // 200ms delay between batches of 20 to prevent rate limiting across 6000 requests
        await new Promise(r => setTimeout(r, 200));
    }

    const output = {
        timestamp: new Date().toISOString(),
        total_scanned: tickers.length,
        matches
    };

    const outPath = path.join(process.cwd(), 'public', 'market-state.json');
    if (!fs.existsSync(path.dirname(outPath))) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
    }
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Saved results to public/market-state.json. Found ${matches.length} matches across the ENTIRE market.`);

    if (matches.length > 0) {
        await sendDiscordAlert(matches);
    }
}

run();
