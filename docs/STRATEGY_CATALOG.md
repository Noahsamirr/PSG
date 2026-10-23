# Strategy & Indicator Catalog

_Generated from `src/core/templates` and `src/core/components` by `npm run docs:catalog` — do not edit by hand._

## Strategy templates

| Template | Category | Family | Set chart to | Designed range | Markets | Evidence (short) |
|---|---|---|---|---|---|---|
| EMA Trend-Following Cross | Trend following | trend | **4H** | 1H–1D | Index futures, FX majors, liquid crypto, commodities. | MA rules showed predictive power on the DJIA 1897–1986 (Brock et al., 1992), but Sullivan, Timmermann & White (1999) found the best rules did not survive data-snooping adjustments out-of-sample. |
| RSI(2) Pullback Mean Reversion | Mean reversion | meanrev | **1D** | 4H–1D | Equity indices and large-cap ETFs/stocks (daily). | Published by Connors & Alvarez with backtests on S&P 500 data (1995–2007). |
| MACD Pullback with 200 EMA | Momentum | momentum | **1H** | 15m–4H | FX majors, index futures, crypto. | Commonly shown in retail education with anecdotal results; no rigorous independent evidence found. |
| Bollinger Band Re-entry Reversion | Mean reversion | meanrev | **1H** | 15m–4H | FX crosses, range-bound equities, crypto in consolidation. | Bollinger himself cautions bands are a framework, not a system. |
| Breakout & Retest (Donchian) | Breakout | structure | **4H** | 1H–1D | Futures, stocks, crypto. | Channel breakouts are the basis of the documented Turtle rules; trend-following has a long cross-asset record (Hurst, Ooi & Pedersen, 2017). |
| Turtle Channel Breakout | Breakout | structure | **1D** | 4H–1D | Diversified futures portfolios (originally), liquid crypto. | Documented by original Turtles (Faith, 2007). |
| VWAP Trend Pullback (Intraday) | Volume / intraday | volume | **5m** | 1m–15m | US stocks, index futures, liquid crypto (24h: use Session anchor carefully). | VWAP is an execution benchmark (Berkowitz et al., 1988); its use as a signal is practitioner lore without rigorous published evidence.. |
| Supertrend Trend Rider | Trend following | trend | **4H** | 15m–1D | Crypto, indices, commodities. | Popular in retail; no peer-reviewed evidence. |
| Support/Resistance Bounce | Support & resistance | structure | **1H** | 15m–1D | All liquid markets. | Support/resistance clustering has some empirical support in FX (Osler, 2000, FRBNY Economic Policy Review), but trading edges after costs are not established.. |
| Multi-Timeframe Trend Pullback | Multi-timeframe | trend | **1H** | 15m–1H | All liquid markets. | Time-series momentum across asset classes (Moskowitz, Ooi & Pedersen, 2012) supports trading with the prevailing trend; the specific pullback trigger is a practitioner rule.. |
| SMC/ICT Liquidity Sweep → CHoCH → FVG | Smart Money Concepts | structure | **15m** | 5m–1H | XAUUSD, FX majors, index futures, crypto. | No peer-reviewed evidence for ICT/SMC concepts. |
| Volatility Squeeze Breakout | Volatility breakout | volatility | **4H** | 1H–1D | Stocks, indices, crypto. | Volatility clustering is well documented (Mandelbrot 1963; Engle 1982), but the squeeze as a directional signal lacks rigorous evidence.. |
| Ichimoku TK Cross with Cloud Filter | Trend following | trend | **4H** | 1H–1D | FX, indices, crypto. | Limited academic evidence; results in published retail tests vary widely by market.. |
| Opening Range Breakout | Session / time-of-day | structure | **5m** | 1m–5m | US stocks, index futures. | Crabel (1990) documented ORB tendencies in futures; Zarattini & Aziz (2023, SSRN) report ORB results on QQQ — independent replication advised.. |
| Stochastic Trend Pullback | Momentum | momentum | **1H** | 15m–4H | FX, indices, crypto. | No rigorous evidence; widely taught retail method.. |

### EMA Trend-Following Cross (`ema_trend`)

Fast/slow EMA cross in the direction of a 200 EMA regime filter, with an ADX trend-strength gate.

- **Entry:** Long when EMA(9) crosses above EMA(21), close is above EMA(200) and ADX > 20. Short is the mirror image.
- **Exit:** ATR stop, R-multiple targets, plus exit on the opposite EMA cross.
- **Regime:** Persistent trends; poor in ranges.
- **Timeframe:** set the chart to **4H** (designed for 1H–1D; 1H – 1D)
- **Markets:** Index futures, FX majors, liquid crypto, commodities.
- **Indicators:** Moving Average Cross, Trend Filter MA, ADX / DMI Trend Strength
- **Rules:** ema.cross (trigger); trend.side (filter, mandatory); adx.trending (filter, mandatory); ema.crossExit (exit) — strict confluence
- **Strengths:** Simple, transparent, few parameters; Long published history of MA rules; Regime filter removes many counter-trend trades
- **Weaknesses:** Lag at turning points; Many small losses in sideways markets
- **Failure conditions:** Choppy ranges produce repeated crosses; V-shaped reversals hit stops before the cross
- **Evidence quality:** MA rules showed predictive power on the DJIA 1897–1986 (Brock et al., 1992), but Sullivan, Timmermann & White (1999) found the best rules did not survive data-snooping adjustments out-of-sample. Treat as a baseline, not an edge.
- **Testing requirements:** Test across ≥3 markets and ≥2 timeframes; vary fast/slow lengths ±30% and confirm results are stable.
- **Why included:** Cross and filters evaluated on confirmed bars; all ta.* calls hoisted to global scope (v6 lazy evaluation).
- **Sources:** Brock, Lakonishok & LeBaron (1992), Journal of Finance 47(5) — Simple technical trading rules and the stochastic properties of stock returns; Sullivan, Timmermann & White (1999), Journal of Finance 54(5) — Data-snooping, technical trading rule performance, and the bootstrap; TradingView built-in "MovingAvg2Line Cross" strategy — Reference implementation available in the Pine Editor

