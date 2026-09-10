import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, BarChart3, AlertTriangle, ShieldCheck, Crosshair, Clock } from 'lucide-react';

export default function ScreenerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/market-state.json')
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
          <div className="text-muted-foreground text-xs font-black uppercase tracking-wider mb-2 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5"/> Scanned</div>
          <div className="text-2xl font-black text-foreground">{total_scanned} <span className="text-sm font-medium text-muted-foreground tracking-normal">tickers</span></div>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="text-primary text-xs font-black uppercase tracking-wider mb-2 flex items-center gap-1.5"><Target className="w-3.5 h-3.5"/> Setups Found</div>
          <div className="text-2xl font-black text-primary">{matches.length}</div>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm col-span-2 md:col-span-2">
          <div className="text-muted-foreground text-xs font-black uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Last Engine Run</div>
          <div className="text-sm font-mono text-foreground mt-1">{new Date(timestamp).toLocaleString()}</div>
        </div>
      </div>

      {/* MATCHES LIST */}
      <h2 className="text-lg font-black tracking-wide text-foreground mt-4 mb-2 flex items-center gap-2">
        <Crosshair className="text-amber-500 w-5 h-5" /> 
        Actionable 'Model Book' Setups
      </h2>

      {matches.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-2xl bg-card/30">
          <p className="text-muted-foreground font-medium">No strict Model Book setups met the criteria today.</p>
          <p className="text-xs text-muted-foreground/60 mt-2">Cash is a position. Wait for the pitch.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {matches.map((match, idx) => (
            <div key={idx} className="bg-card border border-border/80 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-primary/50 transition-all">
              
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-2xl font-black text-foreground tracking-tight">{match.ticker}</h3>
                  <div className="text-xl text-muted-foreground mt-1">${match.price.toFixed(2)}</div>
                </div>
                <a href={`https://www.tradingview.com/chart/?symbol=${match.ticker}`} target="_blank" rel="noreferrer" className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors text-[10px] font-black uppercase px-3 py-1.5 rounded-full tracking-wider">
                  View Chart ↗
                </a>
              </div>

              <div className="space-y-3 mt-6 border-t border-border/50 pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-4 h-4"/> Macro Trend</span>
                  <span className="text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-xs">Confirmed Uptrend</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-4 h-4"/> Proximity to 21-EMA</span>
                  <span className="text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded text-xs">{match.distance_pct}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5"><BarChart3 className="w-4 h-4"/> Volume Dry-Up</span>
                  <span className="text-primary font-bold bg-primary/10 px-2 py-0.5 rounded text-xs">{match.vol_status}</span>
                </div>
              </div>

              <div className="mt-5 p-3 rounded-xl bg-muted/20 border border-border/50">
                <div className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1 mb-1.5">
                  <ShieldCheck className="w-3 h-3" /> Trading Plan
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">
                  Enter on strength triggering slightly above today's high. Set strict stop-loss exactly at the 21-EMA line. 
                </p>
              </div>

            </div>
          ))}
        </div>
      )}

    </div>
  );
}
