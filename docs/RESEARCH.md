# Research Report

This report records what was researched before and during development, what was adopted, and why.
The per-strategy details (logic, indicators, markets, weaknesses, evidence, sources) live in
[STRATEGY_CATALOG.md](STRATEGY_CATALOG.md), generated from the code so it cannot drift.

## 1. Pine Script v6 — facts that shaped the generator

Sources: TradingView Pine Script v6 User Manual — [Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/),
[Migration to v6](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/),
[Alerts](https://www.tradingview.com/pine-script-docs/concepts/alerts/),
[Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/),
[Other timeframes and data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/).

| v6 behaviour | Consequence in the generator |
|---|---|
| `and` / `or` are evaluated lazily | Every `ta.*` / `request.*` call is hoisted to its own global variable; condition expressions never call functions. The static analyzer warns when a function call follows `and`/`or`. |
| `bool` can no longer be `na`; `na()`/`nz()` reject bools | All state flags are `var bool x = false`; three-state values use `int`. |
| No implicit int/float → bool casting | All conditions are explicit comparisons. |
| Integer division returns fractions | Used deliberately for consensus fractions (`votes / voters`). |
| `when` parameter removed from `strategy.*` | Orders are placed inside `if` blocks. |
| `transp` removed | Colours use `color.new(c, transparency)`. |
| `strategy.exit()` with both relative and absolute levels uses whichever triggers first | Only absolute `limit`/`stop` are used, so plotted levels equal order levels. |
| Exit orders from separate `strategy.exit()` calls reserve quantity; oversize exits are reduced to the open position | TP1/TP2 use explicit `qty`; the final target has no qty and closes the remainder. Partial fills are detected from the actual position size. |
| `alertcondition()` does nothing in strategies; strategy `alert()` calls fire at bar close unless `calc_on_every_tick` | Strategies use `alert()` + per-order `alert_message`; indicators also expose `alertcondition()`s. |
| Default `margin_long/short` is 100 % in v6 | Margin is set per asset class and position size is capped so orders are not silently rejected. |
| `request.security(..., expr[1], lookahead = barmerge.lookahead_on)` is the documented non-repainting HTF pattern | Used for every higher-timeframe value. Using `lookahead_on` without `[1]` is a static-analysis error (future leak). |
| `shorttitle` longer than 10 characters produces a compiler warning | Short titles are derived automatically. |

**Compilation evidence.** TradingView offers no public compile API. During development the generated
code was checked in TradingView's own Pine Editor (whose live analysis returns compiler diagnostics without
signing in): a "coverage" strategy containing all 19 indicator modules and every condition (1,136 lines),
and a consensus-mode indicator (553 lines), both returned **0 errors** (the second had one shorttitle
warning, since fixed). File integrity was confirmed by SHA-256. A deliberately injected error was reported
at the correct line, confirming the whole file was analysed. Adding a script to a chart requires a
TradingView account, so runtime behaviour on a chart was not exercised; the app records real compile
results per version and never claims compilation otherwise.

## 2. Strategy research — selection principles

1. **Public, documented methodology only.** Every template is an original implementation of a method
   described in books, papers or TradingView's own built-in strategies. No proprietary, invite-only or
   copied code. Popular open-source TradingView scripts (Supertrend, Squeeze Momentum, SMC/structure
   scripts) were used as *conceptual* references only.
2. **Evidence is graded, not assumed.** Community popularity is never treated as proof of profitability.
   Each template states what evidence exists (e.g. MA rules: Brock, Lakonishok & LeBaron 1992, but
   Sullivan, Timmermann & White 1999 show data-snooping erodes it; trend-following: Moskowitz, Ooi &
   Pedersen 2012 and Hurst, Ooi & Pedersen 2017; SMC/ICT: no peer-reviewed evidence).
3. **Every component has a job.** Conditions are typed as trigger, filter, confirmation or exit, and tagged
   with a correlation family (trend, momentum, mean-reversion, volatility, volume, structure, pattern) so
   overlapping information (RSI + MACD + Stochastic) is not double-counted.
4. **Transparent failure modes.** Each template lists weaknesses, failure conditions and the testing needed
   before trusting it.

The 15 templates cover the requested families: EMA trend-following, RSI(2) mean reversion, MACD momentum,
Bollinger re-entry, breakout & retest, Turtle channel breakout, VWAP pullback, Supertrend, support/resistance,
multi-timeframe pullback, SMC/ICT sweep → CHoCH → FVG, volatility squeeze, Ichimoku, opening range breakout
and stochastic pullback.

## 3. Multi-strategy consensus ("all strategies agree")

The request was that strategies agree on an entry and that a strong entry be marked first. Design:

- Each strategy (voter) is evaluated with its own rules on confirmed bars and produces signals.
- A voter's **vote** is its most recent signal direction, valid for N bars (default 20–30) or until it signals
  the opposite way. Agreement is therefore measured over a window, because independent systems rarely fire on
  the same bar.
- Agreement is computed **per family** by default (each family's share of agreeing voters, averaged across
  families) so five trend systems do not outvote one structure system.
- **STRONG BUY/SELL** is marked on the **first bar** where agreement reaches the strong threshold (default
  100 %) with no opposing vote. Partial agreement is shown as a potential setup, and as invalidated if it fades.
- Caveat surfaced in the UI and docs: trend-following and mean-reversion systems disagree by design, so
  "everything agrees" across opposed families can be rare; presets group compatible families, and the
  full-library preset uses an 80 % strong threshold. More agreement is not a probability of profit.

## 4. Backtesting & validation methodology

References: Bailey, Borwein, López de Prado & Zhu (2014) on backtest overfitting; Bailey & López de Prado (2014)
deflated Sharpe ratio; Harvey & Liu (2015) "Backtesting"; Pardo (2008) walk-forward analysis; Aronson (2006).

Implemented from imported trades (never simulated): chronological in/out-of-sample split, walk-forward
segments, cost stress (1×–3× extra cost), Monte Carlo trade resampling, sample-size and t-statistic checks,
outlier dependence, negative-skew detection and multi-run stability (coefficient of variation). Result types
(backtest / out-of-sample / paper / live) are stored and displayed separately.

## 5. TradingView integration findings

- No official public API exists to create, compile, publish or attach Pine scripts to charts. The launcher
  therefore uses the supported manual flow: copy/download → Pine Editor → save → add to chart.
- Strategy Tester results can be exported as a "List of trades" file (plan-dependent); the importer maps
  columns by name and also accepts a minimal `date,profit` CSV for manual entry.
- Alerts: script alerts on strategies support order-fill alerts with `{{strategy.order.alert_message}}`;
  webhooks require a TradingView plan that supports them. The app never sends orders.
- Credentials are never requested or stored.

## 6. Market-research sources

Verified reachable at build time (October 2026): CNBC, MarketWatch, Investing.com, FXStreet, CoinDesk,
Cointelegraph, Federal Reserve, ECB, Bank of England, FT, BBC Business, Seeking Alpha, SEC (RSS); Google News
search RSS per asset and topic; Forex Factory weekly calendar JSON; alternative.me Crypto Fear & Greed;
Binance public market data; Frankfurter (ECB reference FX rates); Yahoo Finance chart data (frequently rate
limited — fallbacks: Binance PAXG as a labelled gold proxy, optional Twelve Data key for ETF proxies).
Rejected: sources requiring bot-challenge bypass (e.g. Stooq) and unofficial endpoints with unstable access.
The curated reference library (120 entries in 12 categories: official docs, calendars, central banks, positioning data, APIs,
quant libraries, papers, books, regulators, communities) is in `src/core/resources.ts`.
