# Study: cancel a pending buy stop after a breaking close

Generated 2026-10-15 by `research/cancel-study.mjs`. Data 2005-01-03 to 2026-10-05.
Rules: 2026-10 (F6c): RANGE+TIGHT+BASE · spy200 · RS >= 90 · liquidity top 15% and >= $10M · >= +100% off 52w low · <= 35% off 52w high · stop clamp · exit c50t21; buy stop at the pivot for 5 sessions.

Cancel rule (checked on the close of each session after the setup day while the order is pending; a trigger on bar m counts only if no cancelling close on bars s+1..m-1, since the intraday trigger precedes the close):

- A: close < setup-day struct stop
- A-r: close < ratcheted struct stop
- B: close < 50-day SMA
- C: A or B
- C-r: A-r or B
- D: close > 10% below pivot

Trade stats by setup year 2007-2026 (as in the restudy report), 0.3% round-trip costs. A cancelled order frees the 10-session no-retrigger lock, so a few later setups can appear ("added").

## Sanity check

| Source | Trades | Win | Avg R |
|---|---|---|---|
| Published (restudy-2026-10-06, current F6b = F6c buy rules) | 1115 | 30.8% | +0.455 |
| research/lib.mjs on events.bin | 1115 | 30.8% | +0.455 |
| Regenerated baseline (patched builder, no cancel) | 1115 | 30.8% | +0.455 |

Regenerated vs events.bin, all years, live filter: 1137 vs 1137 trades; only in events.bin 0, only regenerated 0, different R/entry/exit 0.
Published account: CAGR p10/median/p90 11.7 / 12.5 / 13.2%, median max DD 21.8%; here (baseline, 40 seeded orderings): 11.8 / 12.5 / 13.7%, 21.8%.

## Trades, 2007-2026 and 2023-2026

| Variant | Trades | Win | Avg R | Total R | 2023-26 trades | Win | Avg R | Total R |
|---|---|---|---|---|---|---|---|---|
| Baseline (no cancel) | 1115 | 30.8% | +0.455 | +508 | 397 | 32.7% | +0.757 | +300 |
| A: close < setup-day struct stop | 1061 | 31.1% | +0.476 | +505 | 376 | 33.5% | +0.789 | +297 |
| A-r: close < ratcheted struct stop | 1064 | 31.0% | +0.472 | +502 | 377 | 33.4% | +0.786 | +296 |
| B: close < 50-day SMA | 1105 | 30.9% | +0.452 | +499 | 394 | 33.0% | +0.764 | +301 |
| C: A or B | 1054 | 31.2% | +0.472 | +498 | 374 | 33.7% | +0.794 | +297 |
| C-r: A-r or B | 1056 | 31.2% | +0.470 | +496 | 374 | 33.7% | +0.794 | +297 |
| D: close > 10% below pivot | 1102 | 30.9% | +0.452 | +498 | 389 | 33.2% | +0.746 | +290 |

## Removed trades (the key number)

Baseline avg R: +0.455 (2023-26: +0.757). If removed trades average >= baseline, the rule hurts.

| Variant | Removed | Removed avg R (± SE) | Removed win | Removed total R | 2023-26 removed / avg R | Blocked / avg R | Added / avg R | Verdict |
|---|---|---|---|---|---|---|---|---|
| A: close < setup-day struct stop | 56 | +0.013 (± 0.331) | 23.2% | +1 | 21 / +0.180 | 0 / – | 2 / -1.07 | removed trades below baseline, within noise (< 2 SE) |
| A-r: close < ratcheted struct stop | 53 | +0.062 (± 0.348) | 24.5% | +3 | 20 / +0.213 | 0 / – | 2 / -1.07 | removed trades below baseline, within noise (< 2 SE) |
| B: close < 50-day SMA | 12 | +0.649 (± 0.841) | 25.0% | +8 | 4 / -0.103 | 0 / – | 2 / -0.43 | hurts: removed trades avg >= baseline |
| C: A or B | 64 | +0.121 (± 0.327) | 23.4% | +8 | 24 / +0.160 | 0 / – | 3 / -0.65 | removed trades below baseline, within noise (< 2 SE) |
| C-r: A-r or B | 62 | +0.159 (± 0.336) | 24.2% | +10 | 24 / +0.160 | 0 / – | 3 / -0.65 | removed trades below baseline, within noise (< 2 SE) |
| D: close > 10% below pivot | 13 | +0.751 (± 1.364) | 23.1% | +10 | 8 / +1.277 | 0 / – | 0 / – | hurts: removed trades avg >= baseline |

Removed trades by family (2007-2026), n / avg R:

