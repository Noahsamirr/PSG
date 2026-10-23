import type { ComponentDef } from '../types';

export const rsi: ComponentDef = {
  type: 'rsi',
  name: 'RSI',
  family: 'momentum',
  summary: 'Wilder\'s Relative Strength Index for oversold/overbought reversals or momentum confirmation.',
  doc: {
    calculation: 'ta.rsi(src, len) = 100 − 100 / (1 + RMA(gains)/RMA(losses)).',
    role: 'Mean-reversion trigger (exits from extremes) or momentum filter (above/below midline).',
    interpretation: 'Crossing back above the oversold level = potential bullish reversal; RSI > 50 = bullish momentum.',
    limitations: 'Can stay overbought/oversold for long periods in strong trends; RSI and MACD/Stochastic carry overlapping momentum information.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'J. Welles Wilder (1978). Short-period RSI(2) pullback rules: Connors & Alvarez, "Short Term Trading Strategies That Work" (2008).',
  },
  params: [
    { key: 'len', label: 'RSI length', type: 'int', default: 14, min: 1, max: 200 },
    { key: 'src', label: 'Source', type: 'source', default: 'close' },
    { key: 'os', label: 'Oversold', type: 'float', default: 30, min: 0, max: 100, step: 0.5 },
    { key: 'ob', label: 'Overbought', type: 'float', default: 70, min: 0, max: 100, step: 0.5 },
    { key: 'mid', label: 'Midline', type: 'float', default: 50, min: 0, max: 100, step: 0.5 },
  ],
  conditions: [
    { id: 'reversal', label: 'RSI exits oversold/overbought', role: 'trigger', description: 'RSI crosses back above oversold (long) / below overbought (short).', long: '$xUpOS', short: '$xDnOB', family: 'meanrev', defaultWeight: 2 },
    { id: 'dip', label: 'RSI enters oversold/overbought', role: 'trigger', description: 'RSI drops below oversold (long) / rises above overbought (short) — RSI(2) pullback style entry.', long: '$xDnOS', short: '$xUpOB', family: 'meanrev', defaultWeight: 2 },
    { id: 'momentum', label: 'RSI on the trade side of midline', role: 'confirmation', description: 'RSI above (long) / below (short) the midline.', long: '$v > @mid', short: '$v < @mid', family: 'momentum', defaultWeight: 1 },
    { id: 'notExtreme', label: 'RSI not stretched against entry', role: 'filter', description: 'Long only while RSI < overbought; short only while RSI > oversold.', long: '$v < @ob', short: '$v > @os', family: 'momentum', defaultWeight: 1 },
    { id: 'midExit', label: 'RSI reaches midline (exit)', role: 'exit', description: 'Mean-reversion exit when RSI recovers to the midline.', long: '$v > @mid', short: '$v < @mid', family: 'meanrev', defaultWeight: 1 },
  ],
  emit: () => ({
    calc: [
      '$v = ta.rsi(@src, @len)',
      '$xUpOS = ta.crossover($v, @os)',
      '$xDnOB = ta.crossunder($v, @ob)',
      '$xDnOS = ta.crossunder($v, @os)',
      '$xUpOB = ta.crossover($v, @ob)',
    ],
    dashboard: [{ label: 'RSI', value: 'str.tostring($v, "#.0")' }],
  }),
};

export const macd: ComponentDef = {
  type: 'macd',
  name: 'MACD',
  family: 'momentum',
  summary: 'Moving Average Convergence Divergence: signal-line crosses with zero-line context.',
  doc: {
    calculation: 'MACD = EMA(fast) − EMA(slow); Signal = EMA(MACD, sig); Histogram = MACD − Signal (ta.macd).',
    role: 'Momentum trigger (signal cross) with zero-line location filter.',
    interpretation: 'MACD crossing above signal below the zero line = momentum turning up from a pullback.',
    limitations: 'Lagging (built from EMAs); frequent false crosses in chop; overlaps with RSI/Stochastic momentum.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'Gerald Appel (late 1970s); "Technical Analysis: Power Tools for Active Investors" (2005).',
  },
  params: [
    { key: 'fast', label: 'Fast length', type: 'int', default: 12, min: 1, max: 200 },
    { key: 'slow', label: 'Slow length', type: 'int', default: 26, min: 2, max: 400 },
    { key: 'sig', label: 'Signal length', type: 'int', default: 9, min: 1, max: 100 },
  ],
  conditions: [
    { id: 'cross', label: 'MACD crosses signal line', role: 'trigger', description: 'MACD crosses above (long) / below (short) its signal line.', long: '$xUp', short: '$xDn', family: 'momentum', defaultWeight: 2 },
    { id: 'zoneValue', label: 'Cross happens on the "value" side of zero', role: 'filter', description: 'Long crosses below zero (buying a pullback), short crosses above zero.', long: '$m < 0', short: '$m > 0', family: 'momentum', defaultWeight: 1 },
    { id: 'aboveZero', label: 'MACD on the trade side of zero', role: 'filter', description: 'MACD above zero (long) / below zero (short) — momentum-continuation variant.', long: '$m > 0', short: '$m < 0', family: 'momentum', defaultWeight: 1 },
    { id: 'hist', label: 'Histogram expanding with trade', role: 'confirmation', description: 'Histogram rising (long) / falling (short).', long: '$h > $h[1]', short: '$h < $h[1]', family: 'momentum', defaultWeight: 1 },
    { id: 'crossExit', label: 'Opposite MACD cross (exit)', role: 'exit', description: 'Exit when MACD crosses back through the signal line.', long: '$xDn', short: '$xUp', family: 'momentum', defaultWeight: 1 },
  ],
  emit: () => ({
    calc: ['[$m, $s, $h] = ta.macd(close, @fast, @slow, @sig)', '$xUp = ta.crossover($m, $s)', '$xDn = ta.crossunder($m, $s)'],
    dashboard: [{ label: 'MACD hist', value: 'str.tostring($h, format.mintick)' }],
  }),
};