### RSI(2) Pullback Mean Reversion (`rsi2_meanrev`)

Buy short-term oversold dips (RSI(2) < 10) only above the 200-day average; exit on a close above the 5-period MA.

- **Entry:** Long when RSI(2) drops below 10 while close > SMA(200). Short when RSI(2) rises above 90 while close < SMA(200).
- **Exit:** Close crosses above SMA(5) (long) / below (short); wide ATR catastrophe stop.
- **Regime:** Pullbacks within established up-trends, historically strongest on equity indices.
- **Timeframe:** set the chart to **1D** (designed for 4H–1D; 1D (originally); 4H with caution)
- **Markets:** Equity indices and large-cap ETFs/stocks (daily).
- **Indicators:** RSI, Trend Filter MA, Trend Filter MA
- **Rules:** rsi.dip (trigger); trend.side (filter, mandatory); exitma.crossExit (exit) — strict confluence
- **Strengths:** High historical win rate on US equity indices; Short holding periods; Clear, few rules
- **Weaknesses:** Small average win vs. occasional large loss; Edge has decayed since publication; Weak on trending FX/commodities
- **Failure conditions:** Crashes where oversold keeps getting more oversold; Regime shift below the 200 MA mid-trade
- **Evidence quality:** Published by Connors & Alvarez with backtests on S&P 500 data (1995–2007). Independent replications report weaker post-2010 performance. No guarantee of persistence.
- **Testing requirements:** Daily data, include commissions and 1–2 ticks slippage; check out-of-sample after 2010 separately.
- **Why included:** Entry trigger is the RSI crossing into the extreme zone on a closed bar; ATR stop is a safety net, the MA cross is the intended exit.
- **Sources:** Connors & Alvarez (2008), "Short Term Trading Strategies That Work"; Wilder (1978), "New Concepts in Technical Trading Systems" — RSI definition

### MACD Pullback with 200 EMA (`macd_trend`)

MACD signal-line cross from the "value" side of zero, in the direction of the 200 EMA.

- **Entry:** Long when MACD crosses above signal while MACD < 0 and close > EMA(200). Short mirrored.
- **Exit:** Structure stop at the recent swing, 1.5R / 2.5R targets.
- **Regime:** Trending markets with orderly pullbacks.
- **Timeframe:** set the chart to **1H** (designed for 15m–4H; 15m – 4H)
- **Markets:** FX majors, index futures, crypto.
- **Indicators:** MACD, Trend Filter MA
- **Rules:** macd.cross (trigger); macd.zoneValue (filter, mandatory); trend.side (filter, mandatory) — strict confluence
- **Strengths:** Buys pullbacks rather than extensions; Very widely taught — easy to audit
- **Weaknesses:** MACD lag; Popularity does not imply profitability
- **Failure conditions:** Trend exhaustion near the 200 EMA; Low-volatility chop around zero
- **Evidence quality:** Commonly shown in retail education with anecdotal results; no rigorous independent evidence found. Treat as a hypothesis to test.
- **Testing requirements:** Compare against the same rules without the zero-line filter to measure its contribution.
- **Why included:** Stop = lowest low of the swing lookback minus an ATR buffer; trade skipped if the stop is wider than the max-stop limit.
- **Sources:** Appel (2005), "Technical Analysis: Power Tools for Active Investors"; TradingView built-in "MACD Strategy" — Reference implementation

### Bollinger Band Re-entry Reversion (`bb_meanrev`)

Fade band excursions when price closes back inside the bands, only in non-trending (low ADX) regimes, with a candle confirmation.

- **Entry:** Long when close crosses back above the lower band while ADX < 25; a rejection candle adds to the score.
- **Exit:** Exit at the basis (mean) or by the R-multiple target/stop.
- **Regime:** Ranging, mean-reverting markets.
- **Timeframe:** set the chart to **1H** (designed for 15m–4H; 15m – 4H)
- **Markets:** FX crosses, range-bound equities, crypto in consolidation.
- **Indicators:** Bollinger Bands, ADX / DMI Trend Strength, Candlestick Patterns
- **Rules:** bb.reentry (trigger); adx.ranging (filter, mandatory); candle.any (confirmation); bb.basisExit (exit) — hybrid confluence
- **Strengths:** Defined target (the mean); ADX regime gate avoids band-walking trends
- **Weaknesses:** Losses cluster when a range breaks into a trend
- **Failure conditions:** Breakouts that start with a band pierce
- **Evidence quality:** Bollinger himself cautions bands are a framework, not a system. Mean-reversion edges are short-horizon and cost-sensitive.
- **Testing requirements:** Stress-test slippage ×2 — mean-reversion profits are small per trade.
- **Why included:** Hybrid confluence: the range regime is mandatory; the candle confirmation is scored.
- **Sources:** Bollinger (2001), "Bollinger on Bollinger Bands"; TradingView built-in "Bollinger Bands Strategy"

### Breakout & Retest (Donchian) (`donchian_retest`)

Wait for a 20-bar channel breakout, then enter when price retests and holds the broken level, in the trend direction.

- **Entry:** Long when, within 10 bars of a close above the prior 20-bar high, price trades back to that level and closes above it, with close > EMA(200). Volume expansion adds score.
- **Exit:** ATR stop, R targets, 10-bar opposite channel exit.
- **Regime:** Trending markets emerging from consolidation.
- **Timeframe:** set the chart to **4H** (designed for 1H–1D; 1H – 1D)
- **Markets:** Futures, stocks, crypto.
- **Indicators:** Donchian Breakout & Retest, Trend Filter MA, Relative Volume
- **Rules:** don.retest (trigger); trend.side (filter, mandatory); vol.spike (confirmation); don.channelExit (exit) — hybrid confluence
- **Strengths:** Avoids buying the initial spike; Defined invalidation (back through the level)
- **Weaknesses:** Misses breakouts that never retest
- **Failure conditions:** Failed breakouts that retest and then fail
- **Evidence quality:** Channel breakouts are the basis of the documented Turtle rules; trend-following has a long cross-asset record (Hurst, Ooi & Pedersen, 2017). The retest variant is a practitioner refinement with no formal study.
- **Testing requirements:** Compare with plain breakout entry to quantify the retest filter.
- **Why included:** Broken level stored at breakout; retest window and tolerance (×ATR) configurable; a close back through the level invalidates the setup.
- **Sources:** Faith (2007), "Way of the Turtle"; Hurst, Ooi & Pedersen (2017), "A Century of Evidence on Trend-Following Investing", Journal of Portfolio Management