| Variant | RANGE | TIGHT | BASE |
|---|---|---|---|
| A: close < setup-day struct stop | 29 / +0.04 | 24 / +0.11 | 3 / -1.04 |
| A-r: close < ratcheted struct stop | 29 / +0.04 | 21 / +0.25 | 3 / -1.04 |
| B: close < 50-day SMA | 5 / -0.29 | 6 / +1.64 | 1 / -0.58 |
| C: A or B | 31 / -0.05 | 29 / +0.45 | 4 / -0.92 |
| C-r: A-r or B | 31 / -0.05 | 27 / +0.56 | 4 / -0.92 |
| D: close > 10% below pivot | 4 / -1.02 | 3 / -0.37 | 6 / +2.49 |

## Account

1% risk per trade, positions capped at 25%, one position per ticker, cash-limited, realized equity (drawdowns understated). "Random" = 40 seeded random orderings of same-day signals (restudy convention); "RS order" = strongest RS first; "idle SPY" = rules.json idleCash (SPY above its 200-day, 3% band; conservative / optimistic funding).

| Variant | CAGR random p10 / med / p90 | Med max DD | RS order: CAGR / DD | Idle SPY cons.: CAGR / DD | Idle SPY opt. CAGR | 2023-26 CAGR cash / idle SPY | 2023-26 DD cash |
|---|---|---|---|---|---|---|---|
| Baseline (no cancel) | 11.8 / 12.5 / 13.7% | 21.8% | 12.6% / 22.0% | 15.4% / 23.2% | 16.8% | 29.9% / 33.8% | 14.9% |
| A: close < setup-day struct stop | 11.2 / 12.1 / 12.7% | 22.1% | 12.1% / 22.6% | 15.5% / 24.5% | 16.0% | 29.2% / 36.3% | 13.7% |
| A-r: close < ratcheted struct stop | 10.9 / 11.9 / 12.6% | 22.1% | 12.0% / 22.9% | 15.4% / 25.1% | 16.0% | 29.0% / 36.0% | 13.7% |
| B: close < 50-day SMA | 11.0 / 11.8 / 12.7% | 23.8% | 11.8% / 23.6% | 14.7% / 26.2% | 16.1% | 30.1% / 33.9% | 14.6% |
| C: A or B | 10.8 / 11.7 / 12.4% | 22.9% | 11.6% / 22.6% | 14.9% / 25.7% | 15.5% | 29.2% / 36.1% | 13.7% |
| C-r: A-r or B | 10.8 / 11.6 / 12.4% | 22.9% | 11.5% / 22.6% | 14.9% / 25.7% | 15.5% | 29.2% / 36.1% | 13.7% |
| D: close > 10% below pivot | 11.2 / 11.8 / 12.6% | 22.1% | 11.9% / 22.1% | 14.7% / 23.2% | 16.0% | 26.6% / 30.2% | 14.6% |

## Per year

Trades n / avg R / total R by setup year:

