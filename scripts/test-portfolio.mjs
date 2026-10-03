// Hand-checked tests for scripts/lib/portfolio.mjs. Run: node scripts/test-portfolio.mjs
import assert from 'assert/strict';
import { simulatePortfolio } from './lib/portfolio.mjs';

const spy = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09']
    .map((date, i) => ({ date, close: 100 + i, adjclose: 100 + i }));
const sig = (ticker, signal_date, entry_date, risk_pct, path, status, rs_rank = 95) => ({
    id: `${ticker}|${signal_date}`, ticker, signal_date, rs_rank, source: 'backfill',
    outcome: { status, entry_date, risk_pct, path },
});

// Two overlapping trades.
//  A: fills day 2, 5% risk -> 20% of 100k = 20,000. Closes day 4 at -5% -> 19,000.
//  B: fills day 3, 2% risk -> min(50%, 25% cap) of equity 100,000 = 25,000. Open, +20% -> 30,000.
//  Day 3 equity = 55,000 cash + 22,000 (A +10%) + 26,000 (B +4%) = 103,000.
//  Day 4 equity = 74,000 cash + 30,000 = 104,000, then flat.
{
    const r = simulatePortfolio([
        sig('AAA', '2025-01-02', '2025-01-03', 5, [0, 10, -5], 'closed'),
        sig('BBB', '2025-01-03', '2025-01-06', 2, [4, 20], 'open'),
    ], spy);
    assert.deepEqual(r.daily.equity, [100, 100, 103, 104, 104, 104]);
    assert.deepEqual(r.daily.spy, [100, 101, 102, 103, 104, 105]);
    assert.equal(r.stats.total_return, 4);
    assert.equal(r.stats.spy_total_return, 5);
    assert.equal(r.stats.max_dd, 0);
    assert.equal(r.stats.trades_taken, 2);
    assert.equal(r.stats.max_positions, 2);
    assert.equal(r.stats.top5_share, 100);
    assert.deepEqual(r.stats.top5.map(x => [x.ticker, x.pnl, x.open]), [['BBB', 5000, true], ['AAA', -1000, false]]);
    assert.equal(r.stats.cagr, null); // window too short to annualize
    assert.equal(r.daily.exposure[2], round1(48000 / 103000 * 100));
}

// Cash limits: positions capped at 60%, tiny risk so each wants 60% of equity.
//  1st (RS 99) takes 60,000. 2nd (RS 97) wants 60,000, cash 40,000 >= half -> resized.
//  3rd (RS 90) gets nothing -> skipped. A 4th on a ticker already held is skipped too.
{
    const r = simulatePortfolio([
        sig('LOW', '2025-01-02', '2025-01-03', 0.5, [0], 'open', 90),
        sig('TOP', '2025-01-02', '2025-01-03', 0.5, [0], 'open', 99),
        sig('MID', '2025-01-02', '2025-01-03', 0.5, [0], 'open', 97),
        sig('TOP', '2025-01-03', '2025-01-06', 0.5, [0], 'open', 99),
    ], spy, { MAX_POS_PCT: 60 });
    assert.equal(r.stats.trades_taken, 2);
    assert.equal(r.stats.resized, 1);
    assert.equal(r.stats.skipped_cash, 1);
    assert.equal(r.stats.skipped_held, 1);
    assert.equal(r.daily.exposure[1], 100);
}

// Drawdown is measured on marked equity, not only on closed trades.
//  One open trade, 25% position, path 0, -40, -20: equity 100, 90, 95 -> max DD 10%.
{
    const r = simulatePortfolio([sig('DD', '2025-01-02', '2025-01-03', 1, [0, -40, -20], 'open')], spy);
    assert.deepEqual(r.daily.equity.slice(1, 4), [100, 90, 95]);
    assert.equal(r.stats.max_dd, 10);
}

// Idle cash in SPY: one 20% position (flat path); the other 80% of equity is
// parked in SPY (+1/session) from the session after an "on" close.
//  Day 1: fill 20,000, cash 80,000 x 101/100 = 80,800 -> 100,800.
//  Day 5: cash 80,000 x 105/100 = 84,000 -> 104,000.
{
    const idle = new Map(spy.map(b => [b.date, { on: true }]));
    const r = simulatePortfolio([sig('IDL', '2025-01-02', '2025-01-03', 5, [0], 'open')], spy, { idle });
    assert.deepEqual(r.daily.equity, [100, 100.8, 101.6, 102.4, 103.2, 104]);
    assert.equal(r.daily.spy_share[1], round1(80800 / 100800 * 100));
    // Off on the day-2 close: day 3 earns nothing on cash.
    idle.set('2025-01-06', { on: false });
    const r2 = simulatePortfolio([sig('IDL', '2025-01-02', '2025-01-03', 5, [0], 'open')], spy, { idle });
    assert.equal(r2.daily.equity[3], r2.daily.equity[2]);
}

function round1(x) { return Number(x.toFixed(1)); }
console.log('portfolio tests passed');
