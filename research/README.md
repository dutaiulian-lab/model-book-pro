# Rule research

The daily screener's rules (`scripts/lib/rules.json`, implemented in
`scripts/lib/leader-rules.mjs`) are chosen here, and re-chosen every year.

```
node research/restudy.mjs [--fetch] [--apply] [--year=YYYY] [--skip-build]
```

| Step | Script | Output (`research/data/`, not committed) |
|---|---|---|
| Daily bars 2005+ for every US stock that was ever liquid | `fetch-data.mjs` | `cache.bin` (~350 MB, ~5 min) |
| Every setup of 7 families 2006+, features, outcome for 35 stop x exit plans | `build-events.mjs` | `events.bin` |
| Per family set: 3,456 filter combinations x 35 exits x year | `grid.mjs <i>` | `grid_<i>.bin` |
| Walk-forward pick for one year (trained on earlier years only) | `select.mjs <year>` | `select_live_<year>.json` |
| Report + proposal | `restudy.mjs` | `research/reports/restudy-<date>.md/.json` |

The yearly GitHub workflow (`.github/workflows/yearly-restudy.yml`, 3 January,
or run it by hand) runs `restudy.mjs --fetch --apply` and opens a pull request
with the report and, when the procedure picks different rules, the new
`rules.json`. Merging it switches the live screener; the daily workflow then
rebuilds the simulated track record with the new rules.

## Survivorship bias

Yahoo only serves stocks that still trade. Stocks that went bankrupt, were
acquired or taken private are missing, which flatters a backtest. Two answers:

- **Fix it:** add a repository secret `EODHD_API_KEY` (any paid eodhd.com plan
  includes delisted US stocks). `fetch-data.mjs` then merges every delisted
  NYSE / Nasdaq / AMEX common stock that was ever liquid.
- **Bound it:** without the key, the report includes a stress test: coverage of
  the data vs the number of listed US companies each year (World Bank), how
  trades in survivors that later collapsed performed, and the account result if
  the missing stocks had produced extra trades with those (or worse) outcomes.

## Verification

`scripts/lib/leader-rules.mjs` reproduces the research events exactly (same
setups, same R) for every stop, exit, regime and liquidity option; checked with
six rule configurations against `events.bin` when the options were added.