| Year | Baseline | A | Ar | B | C | Cr | D |
|---|---|---|---|---|---|---|---|
| 2007 | 72 / +0.75 / +54 | 69 / +0.72 / +50 | 69 / +0.72 / +50 | 72 / +0.75 / +54 | 69 / +0.72 / +50 | 69 / +0.72 / +50 | 72 / +0.75 / +54 |
| 2008 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2009 | 16 / +0.02 / +0 | 16 / +0.02 / +0 | 16 / +0.02 / +0 | 16 / +0.02 / +0 | 16 / +0.02 / +0 | 16 / +0.02 / +0 | 16 / +0.02 / +0 |
| 2010 | 45 / +0.74 / +33 | 42 / +0.84 / +35 | 42 / +0.84 / +35 | 44 / +0.78 / +34 | 42 / +0.84 / +35 | 42 / +0.84 / +35 | 45 / +0.74 / +33 |
| 2011 | 25 / -0.78 / -20 | 25 / -0.78 / -20 | 25 / -0.78 / -20 | 25 / -0.78 / -20 | 25 / -0.78 / -20 | 25 / -0.78 / -20 | 25 / -0.78 / -20 |
| 2012 | 23 / +0.65 / +15 | 22 / +0.73 / +16 | 23 / +0.65 / +15 | 22 / +0.71 / +16 | 21 / +0.79 / +17 | 22 / +0.71 / +16 | 23 / +0.65 / +15 |
| 2013 | 55 / +0.28 / +16 | 52 / +0.36 / +19 | 52 / +0.36 / +19 | 54 / +0.29 / +16 | 51 / +0.37 / +19 | 51 / +0.37 / +19 | 55 / +0.28 / +16 |
| 2014 | 70 / +0.19 / +13 | 64 / +0.27 / +17 | 64 / +0.27 / +17 | 70 / +0.19 / +13 | 64 / +0.27 / +17 | 64 / +0.27 / +17 | 70 / +0.19 / +13 |
| 2015 | 16 / +0.57 / +9 | 14 / +0.41 / +6 | 14 / +0.41 / +6 | 15 / +0.63 / +9 | 13 / +0.46 / +6 | 13 / +0.46 / +6 | 16 / +0.57 / +9 |
| 2016 | 13 / +0.11 / +1 | 10 / +0.45 / +4 | 10 / +0.45 / +4 | 13 / +0.11 / +1 | 10 / +0.45 / +4 | 10 / +0.45 / +4 | 13 / +0.11 / +1 |
| 2017 | 69 / +0.06 / +4 | 67 / +0.04 / +3 | 67 / +0.04 / +3 | 68 / +0.08 / +5 | 66 / +0.06 / +4 | 66 / +0.06 / +4 | 69 / +0.06 / +4 |
| 2018 | 44 / -0.12 / -5 | 43 / -0.10 / -4 | 43 / -0.10 / -4 | 44 / -0.12 / -5 | 43 / -0.10 / -4 | 43 / -0.10 / -4 | 44 / -0.12 / -5 |
| 2019 | 56 / +0.21 / +12 | 54 / +0.18 / +10 | 54 / +0.18 / +10 | 54 / -0.01 / -0 | 53 / +0.01 / +1 | 53 / +0.01 / +1 | 56 / +0.21 / +12 |
| 2020 | 105 / +1.12 / +118 | 104 / +1.06 / +111 | 104 / +1.06 / +111 | 105 / +1.12 / +118 | 104 / +1.06 / +111 | 104 / +1.06 / +111 | 101 / +1.16 / +117 |
| 2021 | 98 / -0.34 / -34 | 93 / -0.32 / -30 | 94 / -0.33 / -31 | 98 / -0.34 / -34 | 93 / -0.32 / -30 | 94 / -0.33 / -31 | 97 / -0.34 / -33 |
| 2022 | 11 / -0.89 / -10 | 10 / -0.87 / -9 | 10 / -0.87 / -9 | 11 / -0.89 / -10 | 10 / -0.87 / -9 | 10 / -0.87 / -9 | 11 / -0.89 / -10 |
| 2023 | 79 / +1.12 / +89 | 73 / +1.19 / +87 | 74 / +1.17 / +87 | 78 / +1.14 / +89 | 73 / +1.19 / +87 | 73 / +1.19 / +87 | 78 / +1.15 / +90 |
| 2024 | 133 / +0.59 / +79 | 126 / +0.61 / +77 | 126 / +0.61 / +77 | 131 / +0.59 / +77 | 124 / +0.61 / +75 | 124 / +0.61 / +75 | 130 / +0.63 / +82 |
| 2025 | 102 / +0.78 / +79 | 98 / +0.77 / +75 | 98 / +0.77 / +75 | 102 / +0.78 / +79 | 98 / +0.77 / +75 | 98 / +0.77 / +75 | 101 / +0.61 / +62 |
| 2026 | 83 / +0.65 / +54 | 79 / +0.73 / +57 | 79 / +0.73 / +57 | 83 / +0.67 / +55 | 79 / +0.75 / +59 | 79 / +0.75 / +59 | 80 / +0.71 / +57 |

Removed trades n / avg R by setup year:

