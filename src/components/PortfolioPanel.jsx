import React, { useEffect, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';

// Account simulation panel for the Track Record tab: equity curve vs SPY total
// return, drawdown, headline stats, and (for live) the 100-trade review gauge.
// Data: track-record.json `portfolio[source]` (scripts/lib/portfolio.mjs).

const REVIEW_TRADES = 100;
const REVIEW_MIN_R = 0.2;

const signed = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);
const pctTone = (x) =>
  x == null ? 'text-muted-foreground' : x > 0 ? 'text-emerald-600 dark:text-emerald-400' : x < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground';

function Stat({ label, value, sub, valueClass = 'text-foreground', title }) {
  return (
    <div className="bg-muted/30 border border-border/60 rounded-xl p-3" title={title}>
      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{label}</div>
      <div className={`text-lg font-mono font-black mt-0.5 ${valueClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// Plain SVG chart: equity and SPY (indexed to 100) on top, account drawdown below.
function useNarrow(query = '(max-width: 639px)') {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

function EquityChart({ daily }) {
  const [hover, setHover] = useState(null);
  // Narrow screens: a smaller viewBox so the 10px labels stay readable.
  const narrow = useNarrow();
  const W = narrow ? 360 : 900, H = narrow ? 200 : 260, DD_H = narrow ? 50 : 70, PAD_L = narrow ? 34 : 44, PAD_R = 8, PAD_T = 10, GAP = 18;
  const n = daily.dates.length;
  const geo = useMemo(() => {
    const all = [...daily.equity, ...daily.spy, ...(daily.equity_cash_only || [])].filter((v) => v != null);
    const lo = Math.min(...all), hi = Math.max(...all);
    const span = hi - lo || 1;
    const yMin = lo - span * 0.05, yMax = hi + span * 0.05;
    const x = (k) => PAD_L + (n === 1 ? 0 : (k / (n - 1)) * (W - PAD_L - PAD_R));
    const y = (v) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD_T);
    let peak = -Infinity;
    const dd = daily.equity.map((v) => { peak = Math.max(peak, v); return (1 - v / peak) * 100; });
    const ddMax = Math.max(5, ...dd);
    const yDD = (v) => H + GAP + (v / ddMax) * DD_H;
    const line = (arr) => arr.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ddArea = `M${x(0)},${yDD(0)}` + dd.map((v, k) => `L${x(k).toFixed(1)},${yDD(v).toFixed(1)}`).join('') + `L${x(n - 1)},${yDD(0)}Z`;
    const ticks = [];
    const step = (yMax - yMin) / 4;
    for (let i = 0; i <= 4; i++) ticks.push(yMin + step * i);
    // One date label per ~quarter of the width.
    const xLabels = (narrow ? [0, n - 1] : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]).filter((k, i, a) => a.indexOf(k) === i);
    return { x, y, yDD, dd, ddMax, eq: line(daily.equity), spy: line(daily.spy), cashOnly: daily.equity_cash_only ? line(daily.equity_cash_only) : null, ddArea, ticks, xLabels };
  }, [daily, n, W, H, DD_H, PAD_L]);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const k = Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1));
    setHover(k >= 0 && k < n ? k : null);
  };
  const h = hover;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + GAP + DD_H + 18}`} className="w-full h-auto select-none touch-pan-y" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={geo.y(t)} y2={geo.y(t)} className="stroke-border" strokeWidth="0.5" />
            <text x={PAD_L - 6} y={geo.y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">{t.toFixed(0)}</text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - PAD_R} y1={geo.y(100)} y2={geo.y(100)} className="stroke-muted-foreground" strokeWidth="0.6" strokeDasharray="3 3" />
        <path d={geo.spy} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        {geo.cashOnly && <path d={geo.cashOnly} fill="none" stroke="#10b981" strokeWidth="1.2" strokeDasharray="4 3" strokeOpacity="0.7" />}
        <path d={geo.eq} fill="none" stroke="#10b981" strokeWidth="2" />
        <text x={PAD_L - 6} y={H + GAP + 4} textAnchor="end" className="fill-muted-foreground" fontSize="10">0%</text>
        <text x={PAD_L - 6} y={H + GAP + DD_H} textAnchor="end" className="fill-muted-foreground" fontSize="10">-{geo.ddMax.toFixed(0)}%</text>
        <path d={geo.ddArea} fill="#f43f5e" fillOpacity="0.35" stroke="#f43f5e" strokeWidth="0.8" />
        {geo.xLabels.map((k) => (
          <text key={k} x={geo.x(k)} y={H + GAP + DD_H + 14} textAnchor={k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle'} className="fill-muted-foreground" fontSize="10">
            {daily.dates[k]}
          </text>
        ))}
        {h != null && (
          <g>
            <line x1={geo.x(h)} x2={geo.x(h)} y1={PAD_T} y2={H + GAP + DD_H} className="stroke-foreground" strokeWidth="0.6" strokeOpacity="0.5" />
            <circle cx={geo.x(h)} cy={geo.y(daily.equity[h])} r="3" fill="#10b981" />
            <circle cx={geo.x(h)} cy={geo.y(daily.spy[h])} r="3" fill="#94a3b8" />
          </g>
        )}
      </svg>
      <div className="mt-1 sm:mt-0 sm:absolute sm:top-1 sm:left-14 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono bg-card/80 rounded px-2 py-1">
        {h != null ? (
          <>
            <span className="text-muted-foreground">{daily.dates[h]}</span>
            <span className="text-emerald-600 dark:text-emerald-400">Account {signed(daily.equity[h] - 100)}</span>
            <span className="text-slate-500">SPY {signed(daily.spy[h] - 100)}</span>
            <span className="text-rose-500">DD -{geo.dd[h].toFixed(1)}%</span>
            <span className="text-muted-foreground">Invested {daily.exposure[h]?.toFixed(0)}%</span>
          </>
        ) : (
          <>
            <span className="text-emerald-600 dark:text-emerald-400">━ Account</span>
            {daily.equity_cash_only && <span className="text-emerald-600/70 dark:text-emerald-400/70">┅ Idle cash in cash</span>}
            <span className="text-slate-500">━ SPY total return</span>
            <span className="text-rose-500">▆ Account drawdown</span>
          </>
        )}
      </div>
    </div>
  );
}

// Live-only verdict for the review agreed after the rule study: once 100 live
// trades have closed, avg R should be >= +0.2R and the account should keep up
// with SPY over the same window.
function ReviewGauge({ liveOverall, stats }) {
  const closed = liveOverall?.closed ?? 0;
  const avgR = liveOverall?.avg_r;
  const beat = stats && stats.total_return != null && stats.spy_total_return != null
    ? stats.total_return >= stats.spy_total_return : null;
  const rOk = avgR != null && avgR >= REVIEW_MIN_R;
  let tone, title, text;
  if (closed < REVIEW_TRADES) {
    tone = 'border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-200';
    title = `Collecting evidence: ${closed}/${REVIEW_TRADES} closed live trades`;
    text = 'No verdict yet. Small samples are dominated by a few trades.';
  } else if (rOk && beat) {
    tone = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
    title = 'Green: the rules are earning their keep';
    text = `Avg ${avgR.toFixed(2)}R and the account is ahead of SPY. Keep trading them as specified.`;
  } else if (rOk || beat) {
    tone = 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200';
    title = 'Amber: mixed evidence';
    text = rOk
      ? `Avg ${avgR.toFixed(2)}R is fine but the account trails SPY: check exposure and skipped signals before changing rules.`
      : `The account is ahead of SPY but avg R is ${avgR == null ? '—' : avgR.toFixed(2)}R (target ≥ ${REVIEW_MIN_R}R): likely carried by a few trades.`;
  } else {
    tone = 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200';
    title = 'Red: the edge is not showing up live';
    text = `Avg ${avgR == null ? '—' : avgR.toFixed(2)}R and the account trails SPY. Reduce size and re-run the rule study.`;
  }
  return (
    <div className={`border rounded-xl p-3 text-xs ${tone}`}>
      <div className="font-bold">{title}</div>
      <div className="mt-0.5">{text}</div>
      <div className="mt-1 opacity-80">
        Target: avg R ≥ +{REVIEW_MIN_R}R over {REVIEW_TRADES} closed trades and account return ≥ SPY total return.
        {closed > 0 && ` Now: ${closed} closed, avg ${avgR == null ? '—' : `${avgR > 0 ? '+' : ''}${avgR.toFixed(2)}R`}${beat == null ? '' : beat ? ', ahead of SPY' : ', behind SPY'}.`}
      </div>
    </div>
  );
}

export default function PortfolioPanel({ portfolio, source, liveOverall }) {
  const p = portfolio?.[source];
  if (!p) {
    return (
      <div className="bg-card border border-border/80 rounded-2xl p-5 text-sm text-muted-foreground">
        {source === 'live'
          ? <>No live trades have filled yet, so there is no account curve. {liveOverall && <ReviewGauge liveOverall={liveOverall} stats={null} />}</>
          : 'The account simulation appears after the next backfill.'}
      </div>
    );
  }
  const s = p.stats;
  const ahead = s.total_return != null && s.spy_total_return != null ? s.total_return - s.spy_total_return : null;
  const annual = s.cagr != null;
  return (
    <div className="bg-card border border-border/80 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-foreground flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" /> One account trading every signal{source === 'backfill' ? ' (simulated)' : ''}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-3xl">
            ${s.rules.start.toLocaleString()} start, {s.rules.risk_pct}% risk per trade, positions capped at {s.rules.max_pos_pct}%, one position per ticker,
            same-day fills by RS rank. Signals are skipped when cash runs out. Marked to the close daily; SPY includes dividends. {s.from} to {s.to}.
            {s.idle_cash && s.idle_cash.mode !== 'none' && ` ${s.idle_cash.text}.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Stat
          label={annual ? 'Account CAGR' : 'Account return'}
          value={signed(annual ? s.cagr : s.total_return)}
          valueClass={pctTone(annual ? s.cagr : s.total_return)}
          sub={s.cash_only
            ? `Idle cash in cash: ${signed(annual ? s.cash_only.cagr : s.cash_only.total_return)}`
            : `Total ${signed(s.total_return)} · $${s.end_equity.toLocaleString()}`}
          title={s.cash_only ? `Total ${signed(s.total_return)} · $${s.end_equity.toLocaleString()}. Same trades with idle cash left in cash: total ${signed(s.cash_only.total_return)}, max drawdown -${s.cash_only.max_dd?.toFixed(1)}%.` : undefined}
        />
        <Stat
          label={annual ? 'SPY CAGR' : 'SPY return'}
          value={signed(annual ? s.spy_cagr : s.spy_total_return)}
          sub={`Total ${signed(s.spy_total_return)} · ${ahead == null ? '' : ahead >= 0 ? `ahead ${ahead.toFixed(1)} pts` : `behind ${(-ahead).toFixed(1)} pts`}`}
          valueClass="text-slate-500"
        />
        <Stat label="Max drawdown" value={`-${s.max_dd.toFixed(1)}%`} valueClass="text-rose-600 dark:text-rose-400" sub={`SPY -${s.spy_max_dd.toFixed(1)}%`} title="Peak-to-trough on daily marked equity" />
        <Stat label="Worst month" value={s.worst_month ? signed(s.worst_month.ret) : '—'} valueClass={pctTone(s.worst_month?.ret)} sub={s.worst_month?.month} />
        <Stat
          label="Invested"
          value={`${s.avg_exposure.toFixed(0)}%`}
          sub={s.avg_spy_share != null && s.idle_cash && s.idle_cash.mode !== 'none'
            ? `+ ${s.avg_spy_share.toFixed(0)}% in SPY · max ${s.max_positions} pos.`
            : `Flat ${s.pct_days_flat.toFixed(0)}% of days · max ${s.max_positions} pos.`}
          title="Average share of equity in setups (and in SPY under the idle-cash rule)"
        />
        <Stat
          label="Top-5 trades"
          value={s.top5_share == null ? '—' : `${s.top5_share.toFixed(0)}%`}
          sub={s.top5_share == null ? 'No overall profit' : 'of total profit'}
          title={s.top5.map((t) => `${t.ticker}${t.open ? ' (open)' : ''}: $${t.pnl.toLocaleString()}`).join('\n')}
        />
      </div>

      <EquityChart daily={p.daily} />

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground font-mono">
        <span>Trades taken {s.trades_taken}</span>
        <span>Skipped, no cash {s.skipped_cash}</span>
        <span>Sized down {s.resized}</span>
        <span>Skipped, already held {s.skipped_held}</span>
        {s.top5.length > 0 && (
          <span>Best: {s.top5.slice(0, 3).map((t) => `${t.ticker} ${t.pnl >= 0 ? '+' : '-'}$${Math.abs(t.pnl).toLocaleString()}`).join(', ')}</span>
        )}
      </div>

      {source === 'live' && <ReviewGauge liveOverall={liveOverall} stats={s} />}
    </div>
  );
}