### Turtle Channel Breakout (`donchian_turtle`)

20-bar channel breakout with a 2×ATR stop and a 10-bar channel exit — the core of the published Turtle System 1.

- **Entry:** Long on a close above the prior 20-bar high; short on a close below the prior 20-bar low.
- **Exit:** 2×ATR initial stop, ATR trailing stop, and exit on a 10-bar opposite channel break.
- **Regime:** Long, persistent trends.
- **Timeframe:** set the chart to **1D** (designed for 4H–1D; 4H – 1D)
- **Markets:** Diversified futures portfolios (originally), liquid crypto.
- **Indicators:** Donchian Breakout & Retest, Volatility Regime (ATR)
- **Rules:** don.breakout (trigger); atrf.band (filter, mandatory); don.channelExit (exit) — strict confluence
- **Strengths:** Fully documented public rules; Positive skew: small losses, occasional large wins
- **Weaknesses:** Low win rate, long drawdowns; Single-market results are noisy
- **Failure conditions:** Range-bound years
- **Evidence quality:** Documented by original Turtles (Faith, 2007). Trend-following evidence is portfolio-level; single-instrument backtests are much less reliable.
- **Testing requirements:** Evaluate on a basket of markets; require ≥100 trades in aggregate.
- **Why included:** Pyramiding (unit adds) intentionally not implemented; one position at a time.
- **Sources:** Faith (2007), "Way of the Turtle"; Covel (2007), "The Complete TurtleTrader"

### VWAP Trend Pullback (Intraday) (`vwap_pullback`)

In an intraday up-trend (EMA stack), buy pullbacks that tag session VWAP and close back above it, during regular trading hours.

- **Entry:** Long when price dips through VWAP and closes back above it with a bullish candle, EMA(9) > EMA(21), and price is not stretched beyond the upper band. RVOL adds score.
- **Exit:** ATR stop, 1R/2R targets, session filter prevents overnight entries.
- **Regime:** Trending intraday sessions.
- **Timeframe:** set the chart to **5m** (designed for 1m–15m; 1m – 15m)
- **Markets:** US stocks, index futures, liquid crypto (24h: use Session anchor carefully).
- **Indicators:** Anchored VWAP, Moving Average Cross, Relative Volume
- **Rules:** vwap.bounce (trigger); ema.stack (filter, mandatory); vwap.notStretched (filter, mandatory); vol.spike (confirmation) — hybrid confluence
- **Strengths:** VWAP is a widely watched execution benchmark; Clear invalidation
- **Weaknesses:** Needs real volume; Choppy days around VWAP
- **Failure conditions:** Range days that oscillate around VWAP; FX tick volume distorts VWAP
- **Evidence quality:** VWAP is an execution benchmark (Berkowitz et al., 1988); its use as a signal is practitioner lore without rigorous published evidence.
- **Testing requirements:** Intraday only; enable bar magnifier where available; include realistic slippage.
- **Why included:** VWAP computed manually from the anchor reset so bands are available; anchored to the daily session change.
- **Sources:** Berkowitz, Logue & Noser (1988), Journal of Finance 43(1)

### Supertrend Trend Rider (`supertrend_trend`)

Enter on Supertrend flips aligned with the 200 EMA and a trending ADX; stop at the Supertrend line.

- **Entry:** Long when Supertrend flips up, close > EMA(200) and ADX > 20.
- **Exit:** Structure stop = Supertrend line at entry, R targets, exit on opposite flip.
- **Regime:** Trending, volatile markets.
- **Timeframe:** set the chart to **4H** (designed for 15m–1D; 15m – 1D)
- **Markets:** Crypto, indices, commodities.
- **Indicators:** Supertrend (ATR), Trend Filter MA, ADX / DMI Trend Strength
- **Rules:** st.flip (trigger); trend.side (filter, mandatory); adx.trending (filter, mandatory); st.flipExit (exit) — strict confluence
- **Strengths:** Volatility-adaptive stop; One of the most-used open-source indicators on TradingView
- **Weaknesses:** Lag; whipsaws in ranges
- **Failure conditions:** Low-ADX chop; Gaps through the band
- **Evidence quality:** Popular in retail; no peer-reviewed evidence. ATR-based trend rules share the general trend-following evidence base.
- **Testing requirements:** Sensitivity test factor 2–4 and ATR period 7–14.
- **Why included:** Uses built-in ta.supertrend; direction −1 = uptrend (TradingView convention).
- **Sources:** TradingView built-in "Supertrend Strategy"; ATR: Wilder (1978)

### Support/Resistance Bounce (`sr_bounce`)

Buy rejections at confirmed pivot support (sell at resistance) with candle confirmation and room to the opposite level.

- **Entry:** Long when a bullish candle wicks into the last confirmed pivot low (± 0.3 ATR) and closes above it, RSI is not overbought and there is ≥1 ATR to resistance. A rejection candle pattern adds score.
- **Exit:** Structure stop below support, R targets.
- **Regime:** Ranges and orderly trends with respected levels.
- **Timeframe:** set the chart to **1H** (designed for 15m–1D; 15m – 1D)
- **Markets:** All liquid markets.
- **Indicators:** Pivot Support & Resistance, RSI, Candlestick Patterns
- **Rules:** sr.bounce (trigger); sr.room (filter, mandatory); rsi.notExtreme (filter, mandatory); candle.any (confirmation) — hybrid confluence
- **Strengths:** Tight, logical invalidation; Visual and intuitive
- **Weaknesses:** Pivot confirmation delay; Levels break often
- **Failure conditions:** Trend days that slice through levels
- **Evidence quality:** Support/resistance clustering has some empirical support in FX (Osler, 2000, FRBNY Economic Policy Review), but trading edges after costs are not established.
- **Testing requirements:** Vary pivot left/right bars; check sample size — bounces are infrequent.
- **Why included:** Levels appear `right` bars after the pivot and are never back-shifted.
- **Sources:** Osler (2000), "Support for Resistance", FRBNY Economic Policy Review; Edwards & Magee, "Technical Analysis of Stock Trends"

