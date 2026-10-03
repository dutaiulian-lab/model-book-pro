import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3, AlertTriangle, Info, ExternalLink } from 'lucide-react';
import PortfolioPanel from './PortfolioPanel';

const TIMING_LABELS = { AT_PIVOT: 'At Pivot (≤2%)', NEAR_PIVOT: 'Near Pivot', READY_AT_PAD: 'Ready at Pad', BREAKING_OUT: 'At Pivot', COILING: 'Coiling' };
const MIN_LIVE_CLOSED = 20;
const PAGE = 100;

const signed = (x, digits = 1, suffix = '%') =>
  x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(digits)}${suffix}`;
const fmtR = (x) => signed(x, 2, 'R');
const fmtPct = (x, digits = 0) => (x == null ? '—' : `${x.toFixed(digits)}%`);
const tone = (x) =>
  x == null ? 'text-muted-foreground' : x > 0 ? 'text-emerald-600 dark:text-emerald-400' : x < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground';

function statusText(o) {
  if (!o) return '—';
  switch (o.status) {
    case 'pending': return 'Awaiting breakout';
    case 'no_entry': return 'Not triggered';
    case 'open': return `Open · day ${o.days}`;
    case 'skipped': return 'Skipped';
    case 'expired': return 'Expired (no data)';
    case 'closed':
      if (o.exit_reason === 'stop') return `Stopped · day ${o.days}`;
      if (o.exit_reason === 'time') return `Time exit · day ${o.days}`;
      return `Below 50-DMA · day ${o.days}`;
    default: return o.status;
  }
}

function StatCard({ label, value, sub, valueClass = 'text-foreground', title }) {
  return (
    <div className="bg-card border border-border/80 rounded-xl p-4" title={title}>
      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{label}</div>
      <div className={`text-2xl font-mono font-black mt-1 ${valueClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ title, groups, labelFn = (k) => k }) {
  const rows = Object.entries(groups || {});
  if (!rows.length) return null;
  return (
    <div className="bg-card border border-border/80 rounded-2xl p-4 sm:p-5">
      <h3 className="text-sm font-black text-foreground mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/60">
              <th className="text-left font-bold py-2 pr-3">Group</th>
              <th className="text-right font-bold py-2 px-2">Signals</th>
              <th className="text-right font-bold py-2 px-2">Closed</th>
              <th className="text-right font-bold py-2 px-2">Win %</th>
              <th className="text-right font-bold py-2 px-2">Avg R</th>
              <th className="text-right font-bold py-2 px-2">Median R</th>
              <th className="text-right font-bold py-2 px-2">Profit factor</th>
              <th className="text-right font-bold py-2 px-2" title="Average account return per closed trade at 1% risk, positions capped at 25%">Acct / trade</th>
              <th className="text-right font-bold py-2 px-2" title="Entered trades that gained 30%+ within 60 sessions">Big winners</th>
              <th className="text-right font-bold py-2 pl-2">Stopped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, s]) => (
              <tr key={k} className="border-b border-border/30 last:border-0">
                <td className="text-left py-2 pr-3 font-bold text-foreground whitespace-nowrap">{labelFn(k)}</td>
                <td className="text-right py-2 px-2">{s.signals}</td>
                <td className="text-right py-2 px-2">{s.closed}</td>
                <td className="text-right py-2 px-2">{fmtPct(s.win_rate)}</td>
                <td className={`text-right py-2 px-2 font-bold ${tone(s.avg_r)}`}>{fmtR(s.avg_r)}</td>
                <td className={`text-right py-2 px-2 ${tone(s.median_r)}`}>{fmtR(s.median_r)}</td>
                <td className="text-right py-2 px-2">{s.profit_factor == null ? '—' : s.profit_factor.toFixed(2)}</td>
                <td className={`text-right py-2 px-2 ${tone(s.avg_acct)}`}>{signed(s.avg_acct, 2)}</td>
                <td className="text-right py-2 px-2">{fmtPct(s.big_win_rate)}</td>
                <td className="text-right py-2 pl-2">{fmtPct(s.stop_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TrackRecord() {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch(`/track-record.json?t=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => {
        setRecord(j);
        setSource((j.summary?.live?.overall?.closed ?? 0) >= MIN_LIVE_CLOSED ? 'live' : 'backfill');
      })
      .catch(() => setError('No track record yet. It is created by the daily scan.'));
  }, []);

  const signals = useMemo(() => {
    if (!record) return [];
    const q = query.trim().toUpperCase();
    return record.signals
      .filter((s) => s.source === source && (!q || s.ticker.startsWith(q)))
      .sort((a, b) => b.signal_date.localeCompare(a.signal_date) || a.ticker.localeCompare(b.ticker));
  }, [record, source, query]);

  if (error) {
    return <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground">{error}</div>;
  }
  if (!record || !source) {
    return <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground animate-pulse">Loading track record…</div>;
  }

  const sum = record.summary[source];
  const o = sum.overall;
  const live = record.summary.live.overall;
  const firstLive = record.signals.filter((s) => s.source === 'live').map((s) => s.signal_date).sort()[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* HEADER */}
      <div className="bg-card border border-border/80 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <h2 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight flex items-center gap-2.5">
            <BarChart3 className="w-7 h-7 text-primary" /> Track Record
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every qualifying setup is traded mechanically (rules {record.settings.rules_version}). Entry: {record.settings.entry.toLowerCase()}.
            Stop: {record.settings.stop?.toLowerCase()}. Exit: {record.settings.exit.toLowerCase()}.
            {record.settings.signal || `A stock counts as a new signal after ${record.settings.new_signal_lookback} scan days off the list`}.
          </p>
        </div>
        <div className="flex bg-muted/40 border border-border/60 rounded-xl p-1 text-xs font-bold self-stretch md:self-auto">
          {[
            ['live', `Live picks (${live.signals})`],
            ['backfill', `Backfill · simulated (${record.summary.backfill.overall.signals})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setSource(key); setShown(PAGE); }}
              className={`flex-1 px-3 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                source === key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* CAVEATS */}
      {source === 'backfill' ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-800 dark:text-amber-200 flex gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">
              Simulated: today's rules replayed over {record.backfill?.from} to {record.backfill?.to}. Expect these numbers to look better than live results.
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>The rules are price-only; the EPS / revenue growth shown on cards is informational and not part of the tested rules.</li>
              <li>Stocks delisted since then are missing from the universe, and those are mostly failures.</li>
              <li>The rules were selected on 2007–2026 data, so this whole window is in-sample. Run walk-forward, the same selection procedure earned about 2.5%/yr from 2010 to 2026, well below SPY.</li>
              <li>The per-trade stats count every setup as a trade. The account panel applies sizing, cash limits and one position per ticker.</li>
            </ul>
            <div>Use it to compare setups and timing groups, not as proof the system works.</div>
          </div>
        </div>
      ) : (
        live.closed < MIN_LIVE_CLOSED && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-xs text-blue-800 dark:text-blue-200 flex gap-3">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              {firstLive ? `Live tracking started with the ${firstLive} scan. ` : 'Live tracking starts with the next daily scan. '}
              {live.closed} closed so far. Treat results as indicative until there are about 100 closed signals (2–3 months).
            </div>
          </div>
        )
      )}

      {/* HEADLINE STATS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Signals" value={o.signals} sub={`${o.closed} closed · ${o.open} open · ${o.no_entry ?? 0} not triggered`} />
        <StatCard label="Win rate" value={fmtPct(o.win_rate)} sub="Closed trades with R > 0" />
        <StatCard
          label="Avg result"
          value={fmtR(o.avg_r)}
          valueClass={tone(o.avg_r)}
          sub={`Median ${fmtR(o.median_r)} · win ${fmtR(o.avg_win_r)} / loss ${fmtR(o.avg_loss_r)}`}
          title="R = gain or loss in units of the initial risk (entry minus stop). Above 0 means the system makes money following its stops."
        />
        <StatCard label="Profit factor" value={o.profit_factor == null ? '—' : o.profit_factor.toFixed(2)} sub="Total won ÷ total lost (R)" />
        <StatCard
          label="Account / trade"
          value={signed(o.avg_acct, 2)}
          valueClass={tone(o.avg_acct)}
          sub={`1% risk · avg hold ${o.avg_days ?? '—'} days`}
          title="Average account return per closed trade, risking 1% of the account per trade with positions capped at 25%."
        />
        <StatCard
          label="Big winners"
          value={fmtPct(o.big_win_rate)}
          sub={`Triggered ${fmtPct(o.trigger_rate)} · stopped ${fmtPct(o.stop_rate)}`}
          title="Entered trades that gained 30% or more within 60 sessions of entry."
        />
      </div>

      {/* ACCOUNT SIMULATION */}
      <PortfolioPanel portfolio={record.portfolio} source={source} liveOverall={live} />

      {/* BREAKDOWNS */}
      <BreakdownTable title="By setup" groups={sum.by_setup} />
      <BreakdownTable title="By timing status" groups={sum.by_timing} labelFn={(k) => TIMING_LABELS[k] || k} />
      {sum.by_year && <BreakdownTable title="By year" groups={sum.by_year} />}
      <BreakdownTable title="By signal month" groups={sum.by_month} />

      {/* SIGNALS */}
      <div className="bg-card border border-border/80 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-black text-foreground">Signals ({signals.length})</h3>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
            placeholder="Filter ticker…"
            className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground w-full sm:w-48 outline-none focus:border-primary"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/60">
                <th className="text-left font-bold py-2 pr-3">Signal</th>
                <th className="text-left font-bold py-2 px-2">Ticker</th>
                <th className="text-left font-bold py-2 px-2">Setup</th>
                <th className="text-left font-bold py-2 px-2">Timing</th>
                <th className="text-right font-bold py-2 px-2">Entry</th>
                <th className="text-right font-bold py-2 px-2">Stop</th>
                <th className="text-left font-bold py-2 px-2">Status</th>
                <th className="text-right font-bold py-2 px-2">R</th>
                <th className="text-right font-bold py-2 px-2">5d</th>
                <th className="text-right font-bold py-2 px-2">20d</th>
                <th className="text-right font-bold py-2 pl-2" title="Best gain within 60 sessions of entry">Max 60d</th>
              </tr>
            </thead>
            <tbody>
              {signals.slice(0, shown).map((s) => {
                const out = s.outcome || {};
                return (
                  <tr key={`${s.source}|${s.id}`} className="border-b border-border/30 last:border-0">
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{s.signal_date}</td>
                    <td className="py-1.5 px-2 font-bold">
                      <a href={`https://www.tradingview.com/chart/?symbol=${s.ticker}`} target="_blank" rel="noreferrer" className="text-foreground hover:text-primary inline-flex items-center gap-1">
                        {s.ticker}<ExternalLink className="w-3 h-3 opacity-40" />
                      </a>
                    </td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{s.setup_type}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{TIMING_LABELS[s.timing_status] || s.timing_status}</td>
                    <td className="text-right py-1.5 px-2">{out.entry != null ? out.entry.toFixed(2) : '—'}</td>
                    <td className="text-right py-1.5 px-2 whitespace-nowrap">{(out.stop ?? s.stop) != null ? (out.stop ?? s.stop).toFixed(2) : '—'}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{statusText(out)}</td>
                    <td className={`text-right py-1.5 px-2 font-bold ${tone(out.r)} ${out.status === 'open' ? 'opacity-60' : ''}`}>{fmtR(out.r)}</td>
                    <td className={`text-right py-1.5 px-2 ${tone(out.ret_5d)}`}>{signed(out.ret_5d)}</td>
                    <td className={`text-right py-1.5 px-2 ${tone(out.ret_20d)}`}>{signed(out.ret_20d)}</td>
                    <td className={`text-right py-1.5 pl-2 ${tone(out.max_gain)}`}>{signed(out.max_gain)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {signals.length > shown && (
          <button onClick={() => setShown(shown + PAGE)} className="mt-3 w-full text-xs font-bold text-muted-foreground hover:text-foreground py-2 rounded-lg border border-border/60 hover:bg-muted/40 cursor-pointer">
            Show more ({signals.length - shown} remaining)
          </button>
        )}
        <p className="text-[10px] text-muted-foreground mt-3">
          Open trades show R marked to the latest close (faded) and are excluded from the statistics until closed.
          Results ignore commissions and slippage; buy-stop fills at the pivot will slip in practice.
        </p>
      </div>
    </div>
  );
}
