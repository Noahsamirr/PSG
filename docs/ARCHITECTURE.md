# Architecture

```
src/
  core/                 Pure TypeScript, shared by server and browser (no I/O)
    types.ts            StrategySpec, components, templates, diagnostics
    components/         19 indicator modules: inputs, calculations, typed conditions, visuals, docs
    templates/          15 researched strategy templates (+ evidence, sources, testing notes)
    spec.ts             Spec defaults, template → spec, consensus merge, HTF safeguards
    generator/          Spec → Pine Script v6 (signal engine, consensus, risk, orders/simulation, visuals, alerts)
    validation/         Stage 1 spec checks, Stage 2 static Pine analyzer, Stage 3 logic checks, pipeline
    nl/                 Natural language → Intent → Spec (offline rules; LLM fills the same Intent)
    backtest/           TradingView trade-list import, metrics, OOS, walk-forward, costs, Monte Carlo
    research.ts         Regime metrics, topics, tone proxy, de-dup, blackout windows (pure)
    resources.ts        Curated reference library
    explain.ts          Plain-English explanation of a spec
    sim/                Chart-preview engine: Pine-equivalent TA series, per-module simulations, voters,
                        consensus, risk engine and Strategy-Tester-style fills (runs in the browser)
  server/
    app.ts              Express REST API
    db.ts               SQLite (node:sqlite) store: scripts, versions, compile records, backtests, reports
    llm.ts              Provider adapter: Anthropic (official SDK), OpenAI-compatible, none
    research/           Feed/calendar/sentiment/price fetchers + report orchestration
    candles.ts          OHLCV for the chart preview (Binance, Yahoo Finance, Twelve Data; symbol → source mapping)
    index.ts            Entry point, static hosting in production, scheduled research
  web/                  React UI (Vite): Dashboard, Builder, Library, Scripts & Launcher, Backtests, Research, Settings
tests/                  Vitest: generator (all templates × modes), analyzer fixtures, NL, backtest math, research, API
scripts/                generate-all, lint-all, coverage specs, catalog doc generator, compile-test helpers
docs/                   Research report, generated catalog, TradingView guide
```

## Data flow

1. **Request → Intent → Spec.** The rule-based interpreter (or an LLM constrained to the catalog) produces an
   `Intent` (templates, extra conditions, risk, market). `buildSpecFromIntent` turns it into a `StrategySpec`.
   The LLM never writes Pine code.
2. **Spec review.** The spec is fully editable in the UI (rules, roles, mandatory flags, weights, parameters,
   consensus, risk, costs, filters, alerts, visuals, raw JSON). Stage 1 checks run live in the browser.
3. **Generation.** `generatePine(spec)` composes only the components the spec uses. Variables are namespaced
   per component instance (`$x → <id>_x`, `@x → i_<id>_x`), so the same indicator type can appear twice with
   different settings.
4. **Validation pipeline.** Spec → static analysis → trading-logic checks → TradingView compile (user-recorded)
   → backtest sanity (from imported trades). Each stage lists the checks it actually ran.
5. **Storage & versions.** Each generation or manual edit is a new immutable version with its spec, code,
   validation report and log. Versions can be diffed.
6. **Launch.** Copy/download, step-by-step TradingView instructions, verification checklist, alert/webhook setup.

## Generated script structure

`INPUTS → HELPERS → INDICATOR ENGINE → CONDITIONS → SIGNAL ENGINE (per voter) → [CONSENSUS] → RISK ENGINE →
TRADE STATE → EXECUTION (strategy orders) or SIMULATION (indicator) → VISUALS → DASHBOARD → ALERTS`.

Signal states are distinct: setup (trigger without confluence), signal (all rules on a closed bar), order
submitted (strategy mode), fill (detected from the position), plus invalidated setups and blocked signals with
the blocking reason in the label tooltip.

## Extending

- **New indicator:** add a `ComponentDef` in `src/core/components/` (params, conditions with families,
  `emit()`), register it in `components/index.ts`. Conditions must not call `ta.*` (precompute in `calc`).
- **New strategy:** add a `TemplateDef` in `src/core/templates/` with evidence and sources.
- **New LLM provider:** implement `LlmProvider` in `src/server/llm.ts`.
- **Database:** `Store` encapsulates SQL; replace it with a PostgreSQL implementation with the same methods.
