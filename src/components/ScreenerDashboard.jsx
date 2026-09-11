import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, BarChart3, Crosshair, Clock, ShieldCheck, Zap , ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

export default function ScreenerDashboard() {
  const [expandedCards, setExpandedCards] = useState({});
  const [copied, setCopied] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const copyTickers = () => {
    if (!data || !data.matches) return;
    const tickerString = data.matches.map(m => m.ticker).join(',');
    navigator.clipboard.writeText(tickerString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const toggleCard = (ticker) => setExpandedCards(prev => ({...prev, [ticker]: !prev[ticker]}));

  const triggerScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/trigger-scan', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) {
        alert("Failed to trigger scan: " + result.error);
      } else {
        alert("Scan triggered successfully! The background job will take a few minutes to complete. The page will auto-refresh when new data is available (if you reload in a few minutes).");
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
    setIsScanning(false);
  };

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Store live prices fetched from Yahoo Finance directly in the browser
  const [livePrices, setLivePrices] = useState({});

  useEffect(() => {
    fetch(`/market-state.json?t=${Date.now()}`)
      .then(res => res.json())
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError("Failed to load screener data. Ensure the GitHub Action has run.");
        setLoading(false);
      });
  }, []);

  // Real-time loop
  useEffect(() => {
    if (!data || !data.matches || data.matches.length === 0) return;

    let isMounted = true;
    const fetchLivePrices = async () => {
      const tickers = data.matches.map(m => m.ticker).join(',');
      try {
        // We use yahoo finance API directly from the browser. 
        // Route through our Vercel Serverless Function to avoid CORS and Rate Limits
        const url = `/api/quote?symbols=${tickers}`;
        const res = await fetch(url);
        const newPrices = await res.json();
        
        if (isMounted && Object.keys(newPrices).length > 0) {
            setLivePrices(newPrices);
        }
      } catch (err) {
        console.warn("Live pricing fetch failed, falling back to static closing prices.");
      }
    };

    fetchLivePrices();
    
    // Smart Polling: Only fetch when the app is actually visible on the screen
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchLivePrices();
      }
    }, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [data]);

  if (loading) {
    return <div className="text-center p-12 text-muted-foreground animate-pulse font-mono tracking-widest text-xs">INITIALIZING ENGINE...</div>;
  }
  if (error) {
    return <div className="text-center p-12 text-rose-500 font-mono bg-rose-500/10 rounded-xl border border-rose-500/20">{error}</div>;
  }

  const { timestamp, total_scanned, matches } = data;

  return (
    <div className="flex flex-col gap-6">
      
      {/* HUD Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="text-muted-foreground text-xs font-black uppercase tracking-wider mb-2 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5"/> Universe</div>
          <div className="text-2xl font-black text-foreground">{total_scanned} <span className="text-sm font-medium text-muted-foreground tracking-normal">tickers</span></div>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="text-primary text-xs font-black uppercase tracking-wider mb-2 flex items-center gap-1.5"><Target className="w-3.5 h-3.5"/> Top Setups</div>
          <div className="text-2xl font-black text-primary">{matches.length}</div>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm col-span-2">
          <div className="text-muted-foreground text-xs font-black uppercase tracking-wider mb-2 flex items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Last Daily Scan</span>
            <button 
              onClick={triggerScan} 
              disabled={isScanning}
              className="bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1 rounded-md text-[10px] tracking-wider transition-colors disabled:opacity-50"
            >
              {isScanning ? 'TRIGGERING...' : 'SCAN NOW'}
            </button>
          </div>
          <div className="text-sm font-mono text-foreground mt-1">{new Date(timestamp).toLocaleString()}</div>
        </div>
      </div>

      {/* MATCHES LIST */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-4 mb-2">
        <h2 className="text-lg font-black tracking-wide text-foreground flex items-center gap-2">
            <Crosshair className="text-amber-500 w-5 h-5" /> 
            Actionable 'Model Book' Setups
        </h2>
        <div className="flex items-center gap-3">
          <button onClick={copyTickers} className="flex items-center gap-1.5 text-xs font-bold text-foreground bg-secondary/80 hover:bg-secondary px-3 py-1.5 rounded-full border border-border/80 transition-all shadow-sm">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
            {copied ? <span className="text-emerald-500">Copied!</span> : <span>Copy for TradingView</span>}
          </button>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-full animate-pulse border border-emerald-500/20">
              <Zap className="w-3 h-3 fill-emerald-500" /> Live
          </div>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-2xl bg-card/30">
          <p className="text-muted-foreground font-medium">No strict Model Book setups met the criteria across the market today.</p>
          <p className="text-xs text-muted-foreground/60 mt-2">Cash is a position. Wait for the pitch.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          
          {(() => {
            const sortedMatches = [...matches].sort((a, b) => {
              const priceA = livePrices[a.ticker] || a.price;
              const priceB = livePrices[b.ticker] || b.price;
              const distA = Math.abs((priceA - a.ema21) / a.ema21);
              const distB = Math.abs((priceB - b.ema21) / b.ema21);
              return distA - distB;
            });
            return sortedMatches.map((match, idx) => {

            // Use live price if available, else fallback to the scanned closing price
            const currentPrice = livePrices[match.ticker] || match.price;
            
            // Recalculate proximity to 21-EMA in real-time
            const ema21 = match.ema21;
            const distanceRaw = ((currentPrice - ema21) / ema21) * 100;
            const distanceAbs = Math.abs(distanceRaw);
            const isBelowEMA = currentPrice < ema21;
            
            let proximityColor = "text-amber-500 bg-amber-500/10";
            if (isBelowEMA) proximityColor = "text-rose-500 bg-rose-500/10"; // Trapped below
            else if (distanceAbs < 1.0) proximityColor = "text-emerald-500 bg-emerald-500/10"; // Extremely tight

            return (
              <div key={idx} className="bg-card border border-border/80 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-primary/50 transition-all flex flex-col">
                
                
                <div className="flex justify-between items-start mb-0 cursor-pointer" onClick={() => toggleCard(match.ticker)}>
                  <div>
                    <h3 className="text-2xl font-black text-foreground tracking-tight">{match.ticker}</h3>
                    <div className="flex items-end gap-2 mt-1">
                        <div className="text-2xl font-mono text-foreground">${currentPrice.toFixed(2)}</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground pb-1">Live</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <a href={`https://www.tradingview.com/chart/?symbol=${match.ticker}`} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors text-[10px] font-black uppercase px-3 py-1.5 rounded-full tracking-wider">
                      Chart ↗
                    </a>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      {expandedCards[match.ticker] ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5"/>}
                    </button>
                  </div>
                </div>

                {expandedCards[match.ticker] && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-3 mt-4 border-t border-border/50 pt-4 flex-1">

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-4 h-4"/> Macro Trend</span>
                    <span className="text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[11px] uppercase tracking-wider">Confirmed</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-4 h-4"/> 21-EMA Line</span>
                    <span className="text-muted-foreground font-mono bg-muted/30 px-2 py-0.5 rounded text-xs">${ema21.toFixed(2)}</span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Zap className="w-4 h-4"/> Live Proximity</span>
                    <span className={`font-bold px-2 py-0.5 rounded text-xs ${proximityColor}`}>
                        {distanceAbs.toFixed(2)}% {isBelowEMA ? 'Below' : 'Above'}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5"><BarChart3 className="w-4 h-4"/> Daily Volume</span>
                    <span className="text-primary font-bold bg-primary/10 px-2 py-0.5 rounded text-xs">{match.vol_status}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-3">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-4 h-4"/> Base Depth</span>
                    <span className="text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-xs">{match.base_depth}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-4 h-4"/> 3-Mo RS vs SPY</span>
                    <span className="text-blue-500 font-bold bg-blue-500/10 px-2 py-0.5 rounded text-xs">+{match.relative_strength_3mo?.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Zap className="w-4 h-4"/> Volatility (ADR)</span>
                    <span className="text-purple-500 font-bold bg-purple-500/10 px-2 py-0.5 rounded text-xs">{match.adr?.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><BarChart3 className="w-4 h-4"/> EPS Growth (YoY)</span>
                    <span className="text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-xs">+{((match.eps_growth || 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-4 h-4"/> Sales Growth (YoY)</span>
                    <span className="text-blue-500 font-bold bg-blue-500/10 px-2 py-0.5 rounded text-xs">+{((match.rev_growth || 0) * 100).toFixed(1)}%</span>
                  </div>
                </div>

                <div className="mt-5 p-3 rounded-xl bg-muted/20 border border-border/50 shrink-0">
                  <div className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1 mb-1.5">
                    <ShieldCheck className="w-3 h-3" /> Trading Plan
                  </div>
                  <p className="text-[11px] text-foreground/80 leading-relaxed">
                    Set entry trigger slightly above yesterday's high. Set hard stop-loss at exactly <strong>${ema21.toFixed(2)}</strong>.
                  </p>
                </div>
                  </div>
                )}

              </div>
            );
            });
          })()}
        </div>
      )}

    </div>
  );
}
