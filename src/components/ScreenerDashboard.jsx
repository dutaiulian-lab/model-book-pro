import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Target, TrendingUp, BarChart3, Crosshair, Clock, ShieldCheck, Zap, ChevronDown, ChevronUp, Copy, Check, Sparkles, Filter, AlertTriangle, RefreshCw, CheckCircle2, ExternalLink, X, Info } from 'lucide-react';

// Most recent weekday 22:15 UTC (primary scheduled scan time) that is at least 6h in
// the past. A healthy dataset must be newer than this; the 6h grace absorbs
// GitHub's usual scheduling delay.
function expectedScanAfter(now = new Date()) {
  const ref = new Date(now.getTime() - 6 * 3600 * 1000);
  const c = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 22, 15));
  if (c > ref) c.setUTCDate(c.getUTCDate() - 1);
  while (c.getUTCDay() === 0 || c.getUTCDay() === 6) c.setUTCDate(c.getUTCDate() - 1);
  return c;
}

const DISMISSED_RUN_KEY = 'dismissedFailedRunUrl';

// Market context colors (state color from rules.json context).
const CTX_TEXT = { green: 'text-emerald-500', yellow: 'text-amber-500', red: 'text-rose-500' };
const CTX_BADGE = {
  green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  red: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export default function ScreenerDashboard({ onHealthChange }) {
  const [expandedCard, setExpandedCard] = useState(null);
  const [openTile, setOpenTile] = useState(null); // market tile whose meaning is shown (mobile tap)
  const [selectedTab, setSelectedTab] = useState('ALL');
  const [copied, setCopied] = useState(false);
  const [isTrackingScan, setIsTrackingScan] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [scanFeedback, setScanFeedback] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [livePrices, setLivePrices] = useState({});
  const [pickDays, setPickDays] = useState(null);

  // Scan-day history (public/pick-days.json) for NEW / Day N badges.
  useEffect(() => {
    if (!data?.as_of) return;
    fetch(`/pick-days.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPickDays(j?.days || null))
      .catch(() => {});
  }, [data?.as_of]);

  const { streaks, dropped } = useMemo(() => {
    if (!pickDays || !data?.as_of || !data.matches) return { streaks: {}, dropped: null };
    const prior = Object.keys(pickDays).filter((d) => d < data.as_of).sort().reverse();
    const streaks = {};
    for (const m of data.matches) {
      let n = 1;
      for (const d of prior) {
        if (!pickDays[d].tickers.includes(m.ticker)) break;
        n++;
      }
      streaks[m.ticker] = n;
    }
    // Compare with the previous live scan only: backfill days use technical rules alone.
    const prevLive = prior.find((d) => pickDays[d].source === 'live');
    const current = new Set(data.matches.map((m) => m.ticker));
    const dropped = prevLive
      ? { date: prevLive, tickers: pickDays[prevLive].tickers.filter((t) => !current.has(t)) }
      : null;
    return { streaks, dropped };
  }, [pickDays, data]);
  const dismissedRunUrlRef = useRef(
    (() => { try { return localStorage.getItem(DISMISSED_RUN_KEY); } catch { return null; } })()
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (!event.target.closest('[data-screener-card="true"]')) {
        setExpandedCard(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadMarketData = async () => {
    try {
      const res = await fetch(`/market-state.json?t=${Date.now()}`);
      if (!res.ok) throw new Error("Could not load market data");
      const json = await res.json();
      setData(json);
      setLoading(false);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to load screener data. Ensure the daily scan has completed.");
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMarketData();
  }, []);

  useEffect(() => {
    let interval;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/scan-status');
        if (!res.ok) return;
        const statusData = await res.json();
        if (statusData.success) {
          setScanStatus(statusData);

          const isRunning = statusData.status === 'in_progress' || statusData.status === 'queued';
          if (isRunning) {
            setIsTrackingScan(true);
          }

          // Scan completed successfully while user was tracking
          if (isTrackingScan && statusData.status === 'completed' && statusData.conclusion === 'success') {
            setIsTrackingScan(false);
            setScanFeedback({
              type: 'success',
              title: 'Scan Completed Successfully',
              message: 'Fresh Model Book candidates have been screened and loaded into the dashboard.',
              url: statusData.url
            });
            loadMarketData();
          }

          // Scan failed on GitHub Actions (skip if the user already dismissed this run)
          if (statusData.status === 'completed' && statusData.conclusion === 'failure') {
            if (isTrackingScan) {
              setIsTrackingScan(false);
            }
            if (statusData.url && statusData.url === dismissedRunUrlRef.current) return;
            setScanFeedback({
              type: 'error',
              title: 'Scan Failed on GitHub Actions',
              message: 'The institutional scan job encountered a failure or timeout on the GitHub runner. Open the run on GitHub for the logs; the backup schedules retry automatically.',
              url: statusData.url
            });
          }
        }
      } catch(e) {
        console.warn("Could not check scan status", e);
      }
    };
    
    checkStatus();
    const pollInterval = (isTrackingScan || scanStatus?.status === 'in_progress' || scanStatus?.status === 'queued') ? 6000 : 20000;
    interval = setInterval(checkStatus, pollInterval);
    return () => clearInterval(interval);
  }, [isTrackingScan, scanStatus?.status]);

  const copyTickers = () => {
    if (!filteredMatches || filteredMatches.length === 0) return;
    const tickerString = filteredMatches.map(m => m.ticker).join(',');
    navigator.clipboard.writeText(tickerString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleCard = (ticker) => setExpandedCard(prev => prev === ticker ? null : ticker);

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
          // /api/quote returns a { SYMBOL: price } map.
          const prices = {};
          for (const [sym, px] of Object.entries(quotes)) {
            if (typeof px === 'number') prices[sym] = px;
          }
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

  const dataTimestamp = data?.timestamp ? new Date(data.timestamp) : null;
  const isStale = !loading && (!dataTimestamp || dataTimestamp < expectedScanAfter());
  const scanFailed = scanStatus?.status === 'completed' && scanStatus?.conclusion === 'failure';
  const scanRunning = scanStatus?.status === 'in_progress' || scanStatus?.status === 'queued';
  const health = loading ? 'loading'
    : error ? 'error'
    : scanRunning ? 'scanning'
    : scanFailed ? 'failed'
    : isStale ? 'stale'
    : 'ok';

  useEffect(() => {
    if (onHealthChange) onHealthChange(health);
  }, [health, onHealthChange]);

  const dismissFeedback = () => {
    if (scanFeedback?.type === 'error' && scanStatus?.url) {
      dismissedRunUrlRef.current = scanStatus.url;
      try { localStorage.setItem(DISMISSED_RUN_KEY, scanStatus.url); } catch {}
    }
    setScanFeedback(null);
  };

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

  const watchlist = data?.watchlist || [];
  const regime = data?.regime;
  const idle = data?.idle_cash;
  const context = data?.context; // display-only market context (rules.json context)
  const tracked = data?.tracked || [];
  const rules = data?.rules;
  const regimeOff = regime && (regime.on != null ? regime.on === false : regime.spy_above_200 === false);
  const regimeText = regime?.rule_text || 'SPY above its 200-day SMA';
  // Tabs for the families that are buy rules today (rules.json via market-state).
  const FAMILY_TABS = [
    ['RANGE', 'Launchpad Coils', 'emerald'],
    ['TIGHT', 'Tight Ranges', 'sky'],
    ['BASE', 'Base Breakouts', 'blue'],
    ['HTF', 'High Tight Flags', 'purple'],
  ].filter(([f]) => !rules?.families || rules.families.includes(f));
  const famCount = (f) => matches.filter(m => m.family === f).length;
  const readyCount = matches.filter(m => m.timing_status === 'AT_PIVOT').length;

  const filteredMatches = matches.filter(m => {
    if (selectedTab === 'READY') return m.timing_status === 'AT_PIVOT';
    if (FAMILY_TABS.some(([f]) => f === selectedTab)) return m.family === selectedTab;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      {/* INSTITUTIONAL ENGINE HEADER */}
      <div className="bg-card border border-border/80 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2.5">
          <span className="inline-flex bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-emerald-500/20 items-center gap-1">
            <ShieldCheck className="w-3 h-3"/> Model Book Calibrated
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
            True Market Leaders Screener
          </h1>
          <p
            className="text-sm text-muted-foreground max-w-xl"
            title="Calibrated on NVDA, APP, SMCI, PLTR, MSTR, RDDT and other leaders. Filters for shallow bases, moving-average squeezes and volume dry-ups while neutralizing false breakdowns."
          >
            Stage-2 leaders in tight bases, calibrated on 10 years of the market's biggest winners.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {['Stage-2', 'VCP', 'MA Smash', 'Volume Shield'].map(t => (
              <span key={t} className="text-[10px] font-mono text-muted-foreground border border-border/60 rounded-md px-1.5 py-0.5">{t}</span>
            ))}
          </div>
        </div>

        {/* METRICS SUMMARY WIDGET */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-muted/30 border border-border/60 rounded-xl p-3.5 self-stretch md:self-auto justify-between md:justify-end">
          <div className="text-left whitespace-nowrap">
            <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3 h-3"/> Last Scan
              {scanStatus?.status === 'in_progress' && (
                <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[9px] font-black animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> SCANNING
                </span>
              )}
              {scanStatus?.status === 'queued' && (
                <span className="text-amber-600 dark:text-amber-400 font-mono text-[9px] font-black">
                  ⏳ QUEUED
                </span>
              )}
              {scanStatus?.status === 'completed' && scanStatus?.conclusion === 'failure' && (
                <span className="text-rose-500 font-mono text-[9px] font-black">
                  ⚠️ FAILED
                </span>
              )}
              {isStale && !scanRunning && (
                <span className="text-amber-600 dark:text-amber-400 font-mono text-[9px] font-black" title="No scan has completed since the last scheduled run.">
                  ⚠️ STALE
                </span>
              )}
            </div>
            <div className={`text-lg font-mono font-bold leading-tight mt-1 ${isStale ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
              {new Date(timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
            {(data?.as_of || data?.stats) && (
              <div
                className="text-[10px] font-mono text-muted-foreground mt-0.5"
                title={data?.stats ? `Fetched OK: ${data.stats.ok} · No data: ${data.stats.no_data} · Failed: ${data.stats.fetch_failed} · Retries: ${data.stats.retries}` +
                  (data.stats.fundamentals_checked != null ? ` · Fundamentals failed: ${data.stats.fundamentals_failed}/${data.stats.fundamentals_checked}` : '') : ''}
              >
                {data?.as_of && `${new Date(`${data.as_of}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} close`}
                {data?.as_of && data?.stats && ' · '}
                {data?.stats && `${data.stats.ok.toLocaleString()} tickers`}
                {data?.stats?.fetch_failed > 0 && (
                  <span className="text-amber-600 dark:text-amber-400"> · {data.stats.fetch_failed.toLocaleString()} failed</span>
                )}
              </div>
            )}
          </div>
          <div className="h-8 w-px bg-border/60"></div>
          <div className="text-left">
            <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
              <Target className="w-3 h-3"/> Leaders
            </div>
            <div className="text-lg font-mono font-bold text-emerald-500 leading-tight mt-1">
              {matches.length}
              <span className="text-[10px] font-sans font-bold uppercase text-muted-foreground ml-1.5">setups</span>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {readyCount} at pivot
            </div>
          </div>
        </div>
      </div>

      {/* LIVE SCAN PROGRESS & FEEDBACK BANNER */}
      {scanFeedback && (
        <div className={`p-4 rounded-2xl border flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-2 shadow-sm ${
          scanFeedback.type === 'error'
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            : scanFeedback.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-blue-500/10 border-blue-500/30 text-blue-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              {scanFeedback.type === 'error' ? (
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              ) : scanFeedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
              )}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
                  {scanFeedback.title}
                </h4>
                {scanStatus?.url && (
                  <a
                    href={scanStatus.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    View on GitHub <ExternalLink className="w-3 h-3"/>
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {scanFeedback.message}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={dismissFeedback}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
            >
              <X className="w-4 h-4"/>
            </button>
          </div>
        </div>
      )}

      {/* MARKET REGIME & RULES */}
      {regime && (() => {
        const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
        const spyVs200 = regime.spy_sma200 ? (regime.spy_close / regime.spy_sma200 - 1) * 100 : idle?.spy_vs_200;
        const band = idle?.mode === 'spy200band' ? idle.band : null;
        const ctxSpy = context?.spy?.state ? context.spy : null;
        const ctxBreadth = context?.breadth?.state ? context.breadth : null;
        const flags = context?.flags || [];
        const openMeaning = tiles => tiles.find(t => t.label === openTile && t.meaning);
        const tiles = [
          {
            label: 'Market filter',
            title: `Rule: ${regimeText}`,
            value: (
              <span className={`flex items-center gap-1.5 ${regimeOff ? 'text-rose-500' : 'text-emerald-500'}`}>
                <span className={`w-2 h-2 rounded-full ${regimeOff ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                {regimeOff ? 'Off' : 'On'}
              </span>
            ),
            sub: regimeOff ? 'No new buys · watchlist only' : 'New buys allowed',
          },
          {
            label: 'SPY vs 200-day',
            title: [regime.spy_sma200 != null ? `SPY $${regime.spy_close?.toFixed(2)} vs 200-day $${regime.spy_sma200.toFixed(2)}` : '', ctxSpy?.meaning].filter(Boolean).join('\n\n'),
            meaning: ctxSpy?.meaning,
            value: (
              <span className={ctxSpy ? CTX_TEXT[ctxSpy.color] : (spyVs200 != null && spyVs200 < 0 ? 'text-rose-500' : 'text-foreground')}>
                {spyVs200 != null ? pct(spyVs200) : (regime.spy_above_200 ? 'Above' : 'Below')}
              </span>
            ),
            state: ctxSpy,
            sub: `SPY $${regime.spy_close?.toFixed(2)}`,
          },
          idle && idle.mode !== 'none' && {
            label: 'Idle cash',
            title: idle.note || (idle.on ? 'Money not in setups sits in SPY; sell SPY to fund new buys.' : 'SPY is in a downtrend; idle money stays in cash.'),
            value: <span className="text-foreground">{idle.on ? 'In SPY' : 'In cash'}</span>,
            sub: band != null
              ? (idle.on ? `Sell to fund buys · cash below −${band}%` : `Back to SPY above +${band}%`)
              : (idle.on ? 'Sell SPY to fund buys' : 'SPY in a downtrend'),
          },
          regime.breadth_50 != null && {
            label: 'Breadth',
            title: ['Share of scanned stocks trading above their 50-day SMA', ctxBreadth?.meaning].filter(Boolean).join('\n\n'),
            meaning: ctxBreadth?.meaning,
            value: <span className={ctxBreadth ? CTX_TEXT[ctxBreadth.color] : 'text-foreground'}>{regime.breadth_50.toFixed(0)}%</span>,
            state: ctxBreadth,
            sub: ctxBreadth?.change10 != null
              ? `above 50-day · ${ctxBreadth.change10 >= 0 ? '+' : ''}${ctxBreadth.change10.toFixed(1)} in 10d`
              : 'of stocks above 50-day',
          },
        ].filter(Boolean);
        const lgCols = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[tiles.length] || 'lg:grid-cols-4';
        const ruleChips = [
          `RS ≥ ${rules?.rsMin ?? 90}`,
          (rules?.dvPctMin ?? 85) > 0 ? `Top ${100 - (rules?.dvPctMin ?? 85)}% liquidity` : `$${((rules?.dvMin ?? 10e6) / 1e6).toFixed(0)}M+ daily volume`,
          `≥ +${rules?.upLow52Min ?? 100}% off 52w low`,
          rules?.depth52Max != null ? `≤ ${rules.depth52Max}% off high` : null,
        ].filter(Boolean);
        return (
          <div className={`rounded-2xl border overflow-hidden ${regimeOff ? 'border-rose-500/30 bg-rose-500/5' : 'border-border/80 bg-card'}`}>
            <div className={`grid grid-cols-2 ${lgCols}`}>
              {tiles.map((t, i) => (
                <div
                  key={t.label}
                  title={t.title}
                  onClick={t.meaning ? () => setOpenTile(openTile === t.label ? null : t.label) : undefined}
                  className={`px-4 py-3 border-border/60 ${i > 0 ? 'lg:border-l' : ''} ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t lg:border-t-0' : ''} ${
                    tiles.length % 2 === 1 && i === tiles.length - 1 ? 'col-span-2 lg:col-span-1' : ''
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1">
                    {t.label}
                    {t.meaning && <Info className="w-3 h-3 opacity-60"/>}
                  </div>
                  <div className="text-lg font-mono font-bold leading-tight mt-1 flex items-baseline gap-2">
                    {t.value}
                    {t.state && (
                      <span className={`text-[10px] font-sans font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${CTX_BADGE[t.state.color] || CTX_BADGE.yellow}`}>
                        {t.state.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{t.sub}</div>
                </div>
              ))}
            </div>
            {(() => {
              const m = openMeaning(tiles);
              return m ? (
                <div className="px-4 py-2 border-t border-border/60 text-[11px] text-foreground/80 leading-snug">
                  <span className="font-bold">{m.label} · {m.state?.label}:</span> {m.meaning}
                </div>
              ) : null;
            })()}
            {flags.map(f => (
              <div key={f.id} title={f.text}
                className={`px-4 py-2 border-t border-border/60 text-[11px] leading-snug ${f.id === 'thrust' ? 'bg-emerald-500/5' : 'bg-amber-500/5'}`}>
                <span className={`font-bold ${f.id === 'thrust' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {f.id === 'thrust' ? '🚀' : '⚠'} {f.label}{f.sessions_ago != null ? ` (${f.sessions_ago === 0 ? 'today' : `${f.sessions_ago} sessions ago`})` : ''}
                </span>
                <span className="text-muted-foreground"> · {f.text}</span>
              </div>
            ))}
            <div
              className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-t border-border/60 bg-muted/20"
              title={data?.rules_version ? `Rules ${data.rules_version}` : ''}
            >
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mr-1">Leader rules</span>
              {ruleChips.map(c => (
                <span key={c} className="text-[10px] font-mono text-muted-foreground border border-border/60 rounded-md px-1.5 py-0.5">{c}</span>
              ))}
            </div>
          </div>
        );
      })()}

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
                : 'bg-card border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
            }`}
            title="Closed within 2% of the buy stop"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            🎯 At Pivot ({readyCount})
          </button>
          {FAMILY_TABS.map(([fam, label]) => (
            <button
              key={fam}
              onClick={() => setSelectedTab(fam)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedTab === fam
                  ? 'bg-foreground text-background shadow'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {label} ({famCount(fam)})
            </button>
          ))}
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
      {dropped && dropped.tickers.length > 0 && (
        <div className="text-[11px] font-mono text-muted-foreground -mt-2">
          Dropped since {dropped.date}: {dropped.tickers.join(', ')}
        </div>
      )}
      {filteredMatches.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-2xl bg-card/30 space-y-3">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto text-muted-foreground">
            <ShieldCheck className="w-6 h-6"/>
          </div>
          <h3 className="text-base font-bold text-foreground">No Setups in this Category Today</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {regimeOff
              ? 'The market filter is off, so the rules take no new buys. Leaders still setting up are on the watchlist below.'
              : `No RS-${rules?.rsMin ?? 90}+ liquid leader has an untriggered setup in this category. Cash is a position.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
          {(() => {
            const sorted = [...filteredMatches].sort((a, b) => {
              const priceA = livePrices[a.ticker] || a.price;
              const priceB = livePrices[b.ticker] || b.price;
              const pivA = a.buy_stop ?? a.ema21, pivB = b.buy_stop ?? b.ema21;
              const distA = Math.abs((priceA - pivA) / pivA);
              const distB = Math.abs((priceB - pivB) / pivB);
              return distA - distB;
            });

            return sorted.map((match, idx) => {
              const currentPrice = livePrices[match.ticker] || match.price;
              const ema21 = match.ema21;
              const dma10 = match.dma10 || match.price;
              const liveDist10 = dma10 > 0 ? ((currentPrice - dma10) / dma10) * 100 : (match.dist_10dma || 0);

              // Trade plan from the screener: buy stop at the pivot, initial stop
              // = lower of the structural stop and 5% below the fill, exit on a
              // close below the 50-DMA. Older market-state files lack buy_stop.
              const buyStop = match.buy_stop ?? match.recent_pivot ?? currentPrice;
              const stopPrice = match.suggested_stop || (dma10 * 0.985);
              const stopPct = match.suggested_stop_pct ?? Math.max(1.0, ((buyStop - stopPrice) / buyStop) * 100);

              const distanceRaw = ((currentPrice - ema21) / ema21) * 100;
              const distanceAbs = Math.abs(distanceRaw);
              const isBelowEMA = currentPrice < ema21;

              let proximityColor = "text-amber-500 bg-amber-500/10 border-amber-500/20";
              if (isBelowEMA) proximityColor = "text-rose-500 bg-rose-500/10 border-rose-500/20";
              else if (distanceAbs < 1.5) proximityColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";

              const BADGES = {
                RANGE: ['bg-emerald-500/10 text-emerald-500 border-emerald-500/20', '🟢'],
                TIGHT: ['bg-sky-500/10 text-sky-500 border-sky-500/20', '🎯'],
                BASE: ['bg-blue-500/10 text-blue-500 border-blue-500/20', '🏗️'],
                HTF: ['bg-purple-500/10 text-purple-500 border-purple-500/20', '🚀'],
              };
              const [badgeBg, badgeIcon] = BADGES[match.family] || BADGES.RANGE;
              const liveDistPivot = buyStop > 0 ? ((currentPrice - buyStop) / buyStop) * 100 : 0;
              const isTriggered = liveDistPivot > 0;
              const isAtPivot = !isTriggered && liveDistPivot >= -2;
              const fmtRank = (x) => (x == null ? 'n/a' : x.toFixed(0));
              const fmtGrowth = (x) => (x == null ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`);

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
                      {streaks[match.ticker] && (
                        <span
                          className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                            streaks[match.ticker] === 1 ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400' : 'bg-muted text-muted-foreground'
                          }`}
                          title="Consecutive scan days this stock has passed the screen (backfilled days count the technical rules only)"
                        >
                          {streaks[match.ticker] === 1 ? '🆕 New' : `Day ${streaks[match.ticker]}`}
                        </span>
                      )}
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
                    <div className="mt-3 p-2.5 rounded-xl bg-muted/40 border border-border/70 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        {isTriggered ? (
                          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-[10px] font-black border border-amber-500/20" title="Live price is above the buy stop">
                            ⚡ TRIGGERED
                          </span>
                        ) : isAtPivot ? (
                          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] font-black border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                            🎯 AT PIVOT
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-[10px] font-black border border-blue-500/20">
                            ⏳ NEAR PIVOT
                          </span>
                        )}
                        <span className="font-mono text-muted-foreground text-[11px] whitespace-nowrap">
                          {liveDistPivot >= 0 ? `+${liveDistPivot.toFixed(1)}%` : `${liveDistPivot.toFixed(1)}%`} vs pivot
                        </span>
                      </div>
                      <div className="text-[10px] font-mono font-bold text-muted-foreground whitespace-nowrap">
                        Buy &gt; <span className="text-foreground">${buyStop.toFixed(2)}</span> · Stop <span className="text-foreground">${stopPrice.toFixed(2)}</span> (<span className="text-amber-600 dark:text-amber-400">-{stopPct.toFixed(1)}%</span>)
                      </div>
                    </div>

                    {/* KEY METRICS SUMMARY ROW */}
                    <div className="grid grid-cols-4 gap-1.5 mt-3 pt-3 border-t border-border/50 text-center">
                      <div className="bg-muted/20 rounded-lg p-1.5" title="IBD-style relative strength percentile (weighted 3/6/9/12-month return) across liquid US stocks">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">RS Rank</div>
                        <div className="text-xs font-mono font-bold text-emerald-500 mt-0.5">{fmtRank(match.rs_rank)}</div>
                      </div>
                      <div className="bg-muted/20 rounded-lg p-1.5" title="20-day dollar volume percentile">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Liquidity</div>
                        <div className="text-xs font-mono font-bold text-foreground mt-0.5">{fmtRank(match.dv_rank)}</div>
                      </div>
                      <div className="bg-muted/20 rounded-lg p-1.5" title="Distance below the 52-week high">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Off High</div>
                        <div className="text-xs font-mono font-bold text-foreground mt-0.5">{match.base_depth}</div>
                      </div>
                      <div className="bg-muted/20 rounded-lg p-1.5" title="Gain from the 52-week low">
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Run-Up</div>
                        <div className="text-xs font-mono font-bold text-primary mt-0.5">
                          {match.up_from_low52 != null ? `+${match.up_from_low52.toFixed(0)}%` : 'n/a'}
                        </div>
                      </div>
                    </div>
                    {match.earnings_soon && (
                      <div className="mt-2 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        ⚠️ Earnings {match.earnings_date}: a gap can jump the stop
                      </div>
                    )}
                  </div>

                  {/* EXPANDABLE DEEP-DIVE METRICS */}
                  {expandedCard === match.ticker && (
                    <div className="space-y-2.5 mt-4 pt-4 border-t border-border/60 text-xs animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><ShieldCheck className="w-3.5 h-3.5"/> 10-DMA Pad Floor</span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0">
                          ${dma10.toFixed(2)} ({liveDist10 >= 0 ? '+' : ''}{liveDist10.toFixed(1)}% cushion)
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><Crosshair className="w-3.5 h-3.5"/> Buy Stop (valid {match.sessions_left ?? 5} more session{match.sessions_left === 1 ? '' : 's'})</span>
                        <span className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0">
                          ${buyStop.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><Crosshair className="w-3.5 h-3.5"/> Initial Stop</span>
                        <span className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0" title="Distance from pivot, clamped to 3-8%">
                          ${stopPrice.toFixed(2)} (-{stopPct.toFixed(1)}% vs pivot)
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><Crosshair className="w-3.5 h-3.5"/> Exit</span>
                        <span className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0" title="Exit on a daily close below the 50-DMA">
                          Close &lt; 50-DMA{match.sma50 ? ` ($${match.sma50.toFixed(2)})` : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><Crosshair className="w-3.5 h-3.5"/> Exit once +20%</span>
                        <span className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0" title="After a +20% gain, trail the exit to the 21-EMA">
                          Close &lt; 21-EMA (${ema21.toFixed(2)})
                        </span>
                      </div>
                      {match.up_from_low52 != null && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><TrendingUp className="w-3.5 h-3.5"/> Prior Run-Up</span>
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0">
                            +{match.up_from_low52.toFixed(0)}% from 52-wk low
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><TrendingUp className="w-3.5 h-3.5"/> Setup</span>
                        <span className="text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] uppercase whitespace-nowrap truncate min-w-0">
                          {match.setup_type}{match.is_ipo ? ' · IPO' : ''}{match.signal_date ? ` · ${match.signal_date}` : ''}
                          {match.setup_depth != null ? ` · ${match.setup_depth.toFixed(1)}% deep, ${match.setup_length}d` : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><Target className="w-3.5 h-3.5"/> 21-EMA Proximity</span>
                        <span className={`font-mono font-bold px-2 py-0.5 rounded text-[10px] border ${proximityColor}`}>
                          ${ema21.toFixed(2)} ({distanceAbs.toFixed(1)}% {isBelowEMA ? 'Below' : 'Above'})
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><TrendingUp className="w-3.5 h-3.5"/> 3-Mo RS vs SPY</span>
                        <span className="font-mono font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0">
                          {match.relative_strength_3mo >= 0 ? '+' : ''}{match.relative_strength_3mo?.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><Zap className="w-3.5 h-3.5"/> Volatility (ADR)</span>
                        <span className="font-mono font-bold text-purple-500 bg-purple-500/10 px-2 py-0.5 rounded text-[10px] whitespace-nowrap truncate min-w-0">
                          {match.adr?.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><BarChart3 className="w-3.5 h-3.5"/> EPS Growth (YoY)</span>
                        <span className="font-mono font-bold text-emerald-500 whitespace-nowrap truncate min-w-0">
                          {fmtGrowth(match.eps_growth)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><TrendingUp className="w-3.5 h-3.5"/> Sales Growth (YoY)</span>
                        <span className="font-mono font-bold text-blue-500 whitespace-nowrap truncate min-w-0">
                          {fmtGrowth(match.rev_growth)}
                        </span>
                      </div>
                      {match.earnings_date && match.earnings_date !== "Unknown" && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap shrink-0"><Clock className="w-3.5 h-3.5"/> Earnings Date</span>
                          <span className="font-mono text-muted-foreground whitespace-nowrap truncate min-w-0">{match.earnings_date}</span>
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

      {/* SEPARATELY TRACKED FAMILIES (not buy signals) */}
      {tracked.length > 0 && (
        <div className="bg-card border border-purple-500/20 rounded-2xl p-5 shadow-sm space-y-3">
          <div>
            <h3 className="text-sm font-black text-foreground">
              🧪 Tracked separately: {(data?.rules_text?.tracked_families || ['High Tight Flags']).join(', ')} ({tracked.length})
            </h3>
            <p className="text-[11px] text-muted-foreground">
              These setups pass every buy rule, but their family is not a buy rule{data?.rules_text?.track_note ? `: ${data.rules_text.track_note}` : '.'}
              {' '}They are recorded in the track record under their own tier so the yearly re-study can re-admit them on
              evidence. Not buy signals.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-muted-foreground text-left">
                  <th className="py-1 pr-3">Ticker</th><th className="pr-3">Setup</th><th className="pr-3 text-right">Price</th>
                  <th className="pr-3 text-right">Buy stop</th><th className="pr-3 text-right">Stop</th><th className="pr-3 text-right">RS</th>
                  <th className="pr-3 text-right">Liq.</th><th className="pr-3 text-right">Run-up</th><th className="pr-3 text-right">Days left</th>
                </tr>
              </thead>
              <tbody>
                {tracked.map((w) => (
                  <tr key={`${w.ticker}-${w.signal_date}`} className="border-t border-border/50">
                    <td className="py-1.5 pr-3 font-bold">
                      <a href={`https://www.tradingview.com/chart/?symbol=${w.ticker}`} target="_blank" rel="noreferrer" className="hover:underline">{w.ticker}</a>
                    </td>
                    <td className="pr-3 whitespace-nowrap">{w.setup_type}</td>
                    <td className="pr-3 text-right font-mono">${w.price?.toFixed(2)}</td>
                    <td className="pr-3 text-right font-mono">${w.buy_stop?.toFixed(2)}</td>
                    <td className="pr-3 text-right font-mono">{w.suggested_stop != null ? `$${w.suggested_stop.toFixed(2)}` : ''}</td>
                    <td className="pr-3 text-right font-mono">{w.rs_rank?.toFixed(0)}</td>
                    <td className="pr-3 text-right font-mono">{w.dv_rank?.toFixed(0)}</td>
                    <td className="pr-3 text-right font-mono">{w.up_from_low52 != null ? `+${w.up_from_low52.toFixed(0)}%` : ''}</td>
                    <td className="pr-3 text-right font-mono">{w.sessions_left}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LEADER WATCHLIST (not buy signals) */}
      {watchlist.length > 0 && (
        <div className="bg-card border border-border/80 rounded-2xl p-5 shadow-sm space-y-3">
          <div>
            <h3 className="text-sm font-black text-foreground">👀 Leader Watchlist ({watchlist.length})</h3>
            <p className="text-[11px] text-muted-foreground">
              RS ≥ {data?.watch_rules?.rsMin ?? 90} stocks with a setup or power gap today that miss a buy rule. Not buy signals:
              in the 20-year test this looser list caught more Model Book leaders but lost money when traded.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-muted-foreground text-left">
                  <th className="py-1 pr-3">Ticker</th><th className="pr-3">Setup</th><th className="pr-3 text-right">Price</th>
                  <th className="pr-3 text-right">Pivot</th><th className="pr-3 text-right">RS</th><th className="pr-3 text-right">Liq.</th>
                  <th className="pr-3 text-right">Run-up</th><th className="pr-3">Why not a buy</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((w) => (
                  <tr key={w.ticker} className="border-t border-border/50">
                    <td className="py-1.5 pr-3 font-bold">
                      <a href={`https://www.tradingview.com/chart/?symbol=${w.ticker}`} target="_blank" rel="noreferrer" className="hover:underline">{w.ticker}</a>
                    </td>
                    <td className="pr-3 whitespace-nowrap">{w.setup_type}{w.gap_pct != null ? ` +${w.gap_pct.toFixed(0)}%` : ''}</td>
                    <td className="pr-3 text-right font-mono">${w.price?.toFixed(2)}</td>
                    <td className="pr-3 text-right font-mono">${w.buy_stop?.toFixed(2)}</td>
                    <td className="pr-3 text-right font-mono">{w.rs_rank?.toFixed(0)}</td>
                    <td className="pr-3 text-right font-mono">{w.dv_rank?.toFixed(0)}</td>
                    <td className="pr-3 text-right font-mono">{w.up_from_low52 != null ? `+${w.up_from_low52.toFixed(0)}%` : ''}</td>
                    <td className="pr-3 text-muted-foreground">{w.why_not_buy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