| Year | A | Ar | B | C | Cr | D |
|---|---|---|---|---|---|---|
| 2007 | 3 / +1.50 | 3 / +1.50 | 0 | 3 / +1.50 | 3 / +1.50 | 0 |
| 2008 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2009 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2010 | 3 / -0.59 | 3 / -0.59 | 1 / -0.74 | 3 / -0.59 | 3 / -0.59 | 0 |
| 2011 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2012 | 1 / -1.04 | 0 | 1 / -0.58 | 2 / -0.81 | 1 / -0.58 | 0 |
| 2013 | 3 / -1.08 | 3 / -1.08 | 1 / -0.17 | 4 / -0.85 | 4 / -0.85 | 0 |
| 2014 | 6 / -0.70 | 6 / -0.70 | 0 | 6 / -0.70 | 6 / -0.70 | 0 |
| 2015 | 2 / +1.74 | 2 / +1.74 | 1 / -0.31 | 3 / +1.06 | 3 / +1.06 | 0 |
| 2016 | 3 / -1.00 | 3 / -1.00 | 0 | 3 / -1.00 | 3 / -1.00 | 0 |
| 2017 | 2 / +0.74 | 2 / +0.74 | 1 / -1.08 | 3 / +0.13 | 3 / +0.13 | 0 |
| 2018 | 1 / -1.07 | 1 / -1.07 | 0 | 1 / -1.07 | 1 / -1.07 | 0 |
| 2019 | 2 / +0.99 | 2 / +0.99 | 2 / +6.08 | 3 / +3.70 | 3 / +3.70 | 0 |
| 2020 | 2 / +2.92 | 2 / +2.92 | 0 | 2 / +2.92 | 2 / +2.92 | 4 / +0.11 |
| 2021 | 6 / -0.83 | 5 / -0.78 | 1 / -1.06 | 6 / -0.83 | 5 / -0.78 | 1 / -0.89 |
| 2022 | 1 / -1.04 | 1 / -1.04 | 0 | 1 / -1.04 | 1 / -1.04 | 0 |
| 2023 | 6 / +0.23 | 5 / +0.37 | 1 / -0.47 | 6 / +0.23 | 6 / +0.23 | 1 / -1.04 |
| 2024 | 7 / +0.33 | 7 / +0.33 | 2 / +0.83 | 9 / +0.44 | 9 / +0.44 | 3 / -1.06 |
| 2025 | 4 / +0.95 | 4 / +0.95 | 0 | 4 / +0.95 | 4 / +0.95 | 1 / +17.54 |
| 2026 | 4 / -0.92 | 4 / -0.92 | 1 / -1.61 | 5 / -1.06 | 5 / -1.06 | 3 / -1.04 |

Account return by calendar year (RS order, idle cash in cash), %:

| Year | Baseline | A | Ar | B | C | Cr | D |
|---|---|---|---|---|---|---|---|
| 2007 | +17.9 | +20.8 | +20.8 | +17.9 | +20.8 | +20.8 | +17.9 |
| 2008 | +4.2 | -1.6 | -1.6 | +4.2 | -1.6 | -1.6 | +4.2 |
| 2009 | +1.5 | +1.5 | +1.5 | +1.5 | +1.5 | +1.5 | +1.5 |
| 2010 | +6.6 | +3.5 | +3.5 | +6.6 | +3.5 | +3.5 | +6.6 |
| 2011 | -13.3 | -10.5 | -10.5 | -13.3 | -10.5 | -10.5 | -13.3 |
| 2012 | +11.7 | +12.8 | +11.7 | +12.4 | +13.5 | +12.4 | +11.7 |
| 2013 | +0.6 | +1.4 | +1.4 | +0.8 | +1.6 | +1.6 | +0.6 |
| 2014 | +9.6 | +9.4 | +9.4 | +9.6 | +9.4 | +9.4 | +9.6 |
| 2015 | +15.4 | +17.4 | +17.4 | +15.7 | +17.7 | +17.7 | +15.4 |
| 2016 | -6.5 | -6.5 | -6.5 | -6.5 | -6.5 | -6.5 | -6.5 |
| 2017 | +18.2 | +20.5 | +20.5 | +18.2 | +20.5 | +20.5 | +18.2 |
| 2018 | -3.4 | -2.4 | -2.4 | -3.4 | -2.4 | -2.4 | -3.4 |
| 2019 | -14.5 | -16.9 | -16.9 | -18.6 | -17.8 | -17.8 | -14.5 |
| 2020 | +97.3 | +92.6 | +92.6 | +79.9 | +75.6 | +75.6 | +94.3 |
| 2021 | +39.7 | +35.0 | +35.0 | +39.8 | +35.0 | +35.0 | +38.3 |
| 2022 | -5.8 | -5.8 | -5.8 | -5.8 | -5.8 | -5.8 | -5.8 |
| 2023 | +0.8 | -1.0 | -1.5 | +1.3 | -1.0 | -1.0 | +1.9 |
| 2024 | +28.8 | +23.0 | +23.0 | +28.7 | +23.0 | +23.0 | +30.0 |
| 2025 | +63.1 | +66.6 | +66.6 | +63.1 | +66.6 | +66.6 | +41.1 |
| 2026 | +25.6 | +28.3 | +28.3 | +25.7 | +28.3 | +28.3 | +29.3 |

## Method notes

- No look-ahead: cancellation uses only closes of bars s+1..m-1 for a fill on bar m; the 50-day SMA at bar k includes the close of k (known when the cancel decision is made, after the close). The ratcheted stop at bar m uses lows of s+1..m-1 only.
- The patched builder is research/build-events.mjs itself (text patches asserted to match exactly once); see the reproduction line above.
- In-sample comparison (2007-2026, same filters as live). Survivorship bias as in the restudy report.
