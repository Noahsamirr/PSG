# Audit and remediation (October 2026)

Audit of the existing Pine Forge codebase against the "Trading Platform Redesign" directive, with what was fixed.
Status: **fixed** = implemented and covered by tests or verified live; **open** = not done.

## Root causes of the complexity

1. **The app was built around script generation, not the trader's question.** The home page was a script overview, and every workflow started in the Builder. A user had to understand specs, voters and Pine to see a signal. → The **Market Dashboard** (asset → strategy → BUY/SELL/NO TRADE → save → compare) is now the home page. The generator tools sit under "Advanced tools".
2. **Signals existed only inside per-script previews**, computed in the browser, with no common contract. → `src/core/signals.ts` defines one deterministic signal interface used by the dashboard, ranking, saved opportunities and tests.
3. **Market data was a symbol guesser** (regex → provider). The provider behind a price was implicit, and gold products were mixed. → A searchable instrument catalog (`src/server/catalog.ts`) lists each instrument with its provider, kind, quote currency, session and real-time flag.

## Findings

### Critical functional defects
| Finding | Status |
|---|---|
| The forming (unclosed) candle was used for signals, so signals could repaint | fixed — `checkBars` drops it; signals use closed candles only |
| `PAXGUSDT`/`XAUTUSDT` (listed in the gold menu) were routed to Yahoo and failed with 429 | fixed — mapped to Binance spot |
| If the API was briefly unavailable at start-up (e.g. a restart), the strategy catalog stayed empty until reload | fixed — retries every 3 s |
| Invalid or missing data could still reach the strategy engine | fixed — invalid data → no actionable signal, reported in the header |

### Data accuracy and trading integrity
| Finding | Status |
|---|---|
| No live/delayed/stale distinction; no quote timestamp | fixed — exchange timestamps where provided, status badge, 5 s quote polling, "disconnected" on failure |
| No bid/ask/spread | fixed for Binance; shown as unavailable for sources that don't provide it |
| Gold instruments (perp, token, futures, ETF, spot) treated as interchangeable | fixed — separate catalog entries plus a cross-check against a second gold price |
| Statistics ignored commission | fixed — results after 0.05 %/side commission plus slippage in fills |
| Simulated fills used TradingView's intrabar path assumption (optimistic on stop+target candles) | fixed for dashboard statistics — counted at the stop (conservative), and reported |
| Break-even trades counted as wins/losses | fixed — reported separately and excluded from the win-rate denominator |
| Agreement between correlated strategies counted as independent | fixed — family-level voting; score is labelled "not a probability" |
| Ranking by win rate without sample size | fixed — out-of-sample expectancy after costs, with an admin-set minimum evidence |

### Architecture
| Finding | Status |
|---|---|
| Strategy definition, evaluation and visualisation were coupled to the script workspace | fixed — templates (definition) → `runSimulation` (engine) → `evaluateStrategy` (signal contract) → dashboard (view) |
| Identical scripts were regenerated | fixed — reused by spec hash; failing scripts are not stored |
| No provider reliability or usage telemetry | fixed — per-provider success/failure counters and usage events |

### Security
| Finding | Status |
|---|---|
| No administrator separation | fixed — admin API requires `ADMIN_TOKEN` (timing-safe compare); disabled when unset |
| Expensive endpoints unbounded | fixed — per-IP rate limits on signals (40/min) and rankings (6/min) |
| Secrets in frontend | none found; API keys are read server-side only |
| User accounts, sessions, per-user data isolation | **open** — the app is single-user and local; saved data is shared by everyone who can reach the server. Do not expose it publicly without adding authentication. |

### UX
| Finding | Status |
|---|---|
| No single place to see a signal and its reasons | fixed — signal card: stage (confirmed/developing), entry/SL/TP, R:R, rule checks, invalidation, results |
| Markers unreadable when strategies overlap | fixed — merged per candle, numbered by strategy, focus mode |
| Every indicator always drawn | fixed — a strategy draws only its own indicators, on demand |

### Missing functionality (still open)
- WebSocket streaming. Quotes poll every 5 s and signals every 60 s, which is enough for closed-candle signals but is not tick streaming.
- TradingView account access, private scripts and Pine execution inside the app (no official API; see `DATA_PROVIDERS.md`).
- Walk-forward optimisation on the dashboard. A chronological 70/30 split is used; walk-forward exists only for imported TradingView trade lists.
- Live or copy trading (deliberately not implemented).
- Verified trader records. None are available through official APIs, so Discovery shows published methods only.