### Multi-Timeframe Trend Pullback (`mtf_pullback`)

Trade lower-timeframe pullbacks to the 20 EMA only when the higher timeframe (4H default) trend agrees, with RSI momentum confirmation.

- **Entry:** Long when the completed 4H close is above its 50 EMA, the chart EMA(20) > EMA(50), price dips to the EMA(20) and closes back above it, and RSI(14) > 50.
- **Exit:** ATR stop, three R targets with breakeven after 1R.
- **Regime:** Trending markets on the higher timeframe.
- **Timeframe:** set the chart to **1H** (designed for 15m–1H; Chart 15m–1H with HTF 4H–1D)
- **Markets:** All liquid markets.
- **Indicators:** Higher-Timeframe Trend Bias, Moving Average Cross, RSI
- **Rules:** ema.pullback (trigger); htf.bias (filter, mandatory); rsi.momentum (confirmation, mandatory) — strict confluence
- **Strengths:** Aligns timeframes; Non-repainting HTF request
- **Weaknesses:** HTF bias lags; Fewer trades
- **Failure conditions:** HTF trend reversals
- **Evidence quality:** Time-series momentum across asset classes (Moskowitz, Ooi & Pedersen, 2012) supports trading with the prevailing trend; the specific pullback trigger is a practitioner rule.
- **Testing requirements:** Confirm the HTF is strictly higher than the chart timeframe (the dashboard flags it).
- **Why included:** request.security with [1] offset and lookahead_on — the documented non-repainting pattern.
- **Sources:** Moskowitz, Ooi & Pedersen (2012), "Time Series Momentum", Journal of Financial Economics 104(2); [TradingView docs — Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/)

### SMC/ICT Liquidity Sweep → CHoCH → FVG (`smc_sweep_fvg`)

Wait for a liquidity sweep, a structure shift in the opposite direction, then enter on the retrace into the fresh fair value gap — with HTF bias and premium/discount filters.

- **Entry:** Long: sell-side sweep (wick below swing low, close back above) → bullish BOS/CHoCH within 20 bars → retrace into the bullish FVG formed after the sweep within 15 bars, while the HTF bias is bullish and price is in discount.
- **Exit:** Structure stop beyond the sweep extreme (+ATR buffer), TP1/TP2/TP3 at 1R/2R/3R, breakeven after 1R.
- **Regime:** Markets with clear swing structure; works best around session opens.
- **Timeframe:** set the chart to **15m** (designed for 5m–1H; 5m – 1H (HTF 1H–4H))
- **Markets:** XAUUSD, FX majors, index futures, crypto.
- **Indicators:** Market Structure (SMC/ICT-inspired), Higher-Timeframe Trend Bias
- **Rules:** smc.sequence (trigger); htf.bias (filter, mandatory); smc.discount (filter) — hybrid confluence
- **Strengths:** Tight structural invalidation; Explicit multi-step sequence reduces random entries
- **Weaknesses:** Few signals; Concepts are interpretive — other SMC scripts define them differently
- **Failure conditions:** Trending markets that keep sweeping and continuing; News spikes
- **Evidence quality:** No peer-reviewed evidence for ICT/SMC concepts. Popularity on social media and TradingView is not evidence of profitability. This template exists because it is heavily requested, and it is implemented transparently so it can be tested.
- **Testing requirements:** Require ≥100 trades across several symbols; compare against random-entry baseline with the same stop/target plan.
- **Why included:** Original implementation; pivots confirm `swing` bars late; sequence state resets after an entry or when the window expires.
- **Sources:** ICT public mentorship material (M. J. Huddleston) — Conceptual definitions only; [TradingView docs — Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/)

### Volatility Squeeze Breakout (`squeeze_breakout`)

Enter when a Bollinger-inside-Keltner squeeze fires with momentum, in the direction of the 200 EMA.

- **Entry:** Long when the squeeze turns off with positive, rising momentum and close > EMA(200).
- **Exit:** ATR stop, R targets, exit when momentum fades two bars in a row.
- **Regime:** Compression followed by expansion.
- **Timeframe:** set the chart to **4H** (designed for 1H–1D; 1H – 1D)
- **Markets:** Stocks, indices, crypto.
- **Indicators:** Volatility Squeeze (BB inside Keltner), Trend Filter MA
- **Rules:** sqz.fire (trigger); trend.side (filter, mandatory); sqz.momExit (exit) — strict confluence
- **Strengths:** Targets volatility expansion; One of the most popular open-source indicators on TradingView (Squeeze Momentum)
- **Weaknesses:** Direction of release uncertain
- **Failure conditions:** Fake-outs right after the fire
- **Evidence quality:** Volatility clustering is well documented (Mandelbrot 1963; Engle 1982), but the squeeze as a directional signal lacks rigorous evidence.
- **Testing requirements:** Measure post-fire move distribution vs. random bars.
- **Why included:** KC width uses SMA of true range (Carter/LazyBear convention).
- **Sources:** Carter (2012), "Mastering the Trade", 2nd ed.; Engle (1982), ARCH, Econometrica 50(4)

### Ichimoku TK Cross with Cloud Filter (`ichimoku_tk`)

Tenkan/Kijun cross confirmed by price beyond the cloud and the Chikou span.

