// Simple trade plans: "SELL · Entry → TP → SL · why · who agrees", built from evaluated strategy signals.
// Agreement here is a description of the rules, not a probability.
import type { Probability, StrategySignal } from './signals';

type Dir = 1 | -1;
const pick = (dir: Dir, buy: string, sell: string) => (dir === 1 ? buy : sell);

/** One plain-English sentence per strategy explaining its entry, for each direction. */
export const WHY: Record<string, (d: Dir) => string> = {
  ema_trend: (d) => `The fast EMA crossed ${pick(d, 'above', 'below')} the slow EMA, price is ${pick(d, 'above', 'below')} the 200 EMA and ADX shows a real trend.`,
  rsi2_meanrev: (d) => pick(d, 'RSI(2) dropped below 10 (short-term oversold) while price is above the 200-period average — a dip inside an uptrend.', 'RSI(2) rose above 90 (short-term overbought) while price is below the 200-period average — a pop inside a downtrend.'),
  macd_trend: (d) => `MACD crossed ${pick(d, 'above', 'below')} its signal line on the pullback side of zero, with price ${pick(d, 'above', 'below')} the 200 EMA — the trend resuming after a pullback.`,
  bb_meanrev: (d) => `Price closed back inside the ${pick(d, 'lower', 'upper')} Bollinger Band in a ranging market (low ADX), with a rejection candle.`,
  donchian_retest: (d) => `Price broke the 20-candle ${pick(d, 'high', 'low')}, came back to retest that level and held, with price ${pick(d, 'above', 'below')} the trend average.`,
  donchian_turtle: (d) => `Price closed ${pick(d, 'above the 20-candle high', 'below the 20-candle low')} — a channel breakout — with normal volatility.`,
  vwap_pullback: (d) => `Price pulled back to VWAP and held, the fast average is ${pick(d, 'above', 'below')} the slow one, and price is not overstretched.`,
  supertrend_trend: (d) => `Supertrend flipped ${pick(d, 'up', 'down')}, price is ${pick(d, 'above', 'below')} the 200 average and ADX shows a trend.`,
  sr_bounce: (d) => pick(d, 'Price bounced off support with room up to resistance, and RSI is not overbought.', 'Price was rejected at resistance with room down to support, and RSI is not oversold.'),
  mtf_pullback: (d) => `Price pulled back to the fast average and closed back ${pick(d, 'above', 'below')} it, in line with the higher-timeframe ${pick(d, 'uptrend', 'downtrend')}.`,
  smc_sweep_fvg: (d) =>
    pick(
      d,
      'Price swept sell-side liquidity below a swing low, shifted structure up (CHoCH/BOS) and retraced into the bullish fair value gap, with the higher-timeframe trend up and price in the discount zone.',
      'Price swept buy-side liquidity above a swing high, shifted structure down (CHoCH/BOS) and retraced into the bearish fair value gap, with the higher-timeframe trend down and price in the premium zone.',
    ),
  squeeze_breakout: (d) => `A volatility squeeze released with ${pick(d, 'upward', 'downward')} momentum, and price is ${pick(d, 'above', 'below')} the 200 average.`,
  ichimoku_tk: (d) => `Tenkan crossed ${pick(d, 'above', 'below')} Kijun with price ${pick(d, 'above', 'below')} the cloud and the Chikou line confirming.`,
  orb_breakout: (d) => `First close ${pick(d, 'above', 'below')} the opening range, with price ${pick(d, 'above', 'below')} VWAP.`,
  stoch_pullback: (d) => `Stochastic %K crossed ${pick(d, 'above', 'below')} %D in the ${pick(d, 'oversold', 'overbought')} zone, price is ${pick(d, 'above', 'below')} the 200 average and ADX shows a trend.`,
};

export interface PlanPeer {
  strategyId: string;
  strategyName: string;
  family: string;
  action: 'BUY' | 'SELL';
  entry: number;
  /** Distance from this plan's entry, in this plan's stop distances. */
  distanceR: number;
  /** Same family as the plan's strategy: correlated, not independent confirmation. */
  related: boolean;
  /** The chart timeframe is inside the range this strategy was designed for. */
  tfOk: boolean;
}

export interface TradePlan {
  strategyId: string;
  strategyName: string;
  family: string;
  action: 'BUY' | 'SELL';
  isNew: boolean;
  /** The chart timeframe is inside the range this strategy was designed for. */
  tfOk: boolean;
  signalTime: string;
  entry: number;
  stop: number;
  targets: number[];
  rewardRisk: number | null;
  /** Historical probability of profit of this strategy here (share of its past trades that made money after costs). */
  probability: Probability | null;
  /** The same estimate measured only on the most recent 30% of the data. */
  probabilityRecent: Probability | null;
  why: string;
  /** Rules of the strategy that were not met at the signal candle (weighted strategies can enter without them). */
  notMet: string[];
  /** Same direction with an entry within one stop distance. */
  agree: PlanPeer[];
  /** Same direction, but entered far from this price. */
  sameDirection: PlanPeer[];
  /** Opposite direction right now. */
  disagree: PlanPeer[];
  /** Same direction, trigger seen but not confirmed yet. */
  developing: { strategyId: string; strategyName: string; family: string }[];
  independentAgree: number;
  summary: string;
}

