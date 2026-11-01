// Help & Support: a plain-English guide to every part of the platform, searchable, with links to each page.
import { useMemo, useState, type ReactNode } from 'react';
import { Card, Icon } from '../components/ui';
import { useI18n } from '../i18n';
import { HELP_AR } from '../i18n/help-ar';

export interface HelpEntry {
  /** Term, field or question. */
  q: string;
  a: ReactNode;
}
export interface HelpSection {
  id: string;
  title: string;
  /** Page this section describes, if any. */
  link?: { href: string; label: string };
  intro: ReactNode;
  steps?: ReactNode[];
  items?: HelpEntry[];
}

const L = ({ to, children }: { to: string; children: ReactNode }) => <a href={`#${to}`}>{children}</a>;

const SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting started (5 steps)',
    intro: 'The platform shows you trading signals for gold (and many other markets), explains why each signal happened, and lets you track how it turns out. It never places real trades.',
    steps: [
      <>
        Open the <L to="/">Market Dashboard</L>. Gold (XAUUSDT) is already selected.
      </>,
      'Pick a timeframe, for example 1H (each candle = 1 hour) or 4H.',
      <>
        Read the <b>Trade plans</b> box: it lists every live BUY or SELL with Entry, Take-profit (TP), Stop-loss (SL), the reason, and which other strategies agree.
      </>,
      <>
        Click <b>Show on chart</b> to see the entry, stop and targets drawn on the price chart.
      </>,
      <>
        Click <b>Save opportunity</b> on a signal card to track it. Come back later and press <b>Evaluate</b> to see if it hit the target or the stop.
      </>,
    ],
    items: [
      { q: 'Simple and Advanced modes', a: 'The switch at the top of the sidebar. Simple (the default) shows one screen: the price, BUY / SELL / WAIT for 5m, 15m, 30m and 1H, one clear trade card, the next possible entries, a chart of that trade and your saved trades. Advanced shows every tool: all signal cards, the full chart controls, rankings, the strategy library, scripts, backtests, research and admin.' },
      { q: 'Is this financial advice?', a: 'No. It is an educational analysis tool. Signals describe what a set of rules says; they are not predictions or recommendations. Past results do not guarantee future results.' },
      { q: 'Does it trade with my money?', a: 'No. There is no connection to any broker or exchange account. "Paper trades" are records you save and track — no money is involved.' },
      { q: 'Do I need a TradingView account?', a: 'Not to use the dashboard. You only need TradingView if you want to run the generated Pine Script on your own TradingView chart.' },
    ],
  },
  {
    id: 'market',
    title: 'Market dashboard — choosing the market',
    link: { href: '/', label: 'Open the Market Dashboard' },
    intro: 'The top of the dashboard is where you choose what to look at and check that the price data is trustworthy.',
    items: [
      { q: 'Asset (search box)', a: 'Click and type a name or symbol: "gold", "XAU", "BTC", "EURUSD", "TSLA". About 1,600 instruments are searchable. Each result says exactly what it is, because different "gold" products are not the same thing.' },
      { q: 'XAUUSDT (default)', a: 'A gold contract on Binance priced in USDT. It follows the gold price closely and has live data 24/7. It is not the same as your broker’s XAUUSD, so prices can differ slightly.' },
      { q: 'PAXGUSDT / XAUTUSDT', a: 'Crypto tokens backed by physical gold. Their price tracks gold but can be a little above or below it.' },
      { q: 'GC=F, GLD, XAU/USD', a: 'COMEX gold futures and the GLD gold ETF (delayed data from Yahoo Finance), and spot gold (needs a Twelve Data API key).' },
      { q: 'Timeframe', a: 'How much time each candle covers: 1m, 5m, 15m, 30m, 1H, 4H, 1D… Strategies give different signals on different timeframes. Each strategy says which timeframes it was designed for.' },
      { q: 'Times in (UTC / Local)', a: 'Show all times in UTC (the platform’s standard) or your own local time.' },
      { q: 'Refresh / Back to gold', a: 'Refresh reloads the data now (it also refreshes by itself every minute). Back to gold returns to XAUUSDT.' },
      { q: 'Language button (English / العربية)', a: 'At the top of the sidebar. Switches the whole platform between English and Arabic and remembers your choice.' },
    ],
  },
  {
    id: 'header',
    title: 'Price header — what each number means',
    intro: 'The box under the asset picker shows the current price and whether you can trust it.',
    items: [
      { q: 'Price', a: 'The latest price. For Binance this is the middle of the best buy and sell prices, updated every 5 seconds.' },
      { q: '+6.89 (+0.17%) 24h', a: 'How much the price changed compared with 24 hours ago.' },
      { q: 'Bid / Ask / Spread', a: 'Bid = best price someone will pay. Ask = best price someone will sell at. Spread = the gap between them (a hidden cost of trading). Some sources do not provide these.' },
      { q: 'LIVE', a: 'Real-time data with a fresh timestamp from the exchange.' },
      { q: 'DELAYED', a: 'The source is delayed (for example Yahoo Finance, often 10–20 minutes).' },
      { q: 'STALE', a: 'The last candle is old — the market is closed or the feed is slow. Signals are shown as of the last candle.' },
      { q: 'DISCONNECTED', a: 'The live price could not be fetched. The last known values are shown.' },
      { q: 'INVALID / Data unavailable', a: 'The price data failed checks or could not be loaded. The platform then shows no signals at all, on purpose.' },
      { q: 'Instrument / provider / session', a: 'What the product is, where the data comes from, and when that market trades.' },
      { q: 'Last closed candle', a: 'The most recent finished candle. Signals only use finished candles, so they do not change after the fact ("no repainting").' },
      { q: 'Cross-check', a: 'For gold, a second gold price from a different product is shown. If the difference is large, one feed may be wrong.' },
    ],
  },
  {
    id: 'plans',
    title: 'Trade plans — the simple summary',
    intro: 'The quickest way to read the market. Every strategy (all 15) is checked; each live BUY or SELL gets one plan.',
    items: [
      { q: 'BUY / SELL', a: 'The direction of the trade: BUY means the strategy expects the price to go up, SELL means down.' },
      { q: 'Entry › TP › SL', a: 'Entry = the price the trade started at. TP (take-profit) = the price where profit is taken (some strategies have TP1, TP2, TP3 and take part of the profit at each). SL (stop-loss) = the price where the trade is closed to limit the loss.' },
      { q: 'R:R', a: 'Reward-to-risk: how far the final target is compared with how far the stop is. R:R 3 means the target is three times further than the stop.' },
      { q: 'Why', a: 'One sentence explaining which rule caused the entry. "Not met" lists optional rules that were not true at that moment.' },
      { q: 'Agree', a: 'Other strategies in the same direction whose entry is close (within one stop-distance). "Same family" means a similar kind of strategy, so it is not really independent confirmation.' },
      { q: 'Disagree', a: 'Strategies that currently have a trade in the opposite direction.' },
      { q: 'Same direction, different entry', a: 'Strategies in the same direction but that entered at a very different price.' },
      { q: 'Setting up the same way', a: 'Strategies whose first condition happened but which have not confirmed yet.' },
      { q: 'Copy', a: 'Copies the plan as plain text (Action > BUY / Entry > TP > SL / Why / who agrees) so you can paste it anywhere.' },
      { q: 'Show on chart', a: 'Activates that strategy and focuses the chart on it.' },
      { q: 'not activated', a: 'The strategy is not in your active list yet. It was still checked for the plan.' },
    ],
  },
  {
    id: 'analyst',
    title: 'Trade analyst panel — several analysts, one answer',
    intro: 'Press "Analyse now". Several analysts look at the same facts at the same time: all 15 strategies on 5m, 15m, 30m and 1H, how each has done in the past on this market, the next trigger prices, big news coming up, and the daily picture (the daily trend of the asset, the US dollar, US interest rates and recent headlines). Each one answers on its own; the panel then counts the votes.',
    items: [
      { q: 'Who the analysts are', a: 'The rule-based analyst (built in, always on) plus every AI whose key is set: two Google Gemini models with one free key, and optionally Groq, Cerebras, Mistral, OpenRouter, GitHub Models, Hugging Face, Ollama on your own computer, or Claude. Open "Add more free AI analysts" in the panel for the links.' },
      { q: '"3 of 4 analysts say BUY"', a: 'The vote. A BUY or SELL is shown only when more than half of the analysts that answered agree and almost none say the opposite (with fewer than four analysts: none). Otherwise the answer is WAIT.' },
      { q: 'In simple words', a: 'The whole plan in one or two sentences: what to do, at which price, where to take profit and where to get out if it goes wrong.' },
      { q: 'Levels from …', a: 'When several analysts agree, the entry, stop loss and take profit shown come from the most confident of them. Each analyst’s own levels are in "What each analyst said".' },
      { q: 'What to wait for', a: 'For WAIT, the price or condition each analyst is watching. Nothing to do until one of them happens.' },
      { q: 'Big picture (daily)', a: 'Background from the latest Research report: whether the asset is in a daily uptrend or downtrend, the dollar and US yields (gold usually moves the opposite way to both) and recent headlines. The report refreshes itself in the background when it is older than six hours.' },
      { q: 'No answer', a: 'That analyst failed this time (free limit used up, service busy, key problem); the reason is shown next to it. The vote uses the analysts that did answer.' },
      { q: 'Are the prices real?', a: 'Yes. The AIs cannot type prices: they can only choose from the real entry, stop, target and trigger prices the strategies produced, and every plan is checked (direction, stop on the right side, reward at least equal to the risk) before it is shown.' },
      { q: 'Confidence', a: 'How strongly and consistently the evidence and the analysts agree — not the chance of winning. Analysts can be wrong together.' },
    ],
  },
  {
    id: 'strategies',
    title: 'Strategies — activating and comparing',
    intro: 'A strategy is a fixed set of rules (for example "buy when the price breaks the 20-candle high"). You can activate up to 6 at a time to see them on the chart and in signal cards.',
    items: [
      { q: 'Activate strategy / Deactivate', a: 'Adds or removes the strategy from your chart and signal cards. Each active strategy keeps its own colour.' },
      { q: 'Search strategies / Hide library', a: 'Filter the list by name or type; hide the list when you are done choosing.' },
      { q: 'Categories', a: 'Trend following, mean reversion, momentum, breakout, volatility, price action / Smart Money, intraday. They behave differently in trending and sideways markets.' },
      { q: 'experimental / approved / awaiting validation / deprecated', a: 'Review status set by an administrator. Deprecated strategies cannot be activated. "Experimental" is the default and means "not reviewed yet", not "broken".' },
      { q: 'outside the selected timeframe', a: 'The strategy was designed for other timeframes. It still runs, but results may be worse.' },
      { q: 'Agreement banner (BUY / SELL / NO TRADE)', a: 'Combines your active strategies. Strategies of the same family count once. It says BUY or SELL only when at least two independent families agree and none disagree. The confluence score is the share of families that agree — it is NOT a probability of winning.' },
    ],
  },
  {
    id: 'chart',
    title: 'Chart — reading the drawings',
    intro: 'The chart shows real candles. By default each active strategy only shows small numbered arrows; switch on "indicators" or click a strategy name for the full drawing.',
    items: [
      { q: 'Numbered arrows (1, 2, 1,3…)', a: 'Entry signals. The number is the strategy’s number above the chart. A green/red arrow with several numbers means several strategies signalled on the same candle. ★ = strong signal.' },
      { q: 'indicators (checkbox)', a: 'Draws that strategy in detail: its own indicator lines, big BUY/SELL arrows with the entry price, every trade’s entry/stop/target lines, and exits.' },
      { q: 'Click a strategy name (focus)', a: 'Shows only that strategy and moves the chart so its open trade’s entry is visible.' },
      { q: 'Corner box ("1. SELL @ 4,008.95")', a: 'The open trade of the focused/detailed strategy, with its stop and targets.' },
      { q: 'Big ▲ BUY / ▼ SELL + price', a: 'Where a trade was entered. The signal confirms when the candle closes; the price shown is the fill at the next candle’s open.' },
      { q: 'Lines on the right axis (entry / SL / TP1…)', a: 'The levels of trades that are open right now.' },
      { q: 'Red and green step lines', a: 'Stop-loss (red, thicker) and targets (green) of each past trade, drawn only while that trade was open. A stop that moves up/down shows breakeven or trailing.' },
      { q: 'Green / red dots (TP1, SL -1.00R, Rule exit…)', a: 'Where trades ended and the result in R (see Glossary).' },
      { q: 'Sweep, CHoCH, BOS, FVG labels', a: 'Smart Money Concepts events used by the SMC strategy (see Glossary). In the simple view only the events that led to each entry are labelled.' },
      { q: 'full detail (checkbox)', a: 'Shows every sweep, structure break, fair value gap, order block and liquidity line — more information, more clutter.' },
      { q: 'Hover text under the chart', a: 'Move the mouse over a candle with a label to read the full explanation, including the rules that were true.' },
      { q: 'Zoom and move', a: 'Use the mouse wheel to zoom and drag to move back in time.' },
    ],
  },
  {
    id: 'cards',
    title: 'Signal cards — one per active strategy',
    intro: 'Below the chart, each active strategy has a card with its current status and its track record on this market.',
    items: [
      { q: 'BUY / SELL / NO TRADE', a: 'The strategy’s current position on this market and timeframe.' },
      { q: 'Confirmed entry · new / active', a: '"New" = the signal happened on the last finished candle. "Active" = an earlier trade is still open (stop and targets not hit yet).' },
      { q: 'Developing setup — not an entry', a: 'The first condition happened but confirmation is missing. Do not treat it as a signal.' },
      { q: 'rule score', a: 'How many of the strategy’s own conditions were true (0–100). Not a probability.' },
      { q: 'Why — rule checks', a: '✓ = condition true, ✗ = not true, at the signal candle.' },
      { q: 'What invalidates it', a: 'What would end the trade: hitting the stop, an exit rule, or an opposite signal.' },
      { q: 'Rules', a: 'The full entry and exit rules in words.' },
      { q: 'Out-of-sample (last 30%) / All loaded history', a: 'Results of this strategy on the loaded candles. "Out-of-sample" is the most recent 30% — the fairest test. See the Glossary for win rate, break-even, exp, PF and max DD.' },
      { q: 'Small sample — weak evidence', a: 'Fewer than 30 trades: the numbers could easily be luck.' },
      { q: 'Save opportunity', a: 'Saves the current BUY/SELL with its levels for tracking (only possible when there is a trade).' },
      { q: 'Focus on chart', a: 'Same as clicking the strategy’s name above the chart.' },
      { q: 'Pine script', a: 'Opens the TradingView version of this strategy. If an identical script was made before, it is reused instead of creating a new one.' },
    ],
  },
  {
    id: 'ranking',
    title: 'Strategy ranking — which strategies have worked here',
    intro: 'Press "Test all strategies" to run all 15 on the same candles, with the same costs, and rank them.',
    items: [
      { q: 'Evidence: sufficient / insufficient / no trades', a: '"Sufficient" needs at least 30 trades and 10 in the recent (out-of-sample) part — an administrator can change these numbers. Only "sufficient" strategies get a rank number.' },
      { q: 'OOS expectancy', a: 'Average result per trade, after costs, in the most recent 30% of the data. Positive = made money on average.' },
      { q: 'Activate', a: 'Adds the strategy to your dashboard.' },
      { q: 'Important', a: 'A good past result on one market and period does not mean it will continue. Trend strategies, for example, do well in strong trends and badly in sideways markets.' },
    ],
  },
  {
    id: 'saved',
    title: 'Saved opportunities — tracking paper trades',
    intro: 'Each row is a signal you saved. The saved record never changes; "Evaluate" checks what happened afterwards.',
    items: [
      { q: 'Saved', a: 'How long ago you saved it.' },
      { q: 'Asset', a: 'Market and timeframe (e.g. XAUUSDT · 1H) and what kind of product it is.' },
      { q: 'Strategy · v16b5ffe · signal …', a: 'The strategy, its version code (the exact rules used) and the time of the signal candle.' },
      { q: 'Snapshot', a: 'Click to see the reasons and agreement at the moment you saved.' },
      { q: 'Side', a: 'BUY or SELL.' },
      { q: 'Entry / stop / targets', a: 'In this order: entry price / stop-loss / TP1 / TP2 / TP3. Example: 4,023.75 / 4,007.02 / 4,040.48 / 4,057.20 / 4,090.66.' },
      { q: 'pending', a: 'No full candle has finished since you saved, so there is nothing to measure yet. Only candles that opened after saving count. For a 1H trade saved at 13:20, wait until 15:00.' },
      { q: 'target', a: 'TP1 was reached before the stop.' },
      { q: 'stopped', a: 'The stop was reached first. If the stop and the target were both touched inside one candle, it counts as stopped (to be safe).' },
      { q: 'open', a: 'Neither the stop nor TP1 has been reached yet; the current result is shown in R.' },
      { q: 'best / worst', a: 'The furthest the price moved in your favour (best) and against you (worst), in R.' },
      { q: 'Evaluate / delete', a: 'Evaluate checks the latest candles. The bin icon deletes the record.' },
    ],
  },
  {
    id: 'tradingview',
    title: 'Pine Script & TradingView',
    link: { href: '/scripts', label: 'Open Scripts & Launcher' },
    intro: 'Every strategy can be exported as a Pine Script v6 file to run on TradingView. TradingView has no way for other apps to log in or run scripts for you, so this is a copy-and-paste step.',
    steps: [
      'Click "Pine script" on a signal card (or open Scripts & Launcher).',
      'Click Copy.',
      'In TradingView open the Pine Editor, create a new script, press Cmd/Ctrl + A and Delete so the editor is completely empty.',
      'Paste, click Save, then "Add to chart". Use the same symbol and timeframe as in the platform.',
      'Optional: record the compile result in the app so others know the script was checked in TradingView.',
    ],
    items: [
      { q: 'Error CE10243 "Your script has 2 declarations"', a: 'The editor was not empty — TradingView’s own starter code (indicator("My script")) is still there. Select all, delete, then paste again.' },
      { q: 'Validation (errors / warnings)', a: 'The app checks the script before you copy it. These checks are not the same as TradingView’s compiler; a script is only "compiled" when you record a TradingView result.' },
      { q: 'Versions & diff', a: 'Every change creates a new version you can compare or restore.' },
      { q: 'Alerts & webhooks', a: 'How to create TradingView alerts from the script’s signals.' },
    ],
  },
  {
    id: 'discovery',
    title: 'Strategy Discovery',
    link: { href: '/discover', label: 'Open Strategy Discovery' },
    intro: 'Famous published trading methods (Turtle Traders, Larry Connors, Linda Raschke, John Bollinger, Ichimoku, Toby Crabel, John Carter, ICT/Smart Money).',
    items: [
      { q: 'close / approximation / not implemented', a: 'How closely this platform’s version follows the published rules. Click the "differences" line to see exactly what is different.' },
      { q: 'Originator results: published claims only / none public', a: 'No verified trading records of these people are available, so the platform never shows their returns or win rates.' },
      { q: 'Test on dashboard', a: 'Activates the matching strategy on your dashboard so you can see its results on your market.' },
      { q: 'Follow', a: 'Marks the method so it appears at the top of the list.' },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced tools',
    intro: 'Optional tools for building and studying strategies in depth.',
    items: [
      { q: 'Scripts Overview', a: <>A summary of your saved scripts, favourites, recent test imports and the latest market research. <L to="/overview">Open</L></> },
      { q: 'Strategy Builder', a: <>Describe a strategy in plain English, start from a template, or combine several strategies into one "consensus" strategy. Review the rules, risk settings and a chart preview before creating the script. <L to="/builder">Open</L></> },
      { q: 'Strategy Library', a: <>All 15 strategies and 19 indicator building blocks, each with its logic, evidence, weaknesses and sources. <L to="/library">Open</L></> },
      { q: 'Scripts & Launcher', a: <>Every generated script with its validation report, version history, explanation, chart preview and step-by-step TradingView instructions. <L to="/scripts">Open</L></> },
      { q: 'Backtest Analysis', a: <>Import the "List of trades" CSV from TradingView’s Strategy Tester to check it properly: out-of-sample results, walk-forward, higher costs, Monte Carlo (random re-ordering of trades to estimate bad-luck drawdowns) and overfitting warnings. <L to="/backtests">Open</L></> },
      { q: 'Market Research', a: <>One click collects recent news, central-bank releases, the economic calendar and sentiment from public sources and summarises the main themes and event risks. It does not predict prices. <L to="/research">Open</L></> },
      { q: 'Settings', a: <>Shows whether an AI provider is connected, the research schedule and watchlist. API keys stay on the server. <L to="/settings">Open</L></> },
    ],
  },
  {
    id: 'admin',
    title: 'Administrator',
    link: { href: '/admin', label: 'Open Administrator' },
    intro: 'For the person running the platform. It only works when an ADMIN_TOKEN is set in the server’s .env file; type that token to open it.',
    items: [
      { q: 'Usage', a: 'Most activated and most saved strategies, most used assets and timeframes.' },
      { q: 'Data providers', a: 'How often each data source worked or failed since the server started.' },
      { q: 'Scripts & integrations', a: 'Scripts awaiting a TradingView check, scripts with errors, generation failures and AI status.' },
      { q: 'Strategy review', a: 'Set a strategy to experimental, awaiting validation, approved or deprecated. Approving needs a note with the evidence. These labels never change the measured results.' },
      { q: 'Min trades / Min out-of-sample', a: 'How many trades a strategy needs before it can be ranked as "sufficient evidence".' },
    ],
  },
  {
    id: 'glossary',
    title: 'Glossary — trading words in simple English',
    intro: 'Short definitions of the terms used across the platform.',
    items: [
      { q: 'Candle', a: 'One bar on the chart showing the open, high, low and close price for one period (e.g. 1 hour).' },
      { q: 'Entry', a: 'The price where the trade starts. Here: the open of the candle after the signal.' },
      { q: 'Stop-loss (SL)', a: 'The price where a losing trade is closed to limit the loss.' },
      { q: 'Take-profit (TP1, TP2, TP3)', a: 'Prices where profit is taken. With several targets, part of the position closes at each one.' },
      { q: 'R (1R, -1R, +0.45R)', a: 'Results measured in "risk units". 1R = the distance from entry to stop. Hitting the stop = -1R. +2R = won twice what was risked.' },
      { q: 'R:R (reward-to-risk)', a: 'Distance to the final target divided by distance to the stop.' },
      { q: 'Breakeven (BE)', a: 'The stop was moved to the entry price, so the trade can no longer lose (except costs).' },
      { q: 'Trailing stop (Trail)', a: 'A stop that follows the price as the trade moves in your favour.' },
      { q: 'Rule exit', a: 'The strategy’s own exit rule closed the trade before the stop or target.' },
      { q: 'Win rate', a: 'Winning trades ÷ (winning + losing trades). Trades near zero (break-even) are counted separately.' },
      { q: 'Break-even win rate', a: 'The win rate needed to not lose money, given the average win and average loss. A strategy is profitable when its win rate is above this.' },
      { q: 'Expectancy (exp)', a: 'Average result per trade in R, after costs. Above 0 = made money on average.' },
      { q: 'Profit factor (PF)', a: 'Total gains ÷ total losses. Above 1 = profitable; 1.5+ is good; below 1 = losing.' },
      { q: 'Max drawdown (DD)', a: 'The biggest fall from a high point of the results, in R. Shows how painful the worst losing streak was.' },
      { q: 'In-sample / Out-of-sample (OOS)', a: 'The older 70% and the newer 30% of the data. Good results only in the older part often mean the strategy will not keep working.' },
      { q: 'Costs, commission, slippage', a: 'Trading is not free: results here subtract 0.05% commission per side and a small slippage (getting a slightly worse price).' },
      { q: 'Perpetual futures', a: 'A contract that follows an asset’s price without an expiry date. Holding one has small funding payments (not included in results).' },
      { q: 'Timeframe', a: 'The period of each candle: 15m, 1H, 4H, 1D…' },
      { q: 'Moving average (MA, EMA, SMA)', a: 'The average price over the last N candles — shows the trend. EMA reacts faster than SMA.' },
      { q: 'RSI', a: 'Relative Strength Index (0–100): how stretched recent moves are. High = overbought, low = oversold.' },
      { q: 'MACD', a: 'Momentum indicator comparing two moving averages; crossovers suggest momentum is turning.' },
      { q: 'ADX', a: 'Measures how strong a trend is (not its direction). Above ~20–25 = trending.' },
      { q: 'ATR', a: 'Average True Range: the typical size of a candle. Used to place stops a sensible distance away.' },
      { q: 'Bollinger Bands', a: 'Bands around a moving average that widen when the market is volatile.' },
      { q: 'Donchian channel', a: 'The highest high and lowest low of the last N candles. Breaking out of it is a classic trend signal.' },
      { q: 'Ichimoku (Tenkan, Kijun, cloud, Chikou)', a: 'A Japanese trend system. Tenkan and Kijun are fast and slow mid-lines; the cloud is support/resistance; Chikou compares the price with 26 candles ago.' },
      { q: 'VWAP', a: 'Volume-weighted average price for the day — a fair-value line many intraday traders watch.' },
      { q: 'Supertrend', a: 'A line that flips above or below the price when the trend changes.' },
      { q: 'Stochastic (%K, %D)', a: 'Shows where the close is within the recent range; crosses in extreme zones can signal turning points.' },
      { q: 'Liquidity sweep (Sweep, $)', a: 'Price briefly runs past a recent high or low (where many stop orders sit) and then closes back inside.' },
      { q: 'CHoCH (change of character)', a: 'The first break of the market structure against the previous trend — an early sign it may be turning.' },
      { q: 'BOS (break of structure)', a: 'Price breaks a swing high/low in the direction of the trend — the trend continues.' },
      { q: 'FVG (fair value gap)', a: 'A gap between three candles where price moved too fast; price often comes back to it.' },
      { q: 'Order block', a: 'The last opposite-colour candle before a strong move; often acts as support or resistance later.' },
      { q: 'Premium / discount', a: 'Above / below the middle of the recent range. Smart Money traders prefer to buy in discount and sell in premium.' },
      { q: 'Confluence', a: 'Several independent reasons pointing the same way. It describes agreement; it is not a probability.' },
      { q: 'Repainting', a: 'When a signal appears and later disappears. This platform only uses finished candles to avoid it.' },
    ],
  },
  {
    id: 'data',
    title: 'Data sources and limits',
    intro: 'Where prices come from and what to expect.',
    items: [
      { q: 'Binance (default for gold)', a: 'Real-time, free, 24/7. Used for XAUUSDT, PAXG, XAUT, crypto and Binance’s stock/commodity contracts.' },
      { q: 'Yahoo Finance', a: 'Delayed prices for COMEX futures, ETFs, forex and indices. It often limits requests ("rate limited, HTTP 429") — try again later or choose a Binance product.' },
      { q: 'Twelve Data', a: 'Spot gold (XAU/USD) and more, only if TWELVEDATA_API_KEY is set on the server.' },
      { q: 'TradingView data', a: 'TradingView does not offer its data to other apps, so the platform cannot use it. Prices may differ slightly from your TradingView chart.' },
      { q: 'Accuracy', a: 'Prices are as good as the source. The platform shows the source, time and status of every price and never invents one.' },
    ],
  },
  {
    id: 'faq',
    title: 'Troubleshooting & FAQ',
    intro: 'Common problems and what to do.',
    items: [
      { q: 'I don’t see BUY or SELL on the chart', a: 'Tick "indicators" next to the strategy or click its name. The open trade is shown in the box in the chart’s corner. If the strategy has no trade, its card says NO TRADE.' },
      { q: 'Saved opportunity says "pending"', a: 'Wait until at least one full candle has finished after you saved it, then press Evaluate.' },
      { q: '"Data unavailable" or "rate limited (HTTP 429)"', a: 'The data source refused the request. Wait a minute, or pick the same asset from Binance (e.g. XAUUSDT).' },
      { q: 'Status says STALE', a: 'The market is closed or the feed is slow. Signals are shown as of the last finished candle.' },
      { q: 'Strategies list is empty', a: 'The server was restarting; the page retries automatically. Refresh the browser if it lasts more than a minute.' },
      { q: 'Different strategies say BUY and SELL at the same time', a: 'Normal: they use different rules and timeframes. The agreement banner and Trade plans show this clearly; disagreement means lower confidence.' },
      { q: 'Results look bad', a: 'That is honest testing: costs are included and doubtful cases count as losses. Use the ranking and out-of-sample results; prefer strategies with many trades.' },
      { q: 'Administrator says "disabled"', a: 'Add ADMIN_TOKEN=some-long-secret to the .env file and restart the server.' },
      {
        q: 'How do I start the app?',
        a: (
          <>
            In a terminal run <code>cd "/Users/noahsamir/PINE Generator"</code> then <code>npm run dev</code>, and open http://localhost:5173. To test strategies from the terminal: <code>npm run rank -- binance PAXGUSDT 1D</code>.
          </>
        ),
      },
      { q: '"npm error ENOENT … package.json"', a: 'You ran the command outside the project folder. Run it from the "PINE Generator" folder.' },
    ],
  },
];