- **Entry:** Long when Tenkan crosses above Kijun, close is above the cloud and close > close 26 bars ago.
- **Exit:** ATR stop, R targets, trailing ATR stop after 1R.
- **Regime:** Trending markets.
- **Timeframe:** set the chart to **4H** (designed for 1H–1D; 1H – 1D)
- **Markets:** FX, indices, crypto.
- **Indicators:** Ichimoku Kinko Hyo
- **Rules:** ichi.tk (trigger); ichi.cloud (filter, mandatory); ichi.chikou (confirmation, mandatory) — strict confluence
- **Strengths:** Complete, rule-based trend framework; Built-in support/resistance (cloud)
- **Weaknesses:** Components overlap; lagging
- **Failure conditions:** Flat clouds in ranges
- **Evidence quality:** Limited academic evidence; results in published retail tests vary widely by market.
- **Testing requirements:** Test default (9/26/52) and crypto-adapted (20/60/120) parameter sets.
- **Why included:** Cloud location uses span[disp-1] — the cloud visible at the current bar.
- **Sources:** Patel (2010), "Trading with Ichimoku Clouds"

### Opening Range Breakout (`orb_breakout`)

First close beyond the 30-minute opening range, on the correct side of VWAP, with relative volume confirmation.

- **Entry:** Long on the first close above the 09:30–10:00 NY range high with close > session VWAP; RVOL adds score.
- **Exit:** Stop at the opposite side of the opening range, R targets, flat by session end via session filter.
- **Regime:** Directional sessions, news/earnings days.
- **Timeframe:** set the chart to **5m** (designed for 1m–5m; 1m – 5m)
- **Markets:** US stocks, index futures.
- **Indicators:** Opening Range Breakout, Anchored VWAP, Relative Volume
- **Rules:** orb.breakout (trigger); vwap.side (filter, mandatory); vol.spike (confirmation) — hybrid confluence
- **Strengths:** Well-documented intraday pattern; Natural stop (range)
- **Weaknesses:** Wide stops on large ranges; Many failed breaks on quiet days
- **Failure conditions:** Reversal after initial break
- **Evidence quality:** Crabel (1990) documented ORB tendencies in futures; Zarattini & Aziz (2023, SSRN) report ORB results on QQQ — independent replication advised.
- **Testing requirements:** Intraday only, include slippage; evaluate by weekday and volatility regime.
- **Why included:** One long and one short attempt per day; uses exchange session & timezone inputs.
- **Sources:** Crabel (1990), "Day Trading with Short Term Price Patterns and Opening Range Breakout"; Zarattini & Aziz (2023), "Can Day Trading Really Be Profitable?", SSRN

### Stochastic Trend Pullback (`stoch_pullback`)

In an established trend (price vs. 200 EMA, ADX), time pullback entries with a %K/%D cross out of the oversold/overbought zone.

- **Entry:** Long when %K crosses above %D with %D < 20, close > EMA(200) and ADX > 20.
- **Exit:** ATR stop, 1R/2R targets.
- **Regime:** Trending markets with shallow pullbacks.
- **Timeframe:** set the chart to **1H** (designed for 15m–4H; 15m – 4H)
- **Markets:** FX, indices, crypto.
- **Indicators:** Stochastic Oscillator, Trend Filter MA, ADX / DMI Trend Strength
- **Rules:** stoch.cross (trigger); trend.side (filter, mandatory); adx.trending (filter, mandatory) — strict confluence
- **Strengths:** Precise pullback timing
- **Weaknesses:** Noisy oscillator, frequent signals
- **Failure conditions:** Deep corrections that keep the oscillator pinned
- **Evidence quality:** No rigorous evidence; widely taught retail method.
- **Testing requirements:** Compare with RSI-based timing — they are correlated, so do not combine both as separate confirmations.
- **Why included:** Trend and ADX are mandatory; stochastic is the trigger.
- **Sources:** Lane, G. — "Lane's Stochastics", Technical Analysis of Stocks & Commodities (1984)

## Indicator modules

### Moving Average Cross (`ema`, trend)

Fast/slow moving-average pair. Crossovers mark trend changes; the stack order defines trend state.

- **Calculation:** Two moving averages (EMA by default) of the source: fast = MA(src, fastLen), slow = MA(src, slowLen).
- **Parameters:** Fast length = 9, Slow length = 21, MA type = EMA, Source = close, Plot averages = true
- **Role:** Trend trigger (cross) or trend-state filter (stack / price location).
- **Interpretation:** Fast crossing above slow = bullish trend change; fast above slow = bullish trend state.
- **Limitations:** Lagging; whipsaws repeatedly in sideways markets. Performance depends heavily on lengths and market regime.
- **Repainting:** Does not repaint on confirmed bars. On the live bar the cross can appear and disappear until the bar closes.
- **Source:** Classic technical analysis; tested in Brock, Lakonishok & LeBaron (1992).
- **Conditions:** `cross` Fast MA crosses slow MA [trigger]; `stack` Fast MA above/below slow MA [filter]; `pullback` Pullback to fast MA then close back beyond it [trigger]; `crossExit` Opposite MA cross (exit) [exit]

### Trend Filter MA (`trend`, trend)

Long-horizon moving average (200 by default) used as a regime filter: trade only in its direction.

- **Calculation:** MA(close, length). Slope = MA - MA[slopeBars].
- **Parameters:** Length = 200, MA type = EMA, Slope lookback (bars) = 5, Plot MA = true
- **Role:** Directional filter; optional exit when price crosses the MA.
- **Interpretation:** Close above a rising MA = bullish regime. Price location relative to a 200-period MA is a widely used regime proxy.
- **Limitations:** Very slow to react at turning points; filters out the first part of new trends.
- **Repainting:** No repainting on confirmed bars.
- **Source:** Faber (2007) "A Quantitative Approach to Tactical Asset Allocation" (10-month SMA filter); general practice.
- **Conditions:** `side` Price above/below trend MA [filter]; `slope` Trend MA sloping with trade [filter]; `crossExit` Price crosses the MA (exit) [exit]

### Supertrend (ATR) (`st`, trend)

ATR-based trailing band that flips between support and resistance; flips mark trend changes.

