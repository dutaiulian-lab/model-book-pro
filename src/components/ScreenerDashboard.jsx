import React, { useState, useEffect, useRef } from 'react';
import { Target, TrendingUp, BarChart3, Crosshair, Clock, ShieldCheck, Zap, ChevronDown, ChevronUp, Copy, Check, Sparkles, Filter } from 'lucide-react';

export default function ScreenerDashboard() {
  const [expandedCard, setExpandedCard] = useState(null);
  const [selectedTab, setSelectedTab] = useState('ALL');
  const [copied, setCopied] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [hasSeenInProgress, setHasSeenInProgress] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [livePrices, setLivePrices] = useState({});

  useEffect(() => {
    function handleClickOutside(event) {
      if (!event.target.closest('[data-screener-card="true"]')) {
        setExpandedCard(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let interval;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/scan-status');
        const statusData = await res.json();
        if (statusData.success) {
          setScanStatus(statusData);
          if (statusData.status === 'in_progress' || statusData.status === 'queued') {
            setHasSeenInProgress(true);
          }
          if (isScanning && hasSeenInProgress && statusData.status === 'completed' && statusData.conclusion === 'success') {
             if (interval) clearInterval(interval);
             setTimeout(() => window.location.reload(), 1500);
          }
        }
      } catch(e) {}
    };
    
    checkStatus();
    interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [isScanning, hasSeenInProgress]);

  const copyTickers = () => {
    if (!filteredMatches || filteredMatches.length === 0) return;
    const tickerString = filteredMatches.map(m => m.ticker).join(',');
    navigator.clipboard.writeText(tickerString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleCard = (ticker) => setExpandedCard(prev => prev === ticker ? null : ticker);

  const triggerScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/trigger-scan', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) {
        alert("Failed to trigger scan: " + result.error);
      } else {
        setScanStatus({ status: 'queued' });
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
    setIsScanning(false);
  };

  useEffect(() => {
    fetch(`/market-state.json?t=${Date.now()}`)
      .then(res => res.json())
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError("Failed to load screener data. Ensure the daily scan has completed.");
        setLoading(false);
      });
  }, []);

  // Real-time loop for live prices
  useEffect(() => {
    if (!data || !data.matches || data.matches.length === 0) return;

    let isMounted = true;
    const fetchLivePrices = async () => {
      const tickers = data.matches.map(m => m.ticker).join(',');
      try {
        const res = await fetch(`/api/quote?symbols=${tickers}`);
        if (!res.ok) return;
        const quotes = await res.json();
        if (isMounted && quotes) {
          const prices = {};
          quotes.forEach(q => {
            if (q.symbol && q.regularMarketPrice) {
              prices[q.symbol] = q.regularMarketPrice;
            }
          });
          setLivePrices(prices);
        }
      } catch (e) {
        console.warn("Could not fetch real-time quotes", e);
      }
    };

    fetchLivePrices();
    const priceInterval = setInterval(fetchLivePrices, 15000);
    return () => {
      isMounted = false;
      clearInterval(priceInterval);
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        <p className="text-sm font-medium text-muted-foreground animate-pulse">Running Institutional Model Book Diagnostics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 bg-destructive/10 border border-destructive/20 rounded-2xl text-center space-y-3">
        <p className="text-destructive font-bold">{error}</p>
        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg shadow">
          Retry Connection
        </button>
      </div>
    );
  }

  const matches = data?.matches || [];
  const timestamp = data?.timestamp || new Date().toISOString();
  const totalScanned = data?.total_scanned || 6000;

  const coilCount = matches.filter(m => m.setup_type === 'Launchpad Coil').length;
  const flagCount = matches.filter(m => m.setup_type === 'Power Trend Flag').length;
  const ipoCount = matches.filter(m => m.setup_type === 'IPO Base Pivot' || m.is_ipo).length;
  const readyCount = matches.filter(m => m.timing_status === 'READY_AT_PAD' || (m.dist_10dma !== undefined && m.dist_10dma <= 2.2)).length;

  const filteredMatches = matches.filter(m => {
    if (selectedTab === 'READY') return m.timing_status === 'READY_AT_PAD' || (m.dist_10dma !== undefined && m.dist_10dma <= 2.2);
    if (selectedTab === 'COIL') return m.setup_type === 'Launchpad Coil';
    if (selectedTab === 'FLAG') return m.setup_type === 'Power Trend Flag';
    if (selectedTab === 'IPO') return m.setup_type === 'IPO Base Pivot' || m.is_ipo;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      {/* INSTITUTIONAL ENGINE HEADER */}
      <div className="bg-card border border-border/80 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-emerald-500/20 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3"/> Model Book Calibrated
            </span>
            <span className="text-xs text-muted-foreground font-mono">Stage-2 · VCP · MA Smash · Volume Shield</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight flex items-center gap-2.5">
            True Market Leaders Screener
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Calibrated against 10 years of institutional market leaders (NVDA, APP, SMCI, PLTR, MSTR, RDDT). 
            Filters for shallow bases, moving average squeezes, and volume dry-ups while neutralizing false breakdowns.
          </p>
        </div>

        {/* METRICS SUMMARY WIDGET */}
        <div className="flex items-center gap-4 bg-muted/30 border border-border/60 rounded-xl p-3.5 self-stretch md:self-auto justify-between md:justify-end">
          <div className="text-left">
            <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3"/> Last Scan
            </div>
            <div className="text-xs font-mono font-bold text-foreground mt-0.5">
              {new Date(timestamp).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
          </div>
          <div className="h-8 w-px bg-border/60"></div>
          <div className="text-left">
            <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
              <Target className="w-3 h-3"/> Leaders
            </div>
            <div className="text-xs font-mono font-bold text-emerald-500 mt-0.5">
              {matches.length} Setups
            </div>
          </div>
          <button
            onClick={triggerScan}
            disabled={isScanning || (scanStatus && (scanStatus.status === 'in_progress' || scanStatus.status === 'queued'))}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ml-2 shadow-sm"
          >
            {isScanning || (scanStatus && (scanStatus.status === 'in_progress' || scanStatus.status === 'queued')) ? 'SCANNING...' : 'SCAN NOW'}
          </button>
        </div>
      </div>

      {/* FILTER TABS & TOOLBAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedTab('ALL')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedTab === 'ALL'
                ? 'bg-foreground text-background shadow'
                : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            All Leaders ({matches.length})
          </button>
          <button
            onClick={() => setSelectedTab('READY')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedTab === 'READY'
                ? 'bg-emerald-600 text-white shadow ring-2 ring-emerald-400/40'
                : 'bg-card border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            🎯 Ready at Pad ({readyCount})
          </button>
          <button
            onClick={() => setSelectedTab('COIL')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedTab === 'COIL'
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-card border border-border text-muted-foreground hover:text-emerald-500'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Launchpad Coils ({coilCount})
          </button>
          <button
            onClick={() => setSelectedTab('FLAG')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedTab === 'FLAG'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-card border border-border text-muted-foreground hover:text-blue-500'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
            Power Trend Flags ({flagCount})
          </button>
          <button
            onClick={() => setSelectedTab('IPO')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedTab === 'IPO'
                ? 'bg-purple-600 text-white shadow'
                : 'bg-card border border-border text-muted-foreground hover:text-purple-500'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-400"></span>
            IPO Base Pivots ({ipoCount})
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            onClick={copyTickers}
            className="flex items-center gap-1.5 text-xs font-bold text-foreground bg-card hover:bg-muted border border-border px-3 py-1.5 rounded-lg transition-all shadow-sm"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
            {copied ? <span className="text-emerald-500">Copied!</span> : <span>Copy for TradingView</span>}
          </button>
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20">
            <Zap className="w-3 h-3 fill-emerald-500 animate-pulse" /> Live Quotes
          </div>
        </div>
      </div>

      {/* SETUP CARDS GRID */}
      {filteredMatches.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-2xl bg-card/30 space-y-3">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto text-muted-foreground">
            <ShieldCheck className="w-6 h-6"/>
          </div>
          <h3 className="text-base font-bold text-foreground">No Setups in this Category Today</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Our institutional filter rejects loose patterns, false breakdowns, and declining trends. 
            Cash is an active position until the textbook Model Book setup presents itself.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
          {(() => {
            const sorted = [...filteredMatches].sort((a, b) => {
              const priceA = livePrices[a.ticker] || a.price;
              const priceB = livePrices[b.ticker] || b.price;
              const distA = Math.abs((priceA - a.ema21) / a.ema21);
              const distB = Math.abs((priceB - b.ema21) / b.ema21);
              return distA - distB;
            });

            return sorted.map((match, idx) => {
              const currentPrice = livePrices[match.ticker] || match.price;
              const ema21 = match.ema21;
              const dma10 = match.dma10 || match.price;
              const liveDist10 = dma10 > 0 ? ((currentPrice - dma10) / dma10) * 100 : (match.dist_10dma || 0);
              const isLiveExtended = liveDist10 > 3.5;
              const isLiveReady = liveDist10 <= 2.2 && liveDist10 >= -0.5;

              const stopPrice = match.suggested_stop || (dma10 * 0.985);
              const stopPct = Math.max(1.0, ((currentPrice - stopPrice) / currentPrice) * 100);

              const distanceRaw = ((currentPrice - ema21) / ema21) * 100;
              const distanceAbs = Math.abs(distanceRaw);
              const isBelowEMA = currentPrice < ema21;

              let proximityColor = "text-amber-500 bg-amber-500/10 border-amber-500/20";
              if (isBelowEMA) proximityColor = "text-rose-500 bg-rose-500/10 border-rose-500/20";
              else if (distanceAbs < 1.5) proximityColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";

              let badgeBg = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
              let badgeIcon = "🟢";
              if (match.setup_type === 'Power Trend Flag') {
                badgeBg = "bg-blue-500/10 text-blue-500 border-blue-500/20";
                badgeIcon = "🚀";
              } else if (match.setup_type === 'IPO Base Pivot' || match.is_ipo) {
                badgeBg = "bg-purple-500/10 text-purple-500 border-purple-500/20";
                badgeIcon = "🌟";
              }

              return (
                <div
                  key={match.ticker}
                  data-screener-card="true"
                  className="bg-card border border-border/80 hover:border-primary/50 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col group relative"
                >
                  {/* CARD TOP ROW: BADGE & ACTIONS */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${badgeBg}`}>
                      <span>{badgeIcon}</span> {match.setup_type || 'Launchpad Coil'}
                    </span>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://www.tradingview.com/chart/?symbol=${match.ticker}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary text-[10px] font-black uppercase px-2.5 py-1 rounded-md transition-colors"
                      >
                        Chart ↗
                      </a>
                      <button
                        onClick={() => toggleCard(match.ticker)}
                        className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                      >
                        {expandedCard === match.ticker ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                      </button>
                    </div>
                  </div>

                  {/* TICKER & PRICE */}
                  <div className="cursor-pointer" onClick={() => toggleCard(match.ticker)}>
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-2xl font-black text-foreground tracking-tight">{match.ticker}</h3>
                      <div className="text-2xl font-mono font-black text-foreground">${currentPrice.toFixed(2)}</div>
                    </div>

                    {/* SECTOR & MICRO-TAGS */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {match.sector && match.sector !== "Unknown" && (
                        <span className="bg-muted text-muted-foreground text-[9px] font-bold uppercase px-2 py-0.5 rounded">
                          {match.sector}
                        </span>
                      )}
                      {match.float_shares > 0 && match.float_shares < 50000000 && (
                        <span className="bg-purple-500/10 text-purple-500 text-[9px] font-bold uppercase px-2 py-0.5 rounded">
                          ⚡ Low Float
                        </span>
                      )}
                      {match.short_percent >= 0.10 && (
                        <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold uppercase px-2 py-0.5 rounded">
                          🔥 High Short
                        </span>
                      )}
                    </div>

                    {/* TIMING & RISK LAUNCHPAD METER */}
                    <div className="mt-3 p-2.5 rounded-xl bg-muted/40 border border-border/70 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {isLiveReady ? (
                          <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] font-black border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                            🎯 READY AT PAD
                          </span>
                        ) : isLiveExtended ? (
                          <span className="flex items-center gap-1.5 text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded text-[10px] font-black border border-rose-500/20">
                            ⚠️ EXTENDED
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-[10px] font-black border border-blue-500/20">
                            ⚡ AT PIVOT
                          </span>
                        )}
                        <span className="font-mono text-muted-foreground text-[11px]">
                          {liveDist10 >= 0 ? `+${liveDist10.toFixed(1)}%` : `${liveDist10.toFixed(1)}%`} vs 10-DMA
                        </span>
                      </div>
                      <div className="text-[10px] font-mono font-bold text-muted-foreground">
                        Stop: <span className="text-foreground">${stopPrice.toFixed(2)}</span> (<span className={stopPct <= 3.5 ? "text-emerald-400" : "text-amber-400"}>-{stopPct.toFixed(1)}%</span>)
                      </div>
                    </div>

                    {/* KEY METRICS SUMMARY ROW */}
                    <div className="grid grid-cols-4 gap-1.5 mt-3 pt-3 border-t border-border/50 text-center">
                      <div className="bg-muted/20 rounded-lg p-1.5">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Base</div>
                        <div className="text-xs font-mono font-bold text-emerald-500 mt-0.5">{match.base_depth}</div>
                      </div>
                      <div className="bg-muted/20 rounded-lg p-1.5">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">10-DMA</div>
                        <div className="text-xs font-mono font-bold text-foreground mt-0.5">
                          {liveDist10 >= 0 ? `+${liveDist10.toFixed(1)}%` : `${liveDist10.toFixed(1)}%`}
                        </div>
                      </div>
                      <div className="bg-muted/20 rounded-lg p-1.5">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">10/21 MA</div>
                        <div className="text-xs font-mono font-bold text-foreground mt-0.5">
                          {match.spread_10_21 ? `${match.spread_10_21.toFixed(1)}%` : '<2.5%'}
                        </div>
                      </div>
                      <div className="bg-muted/20 rounded-lg p-1.5">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Volume</div>
                        <div className="text-xs font-mono font-bold text-primary mt-0.5">
                          {match.vol_status || 'Dry-Up'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* EXPANDABLE DEEP-DIVE METRICS */}
                  {expandedCard === match.ticker && (
                    <div className="space-y-2.5 mt-4 pt-4 border-t border-border/60 text-xs animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5"/> 10-DMA Pad Floor</span>
                        <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px]">
                          ${dma10.toFixed(2)} ({liveDist10 >= 0 ? '+' : ''}{liveDist10.toFixed(1)}% cushion)
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5"/> Recommended Stop</span>
                        <span className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded text-[10px]">
                          ${stopPrice.toFixed(2)} (-{stopPct.toFixed(1)}% risk)
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5"/> Macro Regime</span>
                        <span className="text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] uppercase">
                          {match.is_ipo ? 'IPO Launchpad' : 'Stage-2 Stacked'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-3.5 h-3.5"/> 21-EMA Proximity</span>
                        <span className={`font-mono font-bold px-2 py-0.5 rounded text-[10px] border ${proximityColor}`}>
                          ${ema21.toFixed(2)} ({distanceAbs.toFixed(1)}% {isBelowEMA ? 'Below' : 'Above'})
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5"/> 3-Mo RS vs SPY</span>
                        <span className="font-mono font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded text-[10px]">
                          +{match.relative_strength_3mo?.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><Zap className="w-3.5 h-3.5"/> Volatility (ADR)</span>
                        <span className="font-mono font-bold text-purple-500 bg-purple-500/10 px-2 py-0.5 rounded text-[10px]">
                          {match.adr?.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5"/> EPS Growth (YoY)</span>
                        <span className="font-mono font-bold text-emerald-500">
                          +{((match.eps_growth || 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5"/> Sales Growth (YoY)</span>
                        <span className="font-mono font-bold text-blue-500">
                          +{((match.rev_growth || 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                      {match.earnings_date && match.earnings_date !== "Unknown" && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Earnings Date</span>
                          <span className="font-mono text-muted-foreground">{match.earnings_date}</span>
                        </div>
                      )}
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
