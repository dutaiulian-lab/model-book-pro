// Unit tests for the configurable trade model in lib/leader-rules.mjs.
//   node scripts/test-leader-rules.mjs
import assert from 'assert';
import { initialStop, simulateTrade, regimeOn, RULES, idleCashByDate, classify, marketContext, CONTEXT } from './lib/leader-rules.mjs';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

test('initialStop types (fill 100)', () => {
    assert(near(initialStop(100, 90, 'clamp'), 92));      // 10% structural -> clamped to 8%
    assert(near(initialStop(100, 98, 'clamp'), 97));      // 2% structural -> widened to 3%
    assert(near(initialStop(100, 90, 'struct'), 90));
    assert(near(initialStop(100, 98, 'min5'), 95));       // at least 5% away
    assert(near(initialStop(100, 90, 'min5'), 90));
    assert(near(initialStop(100, 90, 'fix7'), 93));
    assert(near(initialStop(100, 90, 'fix10'), 90));
    assert(Number.isNaN(initialStop(100, 101, 'struct'))); // not a valid long stop
});

// 60 flat bars at 100 (signal on bar 59, pivot 101, structural stop 95), a
// breakout bar 60 (open 101, high 103, close 102), then `path` closes with
// open = close, high = +1%, low = -1%. Moving averages are constants.
function series(path, { sma50 = 99, ema21 = 99, sma10 = 99 } = {}) {
    const c = [...Array(60).fill(100), 102, ...path];
    const N = c.length;
    const S = {
        n: N, c: Float64Array.from(c), o: Float64Array.from(c), h: Float64Array.from(c, x => x * 1.01), l: Float64Array.from(c, x => x * 0.99),
        sma50: new Float64Array(N).fill(sma50), ema21: new Float64Array(N).fill(ema21), sma10: new Float64Array(N).fill(sma10),
    };
    S.o[60] = 101; S.h[60] = 103; S.l[60] = 100.5;
    return S;
}
const SIG = 59, PIVOT = 101, STRUCT = 95;
const P = 101, STOP7 = P * 0.93, RISK7 = P - STOP7;
const R = (x) => (x - P) / RISK7;

test('entry at the pivot on the breakout bar, fix7 stop', () => {
    const tr = simulateTrade(series([105]), SIG, PIVOT, STRUCT, 'TIGHT', 'c50', 'fix7');
    assert.equal(tr.eb, 60);
    assert(near(tr.entry, P));
    assert(near(tr.stop, STOP7));
    assert.equal(tr.status, 'open');
});

test('c50: first close below the 50-day', () => {
    const tr = simulateTrade(series([105, 110, 98.5]), SIG, PIVOT, STRUCT, 'TIGHT', 'c50', 'fix7');
    assert.equal(tr.status, 'closed');
    assert.equal(tr.reason, 'sma50');
    assert(near(tr.exit, 98.5));
    assert(near(tr.r, R(98.5)));
});

test('c50t21: switches to the 21-day EMA after a close 20% above the fill', () => {
    const path = [110, 122, 118, 112];
    const tr = simulateTrade(series(path, { ema21: 115 }), SIG, PIVOT, STRUCT, 'TIGHT', 'c50t21', 'fix7');
    assert.equal(tr.reason, 'ema21');
    assert(near(tr.exit, 112));
    assert(near(tr.r, R(112)));
    const tr2 = simulateTrade(series(path, { ema21: 115 }), SIG, PIVOT, STRUCT, 'TIGHT', 'c50', 'fix7');
    assert.equal(tr2.status, 'open'); // plain c50 is still holding
});

test('c50be: stop moves to breakeven at +2R', () => {
    // bar 62 high 118.17 >= 101 + 2R -> stop 101; bar 63 low 99.5 <= 101 -> out at the open 100.5
    const tr = simulateTrade(series([110, 117, 100.5]), SIG, PIVOT, STRUCT, 'TIGHT', 'c50be', 'fix7');
    assert.equal(tr.reason, 'stop');
    assert(near(tr.exit, 100.5));
    assert(near(tr.r, R(100.5)));
});

test('c50part: sells 1/3 at +3R, rest stopped at breakeven (gap below)', () => {
    // bar 62 opens 124 above +3R (122.21): partial at 124; bar 63 opens 98 below the breakeven stop.
    const tr = simulateTrade(series([115, 124, 98]), SIG, PIVOT, STRUCT, 'TIGHT', 'c50part', 'fix7');
    assert.equal(tr.reason, 'stop');
    assert.equal(tr.partial, true);
    assert(near(tr.r, R(124) / 3 + R(98) * 2 / 3));
    assert(near(tr.ret, tr.r * RISK7 / P * 100));
});

test('t20: time exit after 20 sessions, ignores moving averages', () => {
    const tr = simulateTrade(series(Array(25).fill(105), { sma50: 200 }), SIG, PIVOT, STRUCT, 'TIGHT', 't20', 'fix7');
    assert.equal(tr.reason, 'time');
    assert.equal(tr.xj, 60 + 19);
    assert(near(tr.r, R(105)));
});

test('c10 and c21 use the 10-day SMA / 21-day EMA', () => {
    const a = simulateTrade(series([110, 103], { sma10: 104 }), SIG, PIVOT, STRUCT, 'TIGHT', 'c10', 'fix7');
    assert.equal(a.reason, 'sma10'); assert(near(a.exit, 103));
    const b = simulateTrade(series([110, 103], { ema21: 104 }), SIG, PIVOT, STRUCT, 'TIGHT', 'c21', 'fix7');
    assert.equal(b.reason, 'ema21'); assert(near(b.exit, 103));
});