- **Calculation:** Built-in ta.supertrend(factor, atrPeriod): hl2 ± factor × ATR, ratcheting with price. direction < 0 = uptrend.
- **Parameters:** ATR factor = 3, ATR period = 10
- **Role:** Trend trigger (flip) and trend-state filter; also a natural trailing stop.
- **Interpretation:** Close above the band (direction −1) = uptrend.
- **Limitations:** Lagging, whipsaws in ranges; the factor trades responsiveness against noise.
- **Repainting:** Confirmed-bar values are stable; the live bar may flip back before close.
- **Source:** Attributed to Olivier Seban; popularised on TradingView by many open-source Supertrend scripts.
- **Conditions:** `flip` Supertrend flips direction [trigger]; `state` Supertrend direction agrees [filter]; `flipExit` Supertrend flips against the trade (exit) [exit]

### Higher-Timeframe Trend Bias (`htf`, trend)

Non-repainting higher-timeframe MA bias using request.security on the previous confirmed HTF bar.

- **Calculation:** request.security(sym, htf, [close[1], MA(close,len)[1]], lookahead = barmerge.lookahead_on): the last *completed* HTF bar close vs its MA.
- **Parameters:** Higher timeframe = 240, HTF MA length = 50, MA type = EMA, Plot HTF MA = true
- **Role:** Directional filter so lower-timeframe entries align with the higher-timeframe trend.
- **Interpretation:** HTF close above HTF MA = bullish bias.
- **Limitations:** Bias updates only when an HTF bar completes (by design). Must be a higher timeframe than the chart, otherwise results are meaningless.
- **Repainting:** Non-repainting: uses the [1] offset with lookahead_on, the pattern recommended in TradingView's repainting documentation.
- **Source:** TradingView Pine Script docs — "Repainting" and "Other timeframes and data" pages.
- **Conditions:** `bias` HTF trend bias agrees [filter]

### Ichimoku Kinko Hyo (`ichi`, trend)

Tenkan/Kijun cross with Kumo (cloud) location filter and Chikou confirmation.

- **Calculation:** Tenkan = mid of 9-bar range; Kijun = mid of 26-bar range; Span A = avg(Tenkan, Kijun); Span B = mid of 52-bar range; spans displaced forward 26 bars.
- **Parameters:** Tenkan length = 9, Kijun length = 26, Span B length = 52, Displacement = 26
- **Role:** Trend trigger (TK cross) and trend filter (price vs. cloud, Chikou vs. past price).
- **Interpretation:** Price above the cloud with Tenkan crossing above Kijun = bullish.
- **Limitations:** Lagging; default parameters derive from a 6-day trading week. Many conditions overlap (all are range midpoints).
- **Repainting:** No repainting. The cloud is plotted with a forward offset, but signals use the cloud value that is visible at the current bar (span[displacement-1]), not future values.
- **Source:** Goichi Hosoda (1969); Patel, "Trading with Ichimoku Clouds" (2010).
- **Conditions:** `tk` Tenkan crosses Kijun [trigger]; `cloud` Price beyond the cloud [filter]; `chikou` Chikou confirms [confirmation]

### ADX / DMI Trend Strength (`adx`, trend)

Wilder's Directional Movement: ADX measures trend strength, +DI/−DI give direction.

- **Calculation:** ta.dmi(diLen, adxSmoothing) → [+DI, −DI, ADX] (Wilder smoothing).
- **Parameters:** DI length = 14, ADX smoothing = 14, Trend threshold = 20
- **Role:** Regime filter: avoid trend strategies when ADX is low (ranging market).
- **Interpretation:** ADX above threshold = trending; +DI > −DI = bullish direction.
- **Limitations:** ADX lags and rises in strong moves of either direction; thresholds are market-dependent.
- **Repainting:** No repainting on confirmed bars.
- **Source:** J. Welles Wilder, "New Concepts in Technical Trading Systems" (1978).
- **Conditions:** `trending` ADX above threshold [filter]; `di` +DI/−DI direction agrees [filter]; `ranging` ADX below threshold (range regime) [filter]

### RSI (`rsi`, momentum)

Wilder's Relative Strength Index for oversold/overbought reversals or momentum confirmation.

- **Calculation:** ta.rsi(src, len) = 100 − 100 / (1 + RMA(gains)/RMA(losses)).
- **Parameters:** RSI length = 14, Source = close, Oversold = 30, Overbought = 70, Midline = 50
- **Role:** Mean-reversion trigger (exits from extremes) or momentum filter (above/below midline).
- **Interpretation:** Crossing back above the oversold level = potential bullish reversal; RSI > 50 = bullish momentum.
- **Limitations:** Can stay overbought/oversold for long periods in strong trends; RSI and MACD/Stochastic carry overlapping momentum information.
- **Repainting:** No repainting on confirmed bars.
- **Source:** J. Welles Wilder (1978). Short-period RSI(2) pullback rules: Connors & Alvarez, "Short Term Trading Strategies That Work" (2008).
- **Conditions:** `reversal` RSI exits oversold/overbought [trigger]; `dip` RSI enters oversold/overbought [trigger]; `momentum` RSI on the trade side of midline [confirmation]; `notExtreme` RSI not stretched against entry [filter]; `midExit` RSI reaches midline (exit) [exit]

### MACD (`macd`, momentum)

Moving Average Convergence Divergence: signal-line crosses with zero-line context.

- **Calculation:** MACD = EMA(fast) − EMA(slow); Signal = EMA(MACD, sig); Histogram = MACD − Signal (ta.macd).
- **Parameters:** Fast length = 12, Slow length = 26, Signal length = 9
- **Role:** Momentum trigger (signal cross) with zero-line location filter.
- **Interpretation:** MACD crossing above signal below the zero line = momentum turning up from a pullback.
- **Limitations:** Lagging (built from EMAs); frequent false crosses in chop; overlaps with RSI/Stochastic momentum.
- **Repainting:** No repainting on confirmed bars.
- **Source:** Gerald Appel (late 1970s); "Technical Analysis: Power Tools for Active Investors" (2005).
- **Conditions:** `cross` MACD crosses signal line [trigger]; `zoneValue` Cross happens on the "value" side of zero [filter]; `aboveZero` MACD on the trade side of zero [filter]; `hist` Histogram expanding with trade [confirmation]; `crossExit` Opposite MACD cross (exit) [exit]

### Stochastic Oscillator (`stoch`, momentum)