export const stoch: ComponentDef = {
  type: 'stoch',
  name: 'Stochastic Oscillator',
  family: 'momentum',
  summary: '%K/%D crosses inside oversold/overbought zones.',
  doc: {
    calculation: '%K = SMA(100 × (close − lowest low)/(highest high − lowest low), smoothK); %D = SMA(%K, d).',
    role: 'Timing trigger for pullback entries, usually with a trend filter.',
    interpretation: '%K crossing above %D while below the oversold level = bullish timing signal.',
    limitations: 'Very noisy on low timeframes; overlaps with RSI.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'George Lane (1950s).',
  },
  params: [
    { key: 'kLen', label: '%K length', type: 'int', default: 14, min: 1, max: 200 },
    { key: 'smooth', label: '%K smoothing', type: 'int', default: 3, min: 1, max: 50 },
    { key: 'dLen', label: '%D length', type: 'int', default: 3, min: 1, max: 50 },
    { key: 'os', label: 'Oversold', type: 'float', default: 20, min: 0, max: 100 },
    { key: 'ob', label: 'Overbought', type: 'float', default: 80, min: 0, max: 100 },
  ],
  conditions: [
    { id: 'cross', label: '%K/%D cross in extreme zone', role: 'trigger', description: '%K crosses above %D with %D below oversold (long) / below %D with %D above overbought (short).', long: '$sigL', short: '$sigS', family: 'momentum', defaultWeight: 2 },
    { id: 'side', label: '%K above/below %D', role: 'confirmation', description: 'Short-term momentum agrees.', long: '$k > $d', short: '$k < $d', family: 'momentum', defaultWeight: 1 },
  ],
  emit: () => ({
    calc: [
      '$k = ta.sma(ta.stoch(close, high, low, @kLen), @smooth)',
      '$d = ta.sma($k, @dLen)',
      '$xUp = ta.crossover($k, $d)',
      '$xDn = ta.crossunder($k, $d)',
      '$sigL = $xUp and $d < @os',
      '$sigS = $xDn and $d > @ob',
    ],
    dashboard: [{ label: 'Stoch %K', value: 'str.tostring($k, "#.0")' }],
  }),
};

export const squeeze: ComponentDef = {
  type: 'sqz',
  name: 'Volatility Squeeze (BB inside Keltner)',
  family: 'volatility',
  summary: 'TTM-style squeeze: Bollinger Bands contract inside Keltner Channels, then "fire" with momentum direction.',
  doc: {
    calculation: 'Squeeze on when BB(len, bbMult) lies inside KC(len, kcMult × SMA(true range)). Momentum = linreg(close − avg(avg(HH, LL), SMA(close)), len).',
    role: 'Volatility-expansion breakout trigger with momentum direction.',
    interpretation: 'Squeeze turning off ("firing") with positive momentum = bullish expansion.',
    limitations: 'Direction of the release is uncertain; false fires in choppy markets. Momentum is a regression proxy, not order flow.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'John Carter, "Mastering the Trade" (TTM Squeeze); widely known via LazyBear\'s open-source "Squeeze Momentum Indicator" on TradingView.',
  },
  params: [
    { key: 'len', label: 'Length', type: 'int', default: 20, min: 2, max: 200 },
    { key: 'bbMult', label: 'BB multiplier', type: 'float', default: 2.0, min: 0.1, max: 5, step: 0.1 },
    { key: 'kcMult', label: 'KC multiplier', type: 'float', default: 1.5, min: 0.1, max: 5, step: 0.1 },
  ],
  conditions: [
    { id: 'fire', label: 'Squeeze fires with momentum', role: 'trigger', description: 'Squeeze released this bar with momentum > 0 (long) / < 0 (short).', long: '$fired and $mom > 0', short: '$fired and $mom < 0', family: 'volatility', defaultWeight: 2 },
    { id: 'mom', label: 'Squeeze momentum rising/falling', role: 'confirmation', description: 'Momentum positive and rising (long) / negative and falling (short).', long: '$mom > 0 and $mom > $mom[1]', short: '$mom < 0 and $mom < $mom[1]', family: 'momentum', defaultWeight: 1 },
    { id: 'momExit', label: 'Momentum fades (exit)', role: 'exit', description: 'Exit when momentum turns down (long) / up (short).', long: '$mom < $mom[1] and $mom[1] < $mom[2]', short: '$mom > $mom[1] and $mom[1] > $mom[2]', family: 'momentum', defaultWeight: 1 },
  ],
  emit: (ctx) => ({
    calc: [
      '$basis = ta.sma(close, @len)',
      '$dev = @bbMult * ta.stdev(close, @len)',
      '$rng = ta.sma(ta.tr(true), @len)',
      '$on = ($basis - $dev) > ($basis - @kcMult * $rng) and ($basis + $dev) < ($basis + @kcMult * $rng)',
      '$fired = $on[1] and not $on',
      '$mom = ta.linreg(close - math.avg(math.avg(ta.highest(high, @len), ta.lowest(low, @len)), ta.sma(close, @len)), @len, 0)',
    ],
    plots: ctx.visuals
      ? ['plotshape(i_showComp and $on, "Squeeze on", shape.circle, location.bottom, color.new(#FFB300, 30), size = size.tiny)']
      : [],
    dashboard: [{ label: 'Squeeze', value: '($on ? "ON" : "off") + " · mom " + str.tostring($mom, format.mintick)' }],
  }),
};
