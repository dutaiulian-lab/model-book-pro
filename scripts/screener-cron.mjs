import fs from 'fs';
import path from 'path';

const TICKERS = [...new Set([
  "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A","APD","ABNB","AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL","GOOG","MO","AMZN","AMCR","AEE","AAL","AEP","AXP","AIG","AMT","AWK","AMP","AME","AMGN","APH","ADI","ANSS","AON","APA","AAPL","AMAT","APTV","ACGL","ADM","ANET","AJG","AIZ","T","ATO","ADSK","ADP","AZO","AVB","AVY","AXON","BKR","BALL","BAC","BK","BBWI","BAX","BDX","BRK-B","BBY","BIO","TECH","BIIB","BLK","BX","BA","BKNG","BWA","BXP","BSX","BMY","AVGO","BR","BRO","BF-B","BG","CHRW","CDNS","CZR","CPT","CPB","COF","CAH","KMX","CCL","CARR","CTLT","CAT","CBOE","CBRE","CDW","CE","COR","CNC","CNP","CF","CHTR","CVX","CMG","CB","CHD","CI","CINF","CTAS","CSCO","C","CFG","CLX","CME","CMS","KO","CTSH","CL","CMCSA","CMA","CAG","COP","ED","STZ","CEG","COO","CPRT","GLW","CTVA","CSGP","COST","CTRA","CCI","CSX","CMI","CVS","DHR","DRI","DVA","DE","DAL","XRAY","DVN","DXCM","FANG","DLR","DFS","DG","DLTR","D","DPZ","DOV","DOW","DHI","DTE","DUK","DD","EMN","ETN","EBAY","ECL","EIX","EW","EA","ELV","LLY","EMR","ENPH","ETR","EOG","EPAM","EQT","EFX","EQIX","EQR","ESS","EL","ETSY","EG","EVRG","ES","EXC","EXPE","EXPD","EXR","XOM","FFIV","FDS","FICO","FAST","FRT","FDX","FIS","FITB","FSLR","FE","FI","FLT","FMC","F","FTNT","FTV","FOXA","FOX","BEN","FCX","GRMN","IT","GEHC","GEN","GNRC","GD","GE","GIS","GM","GPC","GILD","GPN","GL","GS","HAL","HIG","HAS","HCA","PEAK","HSIC","HSY","HES","HPE","HLT","HOLX","HD","HON","HRL","HST","HWM","HPQ","HUBB","HUM","HBAN","HII","IBM","IEX","IDXX","ITW","ILMN","INCY","IR","PODD","INTC","ICE","IFF","IP","IPG","INTU","ISRG","IVZ","INVH","IQV","IRM","JBHT","JBL","JKHY","J","JNJ","JCI","JPM","JNPR","K","KVUE","KDP","KEY","KEYS","KMB","KIM","KMI","KLAC","KHC","KR","LHX","LH","LRCX","LW","LVS","LDOS","LEN","LIN","LYV","LKQ","LMT","L","LOW","LULU","LYB","MTB","MRO","MPC","MKTX","MAR","MMC","MLM","MAS","MA","MTCH","MKC","MCD","MCK","MDT","MRK","META","MET","MTD","MGM","MCHP","MU","MSFT","MAA","MRNA","MHK","MOH","TAP","MDLZ","MPWR","MNST","MCO","MS","MOS","MSI","MSCI","NDAQ","NTAP","NFLX","NEM","NWSA","NWS","NEE","NKE","NI","NDSN","NSC","NTRS","NOC","NCLH","NRG","NUE","NVDA","NVR","NXPI","ORLY","OXY","ODFL","OMC","ON","OKE","ORCL","OTIS","PCAR","PKG","PANW","PARA","PH","PAYX","PAYC","PYPL","PNR","PEP","PFE","PCG","PM","PSX","PNW","PXD","PNC","POOL","PPG","PPL","PFG","PG","PGR","PLD","PRU","PEG","PTC","PSA","PHM","QRVO","PWR","QCOM","DGX","RL","RJF","RTX","O","REG","REGN","RF","RSG","RMD","RVTY","RHI","ROK","ROL","ROP","ROST","RCL","SPGI","CRM","SBAC","SLB","STX","SEE","SRE","NOW","SHW","SPG","SWKS","SJM","SNA","SO","LUV","SWK","SBUX","STT","STLD","STE","SYK","SYF","SNPS","SYY","TMUS","TROW","TTWO","TPR","TRGP","TGT","TEL","TDY","TFX","TER","TSLA","TXN","TXT","TMO","TJX","TSCO","TT","TDG","TRV","TRMB","TFC","TYL","TSN","USB","UDR","ULTA","UNP","UAL","UPS","URI","UNH","UHS","VLO","VTR","VLTO","VRSN","VRSK","VZ","VRTX","VFC","VTRS","VICI","V","VMC","WRB","WAB","WBA","WMT","DIS","WBD","WM","WAT","WEC","WFC","WELL","WST","WDC","WRK","WY","WHR","WMB","WTW","GWW","WYNN","XEL","XYL","YUM","ZBRA","ZBH","ZION","ZTS",
  "APP", "PLTR", "GEV", "CRWD", "CELH", "SMCI", "SHOP", "SQ", 
  "CAVA", "ASTS", "HOOD", "COIN", "MSTR", "TTD", "SNOW", "DDOG", 
  "NET", "ARM", "TSM", "ASML", "LULU", "MELI", "PDD", "ABNB"
])].filter(t => t.length > 0);

