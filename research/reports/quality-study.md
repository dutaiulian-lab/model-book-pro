# Signal-quality study

Generated 2026-10-27 by `research/quality-study.mjs`. Rules 2026-10 (F6c), combo clamp|c50t21, setups 2007-2026, data to 2026-10-05.
Earnings dates (SEC 8-K Item 2.02) cover 958 of 1115 trades (85.9%); uncovered trades are never skipped by an earnings rule.

## Rules

| Rule | Removed | Removed avg R ± SE | Removed 23-26 n / avg R | Kept avg R | CAGR random p10/med/p90 | Med DD | RS + idle SPY CAGR / DD | 2007-16 / 2017-26 CAGR | 2023-26 CAGR |
|---|---|---|---|---|---|---|---|---|---|
| Baseline | – | – | – | +0.455 (n 1115) | 11.8 / 12.3 / 13.7% | 20.5% | 15.1% / 23.2% | 9.3 / 20.9% | 33.8% |
| E-fill0: Earnings gap triggers the fill (reaction on the fill day) | 29 | -0.550 ± 0.269 | 13 / -0.67 | +0.482 (n 1086) | 12.0 / 12.8 / 13.6% | 22.0% | 15.3% / 23.2% | 9.3 / 21.2% | 34.8% |
| E-hold5: Earnings within 5 sessions after the fill (not the fill day) | 91 | +0.627 ± 0.421 | 34 / +0.34 | +0.440 (n 1024) | 8.3 / 9.5 / 10.1% | 26.7% | 12.2% / 26.3% | 7.4 / 17.2% | 33.6% |
| E-hold10: Earnings within 10 sessions after the fill (not the fill day) | 171 | +0.859 ± 0.289 | 69 / +0.95 | +0.382 (n 944) | 6.6 / 7.6 / 8.3% | 25.4% | 10.4% / 26.0% | 7.1 / 13.8% | 27.5% |
| E-0to5: Earnings on the fill day or within 5 sessions after | 120 | +0.342 ± 0.329 | 47 / +0.06 | +0.469 (n 995) | 8.6 / 9.5 / 10.2% | 26.2% | 12.7% / 26.3% | 7.4 / 18.3% | 36.7% |
| E-0to10: Earnings on the fill day or within 10 sessions after | 200 | +0.655 ± 0.252 | 82 / +0.69 | +0.412 (n 915) | 7.0 / 8.1 / 8.8% | 25.8% | 10.8% / 26.0% | 7.2 / 14.6% | 29.5% |
| E-setup7: Earnings within 7 sessions of the setup day (card warning today) | 126 | +0.215 ± 0.284 | 49 / -0.15 | +0.486 (n 989) | 10.2 / 11.0 / 11.6% | 25.7% | 13.7% / 25.6% | 7.7 / 20.3% | 41.9% |
| E-setup15: Earnings within 15 sessions of the setup day | 239 | +0.547 ± 0.218 | 96 / +0.70 | +0.430 (n 876) | 6.8 / 7.5 / 8.2% | 25.3% | 10.9% / 25.6% | 7.2 / 14.8% | 27.9% |
| M-pin1: Deal pin: +15% jump on 4x volume in the last 15 sessions, then avg daily range < 1% | 0 | – ± – | 0 / – | +0.455 (n 1115) | 11.8 / 12.3 / 13.7% | 20.5% | 15.1% / 23.2% | 9.3 / 20.9% | 33.8% |
| M-pin15: Deal pin: same, avg daily range < 1.5% | 1 | -1.100 ± 0.000 | 0 / – | +0.457 (n 1114) | 11.5 / 12.5 / 13.1% | 20.5% | 15.1% / 23.2% | 9.2 / 20.9% | 33.8% |
| M-flat1: Dead tape: 5-day avg daily range < 1% | 2 | +8.464 ± 6.590 | 1 / +17.78 | +0.441 (n 1113) | 11.7 / 12.6 / 13.1% | 20.5% | 15.2% / 23.2% | 9.3 / 21.0% | 33.8% |
| G-gap3: Fill bar opens > 3% above the pivot (gap through the buy stop) | 16 | -0.646 ± 0.436 | 9 / -0.82 | +0.471 (n 1099) | 12.0 / 12.6 / 13.2% | 20.6% | 15.2% / 23.2% | 9.3 / 21.1% | 33.9% |
| G-gap5: Fill bar opens > 5% above the pivot | 9 | -0.160 ± 0.701 | 4 / -0.19 | +0.460 (n 1106) | 11.7 / 12.5 / 13.0% | 22.0% | 15.1% / 23.2% | 9.3 / 20.8% | 33.8% |
| G-gap8: Fill bar opens > 8% above the pivot | 2 | +1.643 ± 1.895 | 1 / +4.32 | +0.453 (n 1113) | 11.4 / 12.5 / 13.4% | 21.8% | 15.1% / 23.2% | 9.3 / 20.9% | 33.8% |
| E-fill0+G-gap3: Earnings-gap fill or open > 3% above the pivot | 39 | -0.549 ± 0.259 | 19 / -0.61 | +0.492 (n 1076) | 12.5 / 12.9 / 13.3% | 20.6% | 15.4% / 23.2% | 9.3 / 21.4% | 34.8% |
| E-fill0+pin: Earnings-gap fill or deal pin | 29 | -0.550 ± 0.269 | 13 / -0.67 | +0.482 (n 1086) | 12.0 / 12.8 / 13.6% | 22.0% | 15.3% / 23.2% | 9.3 / 21.2% | 34.8% |
| R-risk10: Structural risk > 10% (stop clamped well inside the structure) | 267 | +0.986 ± 0.222 | 123 / +0.81 | +0.288 (n 848) | 2.8 / 3.6 / 4.4% | 35.2% | 7.4% / 37.5% | 6.2 / 8.6% | 29.1% |
| R-risk15: Structural risk > 15% | 75 | +1.344 ± 0.533 | 42 / +0.82 | +0.391 (n 1040) | 9.2 / 9.9 / 10.5% | 21.3% | 12.2% / 26.1% | 9.0 / 15.4% | 32.6% |
| X-ext25: Setup close > 25% above the 50-day SMA | 131 | +0.754 ± 0.378 | 63 / +0.97 | +0.415 (n 984) | 7.8 / 8.8 / 9.5% | 19.5% | 12.3% / 23.7% | 9.2 / 15.1% | 24.4% |
| X-ext40: Setup close > 40% above the 50-day SMA | 37 | +0.355 ± 0.714 | 13 / +0.76 | +0.459 (n 1078) | 11.5 / 12.3 / 13.0% | 20.5% | 15.3% / 22.4% | 9.5 / 21.0% | 35.3% |

