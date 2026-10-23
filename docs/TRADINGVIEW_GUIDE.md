# Using generated scripts in TradingView

**Check first, copy second.** Open the script's **Chart preview** tab (or Builder → *Preview on chart*). It loads real
candles and draws the same signals, stops, targets and indicators the Pine script will, with a per-bar rule inspector
and a trade list. If the signals look right, click **Looks right — copy script** and continue below. Type any symbol — plain or TradingView-style
(`XAUUSDT`, `BINANCE:XAUUSDT.P`, `OANDA:XAUUSD`, `TVC:GOLD`, `BINANCE:BTCUSDT.P`, `EURUSD`, `NAS100`, `AAPL`, or "gold usdt")
— and pick which market to load from the *Data source* list (e.g. gold: COMEX futures, Binance XAUUSDT perpetual,
PAXG or XAUT tokens). TradingView itself offers no data API, so prices come from these public sources. For an exact
match with your TradingView chart, use *Data source → Upload CSV* with data exported from it (chart menu → Export chart data).

1. In Pine Forge, open **Scripts & Launcher**, choose the script and version, click **Copy script** (or Download .pine).
2. Open <https://www.tradingview.com/chart/>, select the symbol and timeframe the script was designed for.
3. Open the **Pine Editor** and create a new script. Click in the editor, press **Cmd/Ctrl+A** and **delete the template** so the editor is empty, then paste, **Save**, and **Add to chart**. (Pasting next to the template causes "Your script has 2 declaration statements" — CE10243.)
4. If the editor reports errors, paste them into **Validation → Record TradingView result** and use **Analyze errors**.
   Record a successful compile too — the app only shows "Compiled in TV" after you record it.
5. **Strategies:** open the **Strategy Tester**. Set *Properties* (capital, commission, slippage, margin) to match
   your broker. Review *List of trades*: market entries fill at the next bar open; exits are tagged
   `TP1/TP2/TP3/SL/BE/Trail/Rule exit/Time exit/Opposite signal`.
6. Export the **List of trades** and import it under **Backtest Analysis**.

## Which timeframe?

Every script is built for a specific chart timeframe and a designed range:

- The script header says it on line 4, e.g. `// TIMEFRAME: set your chart to 15m. Designed for 5m–1H charts`.
- The Scripts page shows a ⏱ badge, and the launch steps name it.
- The on-chart dashboard has a **Timeframe** row (✓ when the chart is inside the designed range).
- If your request didn't name a timeframe, the builder uses the strategy's recommended one and says so.
- On a timeframe outside the range, a red banner appears at the bottom of the chart. Set the input
  **Chart timeframe guard** to *Block entries* to also stop trading there, or *Off* to hide the banner.
- Consensus scripts use the timeframe that suits the most voters; strategies outside it are named in the header.

Recommended timeframes per strategy are listed in [STRATEGY_CATALOG.md](STRATEGY_CATALOG.md).

## Reading the chart

| Marker | Meaning |
|---|---|
| ▲ small triangle | Potential setup: trigger fired but confluence not met (hover the BUY label tooltips for rule status) |
| ◯ circle | Signal forming on the live (unclosed) bar — may disappear (indicator mode) |
| **BUY / SELL** label | Confirmed signal on a closed bar (strategy mode: market order submitted) |
| **STRONG BUY / SELL**, ALL▲ / ALL▼ | Consensus: first bar where the strategies agree |
| ◆ diamond | Strategy order filled (next bar) |
| ✕ cross | Setup invalidated (confirmation window expired or agreement faded) |
| ⊘ grey | Signal not traded — tooltip states why (filter, session, position open, stop too wide…) |
| Lines | Entry (grey), stop (red), TP1/TP2/final target (green) — identical to the live order levels |
| EXIT label | Position closed, with the exit reason and P&L |

## Alerts

- **Strategy:** add an alert on the script → *alert() function calls only* (setup/entry/exit JSON events), or
  *Order fills only* with `{{strategy.order.alert_message}}` in the message for per-order JSON.
- **Indicator:** pick a named condition (Confirmed long entry, Take-profit reached, …) or *Any alert() function call*.
- Webhooks need a TradingView plan that supports them. Pine Forge never sends orders to a broker.

## Repainting notes

Signals use confirmed bars. Higher-timeframe values come from the previous completed HTF bar. Pivot-based
levels (S/R, swing structure) are known only `right`/`swing` bars after the pivot and are never back-drawn
before that point, except BOS/CHoCH labels placed at the broken swing's price for readability.