%K/%D crosses inside oversold/overbought zones.

- **Calculation:** %K = SMA(100 × (close − lowest low)/(highest high − lowest low), smoothK); %D = SMA(%K, d).
- **Parameters:** %K length = 14, %K smoothing = 3, %D length = 3, Oversold = 20, Overbought = 80
- **Role:** Timing trigger for pullback entries, usually with a trend filter.
- **Interpretation:** %K crossing above %D while below the oversold level = bullish timing signal.
- **Limitations:** Very noisy on low timeframes; overlaps with RSI.
- **Repainting:** No repainting on confirmed bars.
- **Source:** George Lane (1950s).
- **Conditions:** `cross` %K/%D cross in extreme zone [trigger]; `side` %K above/below %D [confirmation]

### Volatility Squeeze (BB inside Keltner) (`sqz`, volatility)

TTM-style squeeze: Bollinger Bands contract inside Keltner Channels, then "fire" with momentum direction.

- **Calculation:** Squeeze on when BB(len, bbMult) lies inside KC(len, kcMult × SMA(true range)). Momentum = linreg(close − avg(avg(HH, LL), SMA(close)), len).
- **Parameters:** Length = 20, BB multiplier = 2, KC multiplier = 1.5
- **Role:** Volatility-expansion breakout trigger with momentum direction.
- **Interpretation:** Squeeze turning off ("firing") with positive momentum = bullish expansion.
- **Limitations:** Direction of the release is uncertain; false fires in choppy markets. Momentum is a regression proxy, not order flow.
- **Repainting:** No repainting on confirmed bars.
- **Source:** John Carter, "Mastering the Trade" (TTM Squeeze); widely known via LazyBear's open-source "Squeeze Momentum Indicator" on TradingView.
- **Conditions:** `fire` Squeeze fires with momentum [trigger]; `mom` Squeeze momentum rising/falling [confirmation]; `momExit` Momentum fades (exit) [exit]

### Bollinger Bands (`bb`, meanrev)

SMA ± k standard deviations. Re-entry into the bands for mean reversion, or band breakouts for expansion.

- **Calculation:** ta.bb(close, len, mult) → [basis = SMA, upper = basis + mult·σ, lower = basis − mult·σ].
- **Parameters:** Length = 20, StdDev multiplier = 2
- **Role:** Mean-reversion trigger (close back inside after a band pierce), breakout trigger, and basis exit.
- **Interpretation:** Close crossing back above the lower band = stretched move snapping back.
- **Limitations:** In strong trends price "walks the band" and re-entries fail. Standard deviation assumes a stable distribution that markets do not have.
- **Repainting:** No repainting on confirmed bars.
- **Source:** John Bollinger, "Bollinger on Bollinger Bands" (2001).
- **Conditions:** `reentry` Close re-enters the bands [trigger]; `breakout` Close breaks outside the bands [trigger]; `belowBasis` Price on the discount side of the basis [filter]; `basisExit` Price returns to the basis (exit) [exit]

### Volatility Regime (ATR) (`atrf`, volatility)

Filters by normalised volatility: avoid dead markets and extreme volatility spikes.

- **Calculation:** ATR% = 100 × ATR(len)/close; expansion = ATR > SMA(ATR, baseLen).
- **Parameters:** ATR length = 14, ATR baseline length = 50, Min ATR % of price = 0.05, Max ATR % of price = 10
- **Role:** Volatility filter — trade only when volatility is in a workable band, or expanding.
- **Interpretation:** ATR above its own average = expanding volatility (favourable for breakouts).
- **Limitations:** Thresholds are instrument-specific; ATR% of FX pairs and crypto differ by an order of magnitude.
- **Repainting:** No repainting on confirmed bars.
- **Source:** Wilder (1978) Average True Range.
- **Conditions:** `band` Volatility within workable band [filter]; `expanding` Volatility expanding [filter]

### Anchored VWAP (`vwap`, volume)

Volume-weighted average price anchored to the session, week or month, with standard-deviation bands.

- **Calculation:** Cumulative Σ(hlc3·volume)/Σ(volume) since the anchor; bands = VWAP ± mult × volume-weighted standard deviation.
- **Parameters:** Anchor = Session, Band multiplier = 1
- **Role:** Intraday fair-value reference: reclaim/pullback triggers and side-of-VWAP filter.
- **Interpretation:** Price holding above session VWAP = buyers in control of the session on average.
- **Limitations:** Requires real volume. Spot FX and some CFDs on TradingView report tick volume (activity proxy), not traded volume. Not meaningful on daily+ charts with a session anchor.
- **Repainting:** No repainting on confirmed bars; the live-bar VWAP moves until close.
- **Source:** Berkowitz, Logue & Noser (1988), "The Total Cost of Transactions on the NYSE", Journal of Finance.
- **Conditions:** `reclaim` Close reclaims VWAP [trigger]; `bounce` Pullback to VWAP holds [trigger]; `side` Price on the trade side of VWAP [filter]; `notStretched` Not stretched beyond the outer band [filter]

### Relative Volume (`vol`, volume)

Volume relative to its moving average, used as participation confirmation.

- **Calculation:** RVOL = volume / SMA(volume, len).
- **Parameters:** Average length = 20, Spike multiplier = 1.5
- **Role:** Confirmation that a breakout or reversal occurs on above-average participation.
- **Interpretation:** RVOL above the multiplier = unusual participation.
- **Limitations:** PROXY ONLY: TradingView OHLCV volume cannot reveal bid/ask aggression, order-book depth or institutional positioning. FX volume is tick volume.
- **Repainting:** Live-bar volume grows until close; confirmed values are stable.
- **Source:** General volume analysis practice.
- **Conditions:** `spike` Above-average volume [confirmation]

### Donchian Breakout & Retest (`don`, structure)

Channel breakout of the prior N-bar high/low, with an optional retest of the broken level.