test('entry day: only a close below the stop counts', () => {
    const S = series([105]);
    S.l[60] = 90; // intraday below the stop, close above: still in
    assert.equal(simulateTrade(S, SIG, PIVOT, STRUCT, 'TIGHT', 'c50', 'fix7').status, 'open');
    S.c[60] = 93; // close below the 93.93 stop: out at the close
    const tr = simulateTrade(S, SIG, PIVOT, STRUCT, 'TIGHT', 'c50', 'fix7');
    assert.equal(tr.reason, 'stop'); assert(near(tr.exit, 93));
});

test('clamp stop uses the lowest low while waiting (non-coil)', () => {
    // Breakout only on bar 62; bar 61 low 98.01 -> struct min(95, 98.01*0.995) = 95 stays; clamp 3-8% of 101.
    const S = series([99, 102]);
    S.h[60] = 100.5; S.c[60] = 100; S.o[60] = 100; S.l[60] = 99; // no breakout on bar 60
    const tr = simulateTrade(S, SIG, PIVOT, STRUCT, 'TIGHT', 'c50', 'clamp');
    assert.equal(tr.eb, 62);
    assert(near(tr.stop, initialStop(Math.max(S.o[62], PIVOT), 95, 'clamp')));
});

test('no entry / pending', () => {
    assert.equal(simulateTrade(series(Array(10).fill(100)), SIG, 200, STRUCT, 'TIGHT', 'c50', 'fix7').status, 'no_entry');
    assert.equal(simulateTrade(series([100, 100]), SIG, 200, STRUCT, 'TIGHT', 'c50', 'fix7').status, 'pending');
});

test(`regime filter (${RULES.regime})`, () => {
    assert.equal(regimeOn({ spy200: true, spy50: true, breadth: 60 }), true);
    if (RULES.regime === 'spy200') {
        assert.equal(regimeOn({ spy200: false, spy50: true, breadth: 60 }), false);
        assert.equal(regimeOn(false), false); // legacy boolean
    }
});

test('idle cash: SPY 200-day with a 3% band', () => {
    const closes = [...Array(199).fill(100), 101, 98, 95, 102, 105];
    const dates = closes.map((_, k) => `d${String(k).padStart(3, '0')}`);
    const st = idleCashByDate(dates, closes, { mode: 'spy200band', band: 3 });
    assert.equal(st.get('d198').on, false);   // < 200 sessions: no SMA yet
    assert.equal(st.get('d199').on, true);    // first state: above the SMA
    assert.equal(st.get('d200').on, true);    // -2%: inside the band, stays in SPY
    assert.equal(st.get('d201').on, false);   // -5%: to cash
    assert.equal(st.get('d202').on, false);   // +2%: inside the band, stays in cash
    assert.equal(st.get('d203').on, true);    // +5%: back to SPY
    assert(near(st.get('d203').vs200, (105 / ((195 * 100 + 101 + 98 + 95 + 102 + 105) / 200) - 1) * 100));
    assert.equal(idleCashByDate(dates, closes, { mode: 'always' }).get('d000').on, true);
    assert.equal(idleCashByDate(dates, closes, { mode: 'none' }).get('d203').on, false);
});

test('market context: state boundaries (rules.json context)', () => {
    const spy = (v) => classify(CONTEXT.spy200, v)?.state;
    assert.equal(spy(-5), 'downtrend');
    assert.equal(spy(0), 'testing');      // lower bound inclusive
    assert.equal(spy(2.99), 'testing');
    assert.equal(spy(3), 'uptrend');
    assert.equal(spy(9.9), 'uptrend');
    assert.equal(spy(10), 'extended');
    assert.equal(spy(40), 'extended');
    const br = (v) => classify(CONTEXT.breadth, v)?.state;
    assert.equal(br(5), 'washed_out');
    assert.equal(br(20), 'weak');
    assert.equal(br(39.9), 'weak');
    assert.equal(br(40), 'mixed');
    assert.equal(br(60), 'healthy');
    assert.equal(br(80), 'strong');
    assert.equal(classify(CONTEXT.breadth, NaN), null);
});

test('market context: narrow market and breadth thrust flags', () => {
    const ids = (c) => c.flags.map(f => f.id).sort().join(',');
    const flat = (v, len = 31) => Array(len).fill(v);
    // SPY +6.8%, breadth 27.5% -> narrow market.
    let c = marketContext(6.8, [...flat(50, 30), 27.5]);
    assert.equal(c.spy.state, 'uptrend');
    assert.equal(c.breadth.state, 'weak');
    assert(near(c.breadth.change10, -22.5));
    assert.equal(ids(c), 'narrow');
    assert.equal(ids(marketContext(4.9, [...flat(50, 30), 27.5])), '');   // SPY not strong enough
    assert.equal(ids(marketContext(6.8, flat(40))), '');                  // breadth not below 40
    // Thrust: 18% -> 62% within 10 sessions, 5 sessions ago.
    const th = [...flat(18, 20), 30, 45, 55, 62, 64, 63, 61, 60, 59, 58, 57];
    c = marketContext(4, th);
    assert.equal(ids(c), 'thrust');
    assert.equal(c.flags[0].sessions_ago, 7);
    // Too slow: the low is 11+ sessions before reaching 60.
    assert.equal(ids(marketContext(4, [...flat(18, 10), 25, 30, 35, 40, 45, 50, 52, 54, 56, 58, 59, 61, ...flat(61, 9)])), '');
    // Thrust older than the display window (20 sessions) is no longer shown.
    assert.equal(ids(marketContext(4, [...flat(18, 5), 62, ...flat(65, 25)])), '');
});

console.log(`\nAll ${n} tests passed.`);
