# Market-data providers and TradingView integration

Limits and terms below come from each provider's public documentation at the time of writing. They change, so check them before relying on a provider, especially for commercial use.

| Provider | Used for | Real-time? | History | Auth | Rate limits (published / observed) | Use restrictions |
|---|---|---|---|---|---|---|
| **Binance spot** (`data-api.binance.vision`) | Crypto spot, PAXG/XAUT gold tokens; instrument catalog | Yes; best bid/ask from the order book (no exchange timestamp on this endpoint) | Klines back to listing | None | Weight-based per-IP limits (see Binance API docs) | Binance terms; redistribution of market data may require an agreement |
| **Binance USDⓈ-M futures** (`fapi.binance.com`) | **Default gold: XAUUSDT perpetual**, other TradFi perpetuals (XAG, XPT, oil, US stocks/ETFs), crypto perps | Yes; bid/ask with exchange timestamp | Klines | None | Weight-based per-IP limits | As above. Perpetuals have funding costs, which are **not** modelled |
| **Yahoo Finance** (unofficial chart API) | COMEX gold (GC=F), GLD, FX, indices, CME futures | No — delayed, last trade only, no bid/ask | Intraday limited (1m ≈ 7d, 5–30m ≈ 60d, 1h ≈ 730d); daily long | None | Undocumented; **HTTP 429 observed frequently from this machine** | Unofficial; personal use only |
| **Twelve Data** | Spot XAU/USD, FX, stocks | Plan dependent | Plan dependent | `TWELVEDATA_API_KEY` | Free tier has small per-minute and per-day credit limits | Commercial use needs a paid plan |
| **CSV upload** (Chart preview) | Any TradingView export | n/a | Whatever you export | n/a | n/a | Your own export |

## How accuracy is handled

- Each price shows its provider, instrument kind, quote currency and time. The exchange time is used when the provider gives one; otherwise the time it was received, labelled as such.
- Status values:
  - **LIVE:** real-time source with a recent quote.
  - **DELAYED:** delayed source.
  - **STALE:** the last closed candle is more than 2 candles old, or the quote is more than 2 minutes old.
  - **DISCONNECTED:** quote polling is failing.
  - **INVALID:** candles fail the checks; no signals are produced.
- Prices from different providers are never merged. For gold, a second gold price (PAXG or the XAUUSDT perpetual) is shown with the percentage difference as a cross-check. Gold-backed tokens can trade at a premium or discount to gold.
- Candles are checked for impossible OHLC values, timestamp order and gaps. The still-forming candle is never used for signals.
- All times are UTC internally; the dashboard shows UTC or local time.
- Accuracy depends on the external feeds. The app does not claim 100 % accuracy.

## TradingView: what is and isn't possible

| Capability | Official option | In this app |
|---|---|---|
| Interactive chart | TradingView **Lightweight Charts** (open source, Apache-2.0); Advanced Charts / Widgets | Lightweight Charts with the app's own data and overlays |
| TradingView's market data | Only inside TradingView's own widgets. No public data API | Not used |
| Run custom Pine Script | Only on tradingview.com. Widgets cannot run user Pine code | The app's own engine computes the same rules; the Pine v6 script is generated for you to paste into TradingView |
| Sign in with TradingView / access a user's account, private scripts, layouts | No public OAuth or account API | Not offered. The app never asks for TradingView passwords |
| Community ideas and published strategies | No official API | Discovery lists published methodologies with sources instead |

The supported workflow is: analyse in the app, then use **Pine script** to open the generated (or reused) script and paste it into an empty Pine Editor. Compile results are recorded by you; the app never claims a TradingView compile it didn't see.