/** Builds one plan per active BUY/SELL signal, comparing it with every other evaluated strategy. */
export function buildPlans(signals: StrategySignal[]): TradePlan[] {
  const active = signals.filter((s) => (s.state === 'BUY' || s.state === 'SELL') && s.entry !== null && s.stop !== null && s.signalTime);
  return active.map((s) => {
    const dir: Dir = s.state === 'BUY' ? 1 : -1;
    const risk = Math.abs((s.entry as number) - (s.stop as number));
    const peer = (o: StrategySignal): PlanPeer => ({
      strategyId: o.strategyId,
      strategyName: o.strategyName,
      family: o.family,
      action: o.state as 'BUY' | 'SELL',
      entry: o.entry as number,
      distanceR: risk > 0 ? Math.abs((o.entry as number) - (s.entry as number)) / risk : 0,
      related: o.family === s.family,
      tfOk: o.tfOk,
    });
    const others = active.filter((o) => o.strategyId !== s.strategyId).map((o) => ({ o, p: peer(o) }));
    const agree = others.filter(({ o, p }) => o.state === s.state && p.distanceR <= 1).map(({ p }) => p);
    const sameDirection = others.filter(({ o, p }) => o.state === s.state && p.distanceR > 1).map(({ p }) => p);
    const disagree = others.filter(({ o }) => o.state !== s.state).map(({ p }) => p);
    const developing = signals.filter((o) => o.strategyId !== s.strategyId && o.stage === 'setup' && o.setupDir === dir).map((o) => ({ strategyId: o.strategyId, strategyName: o.strategyName, family: o.family }));
    const independentAgree = new Set(agree.filter((p) => !p.related).map((p) => p.family)).size;
    const why = WHY[s.strategyId]?.(dir) ?? s.reasons.filter((r) => r.met).map((r) => r.label).join('; ');
    const notMet = s.reasons.filter((r) => !r.met).map((r) => r.label);
    const summary = !agree.length && !disagree.length ? 'No other strategy has a trade right now — this signal stands alone.' : `${agree.length} strateg${agree.length === 1 ? 'y agrees' : 'ies agree'} on this entry (${independentAgree} independent famil${independentAgree === 1 ? 'y' : 'ies'}), ${disagree.length} disagree${disagree.length === 1 ? 's' : ''}.`;
    return {
      strategyId: s.strategyId,
      strategyName: s.strategyName,
      family: s.family,
      action: s.state as 'BUY' | 'SELL',
      isNew: s.isNew,
      tfOk: s.tfOk,
      signalTime: s.signalTime as string,
      entry: s.entry as number,
      stop: s.stop as number,
      targets: s.targets,
      rewardRisk: s.rewardRisk,
      probability: s.probability?.all ?? null,
      probabilityRecent: s.probability?.outOfSample ?? null,
      why,
      notMet,
      agree,
      sameDirection,
      disagree,
      developing,
      independentAgree,
      summary,
    };
  });
}

/**
 * The one answer per timeframe: among strategies designed for this timeframe, the trade with the most independent
 * agreement, then the fewest opposing signals, then the better-measured chance of profit, then the newest.
 */
export function pickAnswer(plans: TradePlan[]): TradePlan | null {
  const ok = plans.filter((p) => p.tfOk);
  const prob = (p: TradePlan) => (p.probability && p.probability.n >= 20 ? p.probability.p : 0);
  const sorted = [...ok].sort(
    (a, b) =>
      b.independentAgree - a.independentAgree ||
      b.agree.length - b.disagree.length - (a.agree.length - a.disagree.length) ||
      prob(b) - prob(a) ||
      Date.parse(b.signalTime) - Date.parse(a.signalTime),
  );
  return sorted[0] ?? null;
}

/** Chance of profit in plain words, e.g. "33% — 2 of the last 6 similar trades made money". */
export function chanceText(p: TradePlan['probability']): { headline: string; detail: string; rough: boolean } {
  if (!p) return { headline: 'Not measured yet', detail: 'This strategy has no finished past trades on this market and timeframe.', rough: true };
  const wins = Math.round(p.p * p.n);
  return {
    headline: `${Math.round(p.p * 100)}%`,
    detail: `${wins} of ${p.n} past trades like this made money after costs.`,
    rough: p.n < 20,
  };
}

