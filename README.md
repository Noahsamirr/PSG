# Pine Forge — Pine Script v6 Generator, Validator & TradingView Launcher

Pine Forge turns trading ideas into **complete, standalone Pine Script v6 indicators and strategies** built from a
library of researched, documented methods — with clear entry/exit signals, risk management, a multi-strategy
**consensus engine** (STRONG entry when strategies agree), a validation pipeline, backtest analytics, and a
**Market Research** button that pulls the latest news, calendar, sentiment and price regimes.

> Educational tool. Nothing here is investment advice, and no strategy is guaranteed to be profitable.

## Features

| Area | What you get |
|---|---|
| Market Dashboard (home) | GOLD-first: opens on **XAUUSDT** (Binance gold perpetual). Search ~1,600 instruments (Binance spot and perpetuals discovered live, plus curated FX/indices/CME/ETFs); each gold product is listed separately. Header: price, 24h change, bid/ask/spread, exchange timestamp, LIVE/DELAYED/STALE/DISCONNECTED status, provider and session, plus a gold cross-check price. **Activate strategies** from a searchable, categorised library → per-strategy card: BUY/SELL/NO TRADE, confirmed entry vs developing setup, entry/SL/TPs, R:R, rule checks, invalidation, results after costs (out-of-sample and all) → confluence across independent strategy families with score and disagreements → one chart with numbered, merged markers, focus mode and each strategy's own indicators → save opportunities (immutable snapshot) and evaluate forward → **Test all strategies** ranks them on the same candles by out-of-sample expectancy with a minimum-evidence rule → **Pine script** reuses an identical stored version. |
| Strategy Discovery | Published methodologies (Turtles, Connors RSI(2), Raschke, Bollinger, Ichimoku, Crabel ORB, Carter squeeze, ICT/SMC) with sources, verification status and how this app's independent implementation differs. No originator returns are shown — none are verifiable through an official API. Follow, or test on the dashboard. |
| Administrator | Behind `ADMIN_TOKEN`: most-used strategies/assets/timeframes, saved-strategy counts, provider reliability, script validation status and generation failures, AI-provider status, strategy review (experimental / awaiting validation / approved / deprecated, with logged notes), minimum-evidence thresholds for rankings. Reviews never alter measured results. |
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
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google Gemini (free tier available from Google AI Studio; default model `gemini-3.5-flash`, which answers in seconds on the free tier). Used first when set. Powers the trade analyst and the other AI features |
| `GEMINI_SECOND_MODEL` | A second Gemini model (default `gemini-3.1-flash-lite`) that votes as its own analyst; `off` to disable |
| `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `GITHUB_MODELS_TOKEN`, `HF_TOKEN`, `OLLAMA_MODEL` (+ optional `*_MODEL`) | Each adds one more free AI analyst to the trade analyst panel. Without a model name the app lists the provider's models and picks a strong one (and re-picks when a model is retired). See `.env.example` for sign-up links |
| `AI_ANALYSTS_OFF` | Comma list of analysts to leave out, e.g. `anthropic` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | AI interpreter, error explanations and research briefings via Claude (default model `claude-opus-5-5`, server-side refusal fallback enabled) |
| `LLM_PROVIDER=openai-compatible`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`, `OPENAI_COMPAT_API_KEY` | Any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, OpenAI) |
| `TWELVEDATA_API_KEY` | Fallback price data for indices/ETFs when Yahoo Finance rate-limits |
| `DB_PATH` | SQLite file (default `data/pine-forge.db`). Tables are created and migrated automatically on start. |
| `ADMIN_TOKEN` | Enables the Administrator page and `/api/admin/*` (sent as the `x-admin-token` header). Unset = admin disabled. Use a long random value. |

**Trade analyst panel.** The rule-based analyst plus every configured AI receive the same evidence (all strategies on 5m–1H with their measured track records, next trigger prices, high-impact news, and the daily picture of the asset, the dollar, US yields and headlines from the latest research report). Each AI may only pick prices by level id; every answer is validated. The answers are then combined by vote: BUY or SELL needs more than half of the analysts that answered and almost none pointing the other way (with fewer than four analysts, none), otherwise the panel says WAIT. Two analysts that end up on the same model count once.

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

- **177 automated tests pass** (generator for all 15 templates × 2 modes and 3 consensus presets, analyzer fixtures, NL interpreter, backtest math, research analysis, REST API).
- **TradingView compiler:** a coverage script containing all 19 indicator modules and every condition (1,136 lines, strategy mode) and a consensus indicator (553 lines) were checked in TradingView's Pine Editor and returned **0 errors** (one shorttitle warning, since fixed). Running scripts on a chart and in the Strategy Tester requires a TradingView login and was **not** exercised — record your own compile results in the app.
- **Market research** was run live: 43 of 49 sources succeeded; the failures were Yahoo Finance rate limits, reported in the Sources tab.

## Known limitations

- Dashboard signals come from the in-app simulation of each strategy, not from TradingView. Quotes are real only where the source provides them (Binance bid/ask); Yahoo is delayed and often rate-limited (HTTP 429) — failures are shown and no signal is produced without valid data.
- Single-user, local application: no user accounts or per-user data isolation. Do not expose the server to the internet without adding authentication (see `docs/AUDIT.md`).
- Quotes are polled (5 s) rather than streamed over WebSocket; funding costs of perpetuals are not modelled.
- No live or copy trading. Strategy following = tracking and simulated evaluation only.
- Full audit, provider limits and the TradingView capability matrix: [`docs/AUDIT.md`](docs/AUDIT.md), [`docs/DATA_PROVIDERS.md`](docs/DATA_PROVIDERS.md).

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
