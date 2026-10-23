# Pine Forge — Pine Script v6 Generator, Validator & TradingView Launcher

Pine Forge turns trading ideas into **complete, standalone Pine Script v6 indicators and strategies** built from a
library of researched, documented methods — with clear entry/exit signals, risk management, a multi-strategy
**consensus engine** (STRONG entry when strategies agree), a validation pipeline, backtest analytics, and a
**Market Research** button that pulls the latest news, calendar, sentiment and price regimes.

> Educational tool. Nothing here is investment advice, and no strategy is guaranteed to be profitable.

## Features

| Area | What you get |
|---|---|
| Strategy Builder | Describe a strategy in plain English (offline interpreter, optional AI). It becomes a reviewable, fully editable specification before any code is written. If you don't name a timeframe, the strategy's recommended one is used and shown. |
| Chart preview | Check a strategy **before copying it**: real candles for any symbol you type — plain or TradingView-style names (`XAUUSD`, `XAUUSDT`, `BINANCE:BTCUSDT.P`, `OANDA:EURUSD`, `TVC:GOLD`, `COMEX:GC1!`, "gold usdt") from Binance spot & USDT perpetuals, Yahoo Finance, Twelve Data, or a CSV exported from TradingView with the script's BUY/SELL and STRONG markers, stop/target levels, indicator overlays, a per-bar rule inspector, trade list and R statistics — computed in the app from the same specification. On every saved script (Chart preview tab) and on drafts (Builder → Preview on chart). |
| Timeframes | Every script states the chart timeframe to use and its designed range (header, Scripts page, launch steps, on-chart dashboard). On other timeframes a warning banner appears, or entries are blocked if you choose. |
| Library | 15 strategy templates (trend, mean reversion, momentum, breakout, VWAP, S/R, MTF, SMC/ICT, squeeze, Ichimoku, ORB, …) and 19 indicator modules, each with logic, evidence quality, weaknesses and sources. |
| Consensus engine | Any set of strategies votes; agreement is measured per family; **STRONG BUY/SELL** is marked on the first bar of full agreement. |
| Generated scripts | Strategy mode (real `strategy.entry/exit` orders, partial TP1–TP3, breakeven, ATR trailing, risk-based sizing, daily loss limit, loss-streak pause, sessions, news blackout, costs) or indicator mode (signals, simulated levels, `alertcondition`s). Setup / signal / order / fill / invalidated / blocked states are drawn distinctly; dashboard table; JSON alerts. |
| Validation | Spec checks, a Pine v6 static analyzer (undeclared identifiers, unknown built-ins, named-argument and v6 breaking-change checks, look-ahead, lazy `and/or`), trading-logic checks, user-recorded TradingView compile results, backtest sanity. Never claims compilation it didn't see. |
| Scripts & Launcher | Syntax-highlighted editor, copy/download `.pine`, versions with diff, generation logs, step-by-step TradingView instructions, verification checklist, alert/webhook guide. |
| Backtest analysis | Import TradingView *List of trades* CSV: metrics, equity curve, in/out-of-sample, walk-forward, cost stress, Monte Carlo, overfitting flags, run comparison. |
| Market Research | One click (quick or deep) gathers 30–50 public sources: news (CNBC, MarketWatch, FT, FXStreet, CoinDesk, central banks, Google News per asset…), economic calendar, Crypto Fear & Greed, price history → regimes, themes, headline-tone proxy, news-blackout suggestions, strategy-fit hints, and an AI or rule-based briefing. Plus a 120-entry reference library. |

## Quick start

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite`).

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:5173>. The API runs on `127.0.0.1:8787` (set `API_PORT` to change it).

Production build and single-process server (serves the UI from `dist/`):

```bash
npm run build && npm start
```

### Optional configuration (`.env`, see `.env.example`)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | AI interpreter, error explanations and research briefings via Claude (default model `claude-opus-5-5`, server-side refusal fallback enabled) |
| `LLM_PROVIDER=openai-compatible`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`, `OPENAI_COMPAT_API_KEY` | Any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, OpenAI) |
| `TWELVEDATA_API_KEY` | Fallback price data for indices/ETFs when Yahoo Finance rate-limits |
| `DB_PATH` | SQLite file (default `data/pine-forge.db`) |

Keys stay on the server and are never sent to the browser. Without any key everything works with the offline interpreter and rule-based briefings.

## Tests & checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint:generated
```

`lint:generated` writes every template (strategy + indicator) and every consensus preset to `generated/` and runs the static analyzer on them.

## Verification status (honest summary)

- **154 automated tests pass** (generator for all 15 templates × 2 modes and 3 consensus presets, analyzer fixtures, NL interpreter, backtest math, research analysis, REST API).
- **TradingView compiler:** a coverage script containing all 19 indicator modules and every condition (1,136 lines, strategy mode) and a consensus indicator (553 lines) were checked in TradingView's Pine Editor and returned **0 errors** (one shorttitle warning, since fixed). Running scripts on a chart and in the Strategy Tester requires a TradingView login and was **not** exercised — record your own compile results in the app.
- **Market research** was run live: 43 of 49 sources succeeded; the failures were Yahoo Finance rate limits, reported in the Sources tab.

## Known limitations

- TradingView has no public API to create/compile/attach scripts; launching is a guided copy-paste flow.
- The static analyzer is not a compiler; type-qualifier and runtime errors can still appear in TradingView.
- Indicator-mode trade simulation cannot know the intrabar order of high/low (it assumes the stop first).
- OHLCV-based "liquidity", "order blocks", volume and VWAP rules are proxies; FX volume is tick volume.
- Consensus between opposed families (trend vs mean reversion) can be rare at a 100 % threshold.
- Backtest analytics use imported trades only; the chronological split approximates — but is not — a true out-of-sample test.
- Free market-data sources can be rate-limited or change; failures are shown, never filled in.
- The chart preview is a JavaScript re-implementation of the same rules, not TradingView's engine. Data source (e.g. PAXG as a gold proxy), day/session boundaries, pivot tie-breaks and intrabar fill rules can make it differ slightly from the Strategy Tester; TradingView remains the reference.

## Documentation

- [docs/RESEARCH.md](docs/RESEARCH.md) — research findings, design decisions, evidence
- [docs/STRATEGY_CATALOG.md](docs/STRATEGY_CATALOG.md) — every template and indicator (generated)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, extending
- [docs/TRADINGVIEW_GUIDE.md](docs/TRADINGVIEW_GUIDE.md) — adding scripts, reading the chart, alerts
