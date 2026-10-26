// Publicly documented trading methodologies by well-known traders and educators. No platform exposes verified
// trading records for these people through an official API, so this list never shows returns or win rates of
// the originators — only the published rules, where they came from, and how faithfully this app implements them.
// Performance comes exclusively from the app's own reproducible backtest of its independent implementation.

export type Fidelity = 'close' | 'approximation' | 'not-implemented';

export interface MethodProfile {
  id: string;
  name: string;
  originator: string;
  source: string;
  published: string;
  style: string;
  markets: string;
  timeframe: string;
  entry: string;
  exit: string;
  risk: string;
  /** What kind of evidence exists about the originator's own results. */
  evidence: 'published claims only' | 'educational description' | 'none public';
  verification: string;
  templateId: string | null;
  fidelity: Fidelity;
  /** Rules that are missing, ambiguous or implemented differently. */
  differences: string[];
  licensing: string;
}

const NOT_VERIFIED = 'No verified trading record is available through an official API. Any performance shown is this app’s own backtest of an independent implementation, not the originator’s results.';
const RULES_ONLY = 'Published rules are re-implemented independently; no code or proprietary script is copied.';

export const DISCOVERY: MethodProfile[] = [
  {
    id: 'turtle',
    name: 'Turtle Trading (channel breakout)',
    originator: 'Richard Dennis & William Eckhardt (rules later published by former Turtles)',
    source: 'Curtis Faith, “Way of the Turtle” (McGraw-Hill, 2007); “The Original Turtle Trading Rules” (Faith, 2003)',
    published: '2003 / 2007',
    style: 'Trend following, breakout',
    markets: 'Liquid futures (commodities, metals, rates, FX)',
    timeframe: 'Daily',
    entry: 'Buy a 20-day high breakout (System 1) or 55-day high (System 2); short the mirror.',
    exit: 'Exit on a 10-day low (System 1) or 20-day low (System 2) for longs; mirror for shorts.',
    risk: 'Stop 2N (N = 20-day ATR); position size so 1N equals 1% of equity; pyramiding up to 4 units.',
    evidence: 'published claims only',
    verification: NOT_VERIFIED,
    templateId: 'donchian_turtle',
    fidelity: 'approximation',
    differences: ['No pyramiding (one position at a time)', 'No portfolio-level unit limits across correlated markets', 'System 1 “skip after a winning breakout” filter not implemented', 'Uses R-multiple targets in addition to channel exits'],
    licensing: RULES_ONLY,
  },
  {
    id: 'connors_rsi2',
    name: 'RSI(2) pullback',
    originator: 'Larry Connors & Cesar Alvarez',
    source: '“Short Term Trading Strategies That Work” (TradingMarkets, 2008)',
    published: '2008',
    style: 'Mean reversion in an uptrend',
    markets: 'Stock indices and ETFs (as published)',
    timeframe: 'Daily',
    entry: 'Close above the 200-day SMA and RSI(2) below 10 → buy at the close (mirror for shorts).',
    exit: 'Close above the 5-day SMA.',
    risk: 'The book argues against fixed stop-losses for this method.',
    evidence: 'published claims only',
    verification: NOT_VERIFIED,
    templateId: 'rsi2_meanrev',
    fidelity: 'close',
    differences: ['A wide ATR catastrophe stop is added so every trade has a defined risk', 'Applied to gold/crypto here, not the indices the book tested'],
    licensing: RULES_ONLY,
  },
  {
    id: 'raschke_holy_grail',
    name: '“Holy Grail” ADX pullback',
    originator: 'Linda Bradford Raschke & Larry Connors',
    source: '“Street Smarts: High Probability Short-Term Trading Strategies” (M. Gordon Publishing, 1995)',
    published: '1995',
    style: 'Trend pullback continuation',
    markets: 'Futures, stocks',
    timeframe: 'Any (daily in the book)',
    entry: 'ADX(14) above 30 and rising; price pulls back to the 20 EMA; buy stop above the high of the pullback bar.',
    exit: 'Target near the recent swing high; trail thereafter.',
    risk: 'Stop below the pullback low.',
    evidence: 'educational description',
    verification: NOT_VERIFIED,
    templateId: null,
    fidelity: 'not-implemented',
    differences: ['Not in the strategy library yet: needs a stop-order entry above the pullback bar and an “ADX rising” rule. Closest available: Stochastic Trend Pullback.'],
    licensing: RULES_ONLY,
  },
  {
    id: 'bollinger',
    name: 'Bollinger Band re-entry',
    originator: 'John Bollinger',
    source: '“Bollinger on Bollinger Bands” (McGraw-Hill, 2001); bollingerbands.com',
    published: '2001',
    style: 'Mean reversion',
    markets: 'Any liquid market',
    timeframe: 'Any',
    entry: 'Close outside a band followed by a close back inside, ideally with a %b/indicator confirmation.',
    exit: 'Middle band or opposite band.',
    risk: 'Beyond the recent extreme.',
    evidence: 'educational description',
    verification: NOT_VERIFIED,
    templateId: 'bb_meanrev',
    fidelity: 'approximation',
    differences: ['Bollinger describes several methods; this implements the band re-entry variant with an ADX range filter and a candle confirmation'],
    licensing: RULES_ONLY,
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku Tenkan/Kijun cross',
    originator: 'Goichi Hosoda',
    source: 'Ichimoku Kinko Hyo (published 1969); widely documented in English texts',
    published: '1969',
    style: 'Trend following',
    markets: 'Any',
    timeframe: 'Any (daily originally)',
    entry: 'Tenkan crosses above Kijun with price above the cloud (mirror for shorts).',
    exit: 'Opposite cross or close back inside the cloud.',
    risk: 'Kijun or cloud edge.',
    evidence: 'educational description',
    verification: NOT_VERIFIED,
    templateId: 'ichimoku_tk',
    fidelity: 'close',
    differences: ['Chikou-span confirmation not required', 'R-multiple targets added'],
    licensing: RULES_ONLY,
  },
  {
    id: 'crabel_orb',
    name: 'Opening Range Breakout',
    originator: 'Toby Crabel',
    source: '“Day Trading with Short Term Price Patterns and Opening Range Breakout” (Traders Press, 1990)',
    published: '1990',
    style: 'Intraday breakout',
    markets: 'Index and commodity futures',
    timeframe: '1–5 minute charts',
    entry: 'Buy a break above the opening range high (sell below the low) shortly after the open.',
    exit: 'End of day or a range-based target.',
    risk: 'Opposite side of the range.',
    evidence: 'published claims only',
    verification: NOT_VERIFIED,
    templateId: 'orb_breakout',
    fidelity: 'approximation',
    differences: ['Crabel’s volatility-contraction (NR4/NR7) filters are not implemented', 'Needs an exchange session; 24/7 markets like XAUUSDT perpetuals use the configured session window'],
    licensing: RULES_ONLY,
  },
  {
    id: 'carter_squeeze',
    name: 'TTM Squeeze',
    originator: 'John Carter',
    source: '“Mastering the Trade” (McGraw-Hill, 2005)',
    published: '2005',
    style: 'Volatility expansion breakout',
    markets: 'Futures, stocks',
    timeframe: 'Intraday to daily',
    entry: 'Bollinger Bands move inside Keltner Channels (squeeze), then fire in the momentum direction.',
    exit: 'Momentum histogram weakens for two bars.',
    risk: 'Recent swing or ATR multiple.',
    evidence: 'educational description',
    verification: NOT_VERIFIED,
    templateId: 'squeeze_breakout',
    fidelity: 'approximation',
    differences: ['Momentum is a linear-regression proxy, not the proprietary TTM indicator', 'Adds a 200 EMA trend filter'],
    licensing: RULES_ONLY,
  },
  {
    id: 'ict',
    name: 'Liquidity sweep → change of character → fair value gap',
    originator: 'Michael J. Huddleston (“ICT”) and the Smart Money Concepts community',
    source: 'Free public video lessons and community write-ups; no single official rulebook',
    published: '2010s–2020s',
    style: 'Price action / Smart Money Concepts',
    markets: 'FX, indices, gold',
    timeframe: '1–60 minute execution with higher-timeframe bias',
    entry: 'Price sweeps a prior high/low, shifts structure the other way, then retraces into the fair value gap.',
    exit: 'Opposing liquidity pool.',
    risk: 'Beyond the sweep extreme.',
    evidence: 'none public',
    verification: NOT_VERIFIED,
    templateId: 'smc_sweep_fvg',
    fidelity: 'approximation',
    differences: ['The concepts are discretionary; pivots, gap size and “displacement” thresholds here are mechanical choices, not official definitions', 'Order blocks / breaker blocks / premium–discount zones not used as entry rules'],
    licensing: RULES_ONLY,
  },
];