async function fetchYahooData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json.chart.result[0];
    const quotes = result.indicators.quote[0];
    
    let validData = [];
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

async function sendDiscordAlert(matches) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook || matches.length === 0) return;

    const embeds = matches.slice(0, 10).map(m => ({
        title: `🎯 MODEL BOOK SETUP: ${m.ticker}`,
        url: `https://www.tradingview.com/chart/?symbol=${m.ticker}`,
        color: 0x10b981,
        description: "A perfect 21-EMA Pullback / Volatility Contraction pattern triggered today.",
        fields: [
            { name: "Daily Close", value: `$${m.price.toFixed(2)}`, inline: true },
            { name: "21-EMA Support", value: `$${m.ema21.toFixed(2)}`, inline: true },
            { name: "Base Depth", value: m.base_depth, inline: true }
        ],
        footer: { text: "Model Book Pro · Strict Setup Scanner" }
    }));

    try {
        await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: `🚨 **Institutional Setups Detected for Tomorrow's Open (${matches.length} found)** 🚨\nMonitor the Dashboard for Realtime Intraday Proximity!`,
                embeds
            })
        });
    } catch (e) {}
}

async function run() {
    const tickers = TICKERS;
    console.log(`Starting Advanced Strict Market Scan on ${tickers.length} tickers...`);
    const matches = [];

    const batchSize = 10;
    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch = tickers.slice(i, i + batchSize);
        console.log(`Scanning batch ${i / batchSize + 1} / ${Math.ceil(tickers.length / batchSize)}...`);
        
        await Promise.all(batch.map(async (ticker) => {
            const result = await fetchYahooData(ticker);
            if (result && result.history.length > 200) {
                const data = result.history;
                const meta = result.meta;
                
                const current = data[data.length - 1];
                const sma50 = calculateSMA(data, 50, 'close');
                const sma200 = calculateSMA(data, 200, 'close');
                const ema21 = calculateEMA(data, 21);
                const volSma20 = calculateSMA(data, 20, 'volume');

                // 1. Core Trend
                const trendUp = current.close > sma50 && sma50 > sma200;
                
                // 2. Base Depth Filter: Must be within 25% of 52-week high (Minervini/Moglen style shallow base)
                const high52 = meta.fiftyTwoWeekHigh || Math.max(...data.slice(-252).map(d => d.high));
                const distanceFromHigh = ((high52 - current.close) / high52) * 100;
                const isShallowBase = distanceFromHigh <= 25; // Never buy a broken chart down 50%
                
                // 3. 21-EMA Proximity
                const distanceTo21 = Math.abs((current.low - ema21) / ema21);
                const touching21 = distanceTo21 <= 0.03; 
                
                // 4. Volume Contraction
                const lowVolume = current.volume < volSma20;
                
                // 5. VCP Tightness (Daily Range Contraction)
                // The range (High - Low) of today should be smaller than the average range of the last 10 days
                const todayRange = current.high - current.low;
                const avgRange = data.slice(-10).reduce((sum, d) => sum + (d.high - d.low), 0) / 10;
                const isTight = todayRange <= (avgRange * 1.1); // Not expanding wildly

                if (trendUp && isShallowBase && touching21 && lowVolume && isTight) {
                    matches.push({
                        ticker,
                        price: current.close,
                        ema21: ema21,
                        base_depth: `-${distanceFromHigh.toFixed(1)}%`,
                        vol_status: "Below 20d Avg & Tight Range"
                    });
                }
            }
        }));
        
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
    console.log(`Saved results to public/market-state.json. Found ${matches.length} matches.`);

    if (matches.length > 0) {
        await sendDiscordAlert(matches);
    }
}

run();