- **Calculation:** Upper = highest(high, len)[1], lower = lowest(low, len)[1]. A breakout stores the level; a retest is a later bar that trades back to within tol×ATR of it and closes beyond it.
- **Parameters:** Channel length = 20, Retest window (bars) = 10, Retest tolerance (× ATR) = 0.25, Exit channel length = 10
- **Role:** Breakout trigger, or the more conservative breakout-then-retest trigger.
- **Interpretation:** Close above the prior 20-bar high = breakout; holding the level on a retest = acceptance.
- **Limitations:** Many breakouts fail (false breaks), especially in ranges. Retest entries miss strong moves that never retest.
- **Repainting:** No repainting: channel uses the prior completed bars ([1]).
- **Source:** Richard Donchian; Turtle Trading rules (Curtis Faith, "Way of the Turtle", 2007).
- **Conditions:** `breakout` Close breaks the channel [trigger]; `retest` Broken level retested and held [trigger]; `channelExit` Opposite short-channel break (exit) [exit]

### Pivot Support & Resistance (`sr`, structure)

Support/resistance from confirmed pivot highs/lows; bounce, rejection, and break-with-role-reversal triggers.

- **Calculation:** ta.pivotlow(low, left, right) / ta.pivothigh(high, left, right). The latest confirmed pivot defines the active support/resistance. A close through resistance converts it to support (role reversal).
- **Parameters:** Pivot left bars = 10, Pivot right bars (confirmation delay) = 5, Touch tolerance (× ATR) = 0.3
- **Role:** Location trigger: buy bounces at support, sell rejections at resistance, or trade breaks.
- **Interpretation:** A bullish candle that wicks into support and closes above it = support holding.
- **Limitations:** A pivot is only known `right` bars after it forms (confirmation delay). Levels are zones, not lines; tolerance matters.
- **Repainting:** Does not repaint, but levels appear `right` bars late. Plots are NOT shifted back, so what you see is what the script knew at that time.
- **Source:** Classic price-action support/resistance (e.g. Edwards & Magee, "Technical Analysis of Stock Trends").
- **Conditions:** `bounce` Bounce at support / rejection at resistance [trigger]; `break` Close breaks resistance / support [trigger]; `room` Room to the opposite level [filter]

### Market Structure (SMC/ICT-inspired) (`smc`, structure)

Swing structure with BOS/CHoCH, liquidity sweeps, fair value gaps, order blocks and premium/discount — implemented from public definitions.

- **Calculation:** Swings = confirmed pivots (swingLen each side). BOS = close through the last unbroken swing in the trend direction; CHoCH = first close through a swing against the prior trend. Sweep = wick beyond a swing that closes back inside. Bullish FVG = low > high[2] (3-bar imbalance) of at least fvgMin×ATR. Order block = last opposite-colour candle before the structure break. Premium/discount = position relative to the midpoint of the pdLen-bar range.
- **Parameters:** Swing length (pivot bars each side) = 5, Sweep → shift window (bars) = 20, Shift → FVG entry window (bars) = 15, Min FVG size (× ATR) = 0.15, Premium/discount range (bars) = 50, Order-block lookback (bars) = 10, Show BOS / CHoCH = true, Show fair value gaps = true, Show liquidity sweeps = true, Show order blocks = true
- **Role:** Primary trigger: sweep → structure shift → retrace into the FVG ("sequence"); individual elements usable as filters.
- **Interpretation:** Sell-side liquidity taken (sweep of a swing low), followed by a bullish CHoCH/BOS and a retrace into the bullish FVG = long setup.
- **Limitations:** SMC/ICT terms are community concepts without standard definitions or peer-reviewed evidence; this is one transparent, rule-based interpretation. "Liquidity" and "order blocks" are price-pattern proxies — OHLCV data cannot show real resting orders or institutional positioning.
- **Repainting:** Swings are confirmed swingLen bars after the pivot (delay). Structure breaks use bar closes. Nothing is drawn retroactively except labels placed at the swing price.
- **Source:** Public ICT/SMC educational material (M. Huddleston); TradingView open-source market-structure scripts used as conceptual reference only (no code copied).
- **Conditions:** `sequence` Sweep → structure shift → FVG retrace [trigger]; `shift` Structure shift (BOS or CHoCH) [trigger]; `choch` Change of character [trigger]; `recentSweep` Liquidity swept recently [filter]; `trend` Structure trend agrees [filter]; `discount` Price in discount / premium [filter]; `inOb` Price reacting from an order block [confirmation]

### Opening Range Breakout (`orb`, structure)

High/low of the first minutes of a session; first close beyond the range each day is the breakout.

- **Calculation:** Tracks high/low while time is inside the opening-range session; after it ends, the first close above the high (below the low) that day triggers.
- **Parameters:** Opening range session = 0930-1000, Timezone = America/New_York
- **Role:** Intraday breakout trigger (one long and one short attempt per day).
- **Interpretation:** Breaking the opening range signals the day's initial directional auction.
- **Limitations:** Intraday charts only; requires chart timeframe smaller than the range duration. Gaps and news can produce immediate reversals.
- **Repainting:** No repainting on confirmed bars.
- **Source:** Toby Crabel, "Day Trading with Short Term Price Patterns and Opening Range Breakout" (1990).
- **Conditions:** `breakout` First close beyond the opening range [trigger]

### Candlestick Patterns (`candle`, pattern)

Engulfing and pin-bar (hammer / shooting star) confirmations.

- **Calculation:** Engulfing: current body engulfs the prior opposite-colour body. Pin bar: rejection wick ≥ wickRatio × body and close in the outer third of the range.
- **Parameters:** Pin-bar wick/body ratio = 2
- **Role:** Confirmation of rejection at a level; not a standalone system.
- **Interpretation:** A bullish engulfing at support = buyers overpowered sellers on that bar.
- **Limitations:** Weak standalone evidence; meaningful mainly at pre-defined levels. Definitions vary between sources.
- **Repainting:** Pattern can appear/disappear on the live bar; confirmed bars are stable.
- **Source:** Steve Nison, "Japanese Candlestick Charting Techniques" (1991).
- **Conditions:** `engulf` Engulfing candle [confirmation]; `pin` Pin bar / rejection candle [confirmation]; `any` Any rejection pattern [confirmation]