const textOf = (n: ReactNode): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join(' ') : n && typeof n === 'object' && 'props' in n ? textOf((n as { props: { children?: ReactNode } }).props.children) : '');

export function Help() {
  const { t, lang } = useI18n();
  const all = lang === 'ar' ? HELP_AR : SECTIONS;
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!query) return all;
    return all.map((s) => {
      const hitSection = `${s.title} ${textOf(s.intro)}`.toLowerCase().includes(query);
      const items = (s.items ?? []).filter((e) => `${e.q} ${textOf(e.a)}`.toLowerCase().includes(query));
      return hitSection ? s : { ...s, steps: undefined, items };
    }).filter((s) => `${s.title} ${textOf(s.intro)}`.toLowerCase().includes(query) || (s.items?.length ?? 0) > 0);
  }, [query, all]);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('Help & Support')}</h1>
          <p>{t('A simple guide to every part of the platform: what each screen does, what every word and number means, and what to do when something looks wrong.')}</p>
        </div>
        <label className="field" style={{ width: 300 }}>
          {t('Search help')}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('e.g. pending, stop-loss, CHoCH, 429')} aria-label={t('Search help')} />
        </label>
      </div>
      <div className="help-layout">
        <nav className="help-toc" aria-label={t('Contents')}>
          <div className="nav-group" style={{ margin: '0 0 6px' }}>
            {t('Contents')}
          </div>
          {all.map((s) => (
            <a key={s.id} href={`#/help`} onClick={(e) => (e.preventDefault(), document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }))}>
              {s.title.split(' — ')[0]}
            </a>
          ))}
        </nav>
        <div className="col">
          {!sections.length && <div className="card card-pad muted">{t('Nothing matches “{q}”. Try a shorter word.', { q })}</div>}
          {sections.map((s) => (
            <section key={s.id} id={`help-${s.id}`}>
              <Card title={s.title} actions={s.link && <a className="btn sm" href={`#${s.link.href}`}>{s.link.label} <Icon name="external" size={13} /></a>}>
                <p style={{ marginTop: 0 }}>{s.intro}</p>
                {s.steps && (
                  <ol className="help-steps">
                    {s.steps.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ol>
                )}
                {s.items && s.items.length > 0 && (
                  <dl className="help-list">
                    {s.items.map((e) => (
                      <div key={e.q}>
                        <dt>{e.q}</dt>
                        <dd>{e.a}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
            </section>
          ))}
          <div className="muted" style={{ fontSize: 12 }}>
            {t('Educational tool — not investment advice. Trading involves risk of loss; signals and past results do not guarantee future results.')}
          </div>
        </div>
      </div>
    </div>
  );
}