## Pending setups: distance of the close below the pivot

| Close vs pivot % | Pending closes | Fill later % | Fills | Avg R of those fills |
|---|---|---|---|---|
| -Infinity..-15 | 114 | 0.9 | 1 | -1.04 |
| -15..-10 | 269 | 5.9 | 16 | +0.42 |
| -10..-8 | 291 | 9.6 | 28 | +1.55 |
| -8..-6 | 544 | 14.7 | 80 | +0.63 |
| -6..-4 | 1109 | 31.2 | 346 | +0.52 |
| -4..-2 | 1689 | 49.3 | 832 | +0.38 |
| -2..Infinity | 1282 | 72.9 | 934 | +0.57 |

Filled trades by the last close before the fill:

| Close vs pivot % | Trades | Win | Avg R | Total R |
|---|---|---|---|---|
| -Infinity..-15 | 0 | –% | – | +0 |
| -15..-10 | 5 | 40.0% | -0.132 | -1 |
| -10..-8 | 7 | 28.6% | +2.276 | +16 |
| -8..-6 | 19 | 42.1% | +1.380 | +26 |
| -6..-4 | 94 | 37.2% | +0.661 | +62 |
| -4..-2 | 344 | 30.8% | +0.414 | +142 |
| -2..Infinity | 646 | 29.4% | +0.405 | +261 |

Deal-pin census (buy families, any RS/liquidity, price >= $5, $5M+/day, 2007+): 28 setups, 9 filled, avg R -0.14. Examples: ACVA 2026-09-17 R=nofill; ARX 2026-08-19 R=0.02; ATKR 2026-08-07 R=0.24; AVA 2017-07-27 R=nofill; BFH 2007-05-24 R=nofill; BHF 2025-11-12 R=nofill; BWMN 2026-08-14 R=0.10; CBZ 2026-08-04 R=nofill; CMBT 2023-10-13 R=nofill; DSGR 2026-07-22 R=nofill; FUN 2009-12-23 R=-0.36; FUN 2009-12-31 R=nofill; HUN 2007-07-02 R=-1.10; HZO 2026-08-14 R=nofill; INHD 2026-06-15 R=nofill; ITGR 2026-08-07 R=nofill; MKTX 2026-08-05 R=nofill; OGN 2026-05-01 R=0.67; PRTH 2026-09-25 R=nofill; RAMP 2026-05-22 R=nofill; ROG 2021-11-08 R=nofill; SAFT 2026-07-30 R=0.03; STAA 2025-08-11 R=-1.09; TECH 2026-07-01 R=nofill; TSEM 2022-02-22 R=nofill; UTZ 2026-07-27 R=0.23; VREX 2026-08-14 R=nofill; WEAV 2026-08-24 R=nofill.

## Watchlist band and tracked families

- Liquidity rank 70-85 (today's watchlist band), same rules: 957 trades, avg R +0.203 ± 0.083; 2023-26 316 / +0.172. Added to the buy rules: CAGR med 9.3% (base 12.3%), RS+SPY 11.8% / DD 42.6%.
- High Tight Flags, same rules: 164 trades, avg R +0.550 ± 0.274; 2023-26 94 / +0.434. Added: CAGR med 13.4%, RS+SPY 15.7% / DD 23.8%.

## Adopted package

HTF + earnings-session skip + gap limit 3% + deal pin: 1229 trades, avg R +0.499 (2023-26 466 / +0.765); removed 50 at -0.313. CAGR random p10/med/p90 12.7 / 13.7 / 14.7%, med DD 21.5%; RS + idle SPY 15.8% / DD 23.8%; 2007-16 / 2017-26 9.2 / 22.3%; 2023-26 35.4%.
