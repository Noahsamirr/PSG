import type { ComponentDef } from '../types';

export const bollinger: ComponentDef = {
  type: 'bb',
  name: 'Bollinger Bands',
  family: 'meanrev',
  summary: 'SMA ± k standard deviations. Re-entry into the bands for mean reversion, or band breakouts for expansion.',
  doc: {
    calculation: 'ta.bb(close, len, mult) → [basis = SMA, upper = basis + mult·σ, lower = basis − mult·σ].',
    role: 'Mean-reversion trigger (close back inside after a band pierce), breakout trigger, and basis exit.',
    interpretation: 'Close crossing back above the lower band = stretched move snapping back.',
    limitations: 'In strong trends price "walks the band" and re-entries fail. Standard deviation assumes a stable distribution that markets do not have.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'John Bollinger, "Bollinger on Bollinger Bands" (2001).',
  },
  params: [
    { key: 'len', label: 'Length', type: 'int', default: 20, min: 2, max: 500 },
    { key: 'mult', label: 'StdDev multiplier', type: 'float', default: 2.0, min: 0.1, max: 6, step: 0.1 },
  ],
  conditions: [
    { id: 'reentry', label: 'Close re-enters the bands', role: 'trigger', description: 'Close crosses back above the lower band (long) / below the upper band (short).', long: '$reL', short: '$reS', family: 'meanrev', defaultWeight: 2 },
    { id: 'breakout', label: 'Close breaks outside the bands', role: 'trigger', description: 'Close crosses above the upper band (long) / below the lower band (short).', long: '$brkL', short: '$brkS', family: 'volatility', defaultWeight: 2 },
    { id: 'belowBasis', label: 'Price on the discount side of the basis', role: 'filter', description: 'Close below the basis for longs, above for shorts (room to revert).', long: 'close < $mid', short: 'close > $mid', family: 'meanrev', defaultWeight: 1 },
    { id: 'basisExit', label: 'Price returns to the basis (exit)', role: 'exit', description: 'Exit when close reaches the middle band.', long: 'close >= $mid', short: 'close <= $mid', family: 'meanrev', defaultWeight: 1 },
  ],
  emit: (ctx) => ({
    calc: [
      '[$mid, $up, $lo] = ta.bb(close, @len, @mult)',
      '$reL = ta.crossover(close, $lo)',
      '$reS = ta.crossunder(close, $up)',
      '$brkL = ta.crossover(close, $up)',
      '$brkS = ta.crossunder(close, $lo)',
    ],
    plots: ctx.visuals
      ? [
          'plot(i_showComp ? $mid : na, "BB basis", color = color.new(#FFB74D, 30))',
          '$pU = plot(i_showComp ? $up : na, "BB upper", color = color.new(#64B5F6, 40))',
          '$pL = plot(i_showComp ? $lo : na, "BB lower", color = color.new(#64B5F6, 40))',
          'fill($pU, $pL, color = color.new(#64B5F6, 94), title = "BB fill")',
        ]
      : [],
  }),
};

export const atrRegime: ComponentDef = {
  type: 'atrf',
  name: 'Volatility Regime (ATR)',
  family: 'volatility',
  summary: 'Filters by normalised volatility: avoid dead markets and extreme volatility spikes.',
  doc: {
    calculation: 'ATR% = 100 × ATR(len)/close; expansion = ATR > SMA(ATR, baseLen).',
    role: 'Volatility filter — trade only when volatility is in a workable band, or expanding.',
    interpretation: 'ATR above its own average = expanding volatility (favourable for breakouts).',
    limitations: 'Thresholds are instrument-specific; ATR% of FX pairs and crypto differ by an order of magnitude.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'Wilder (1978) Average True Range.',
  },
  params: [
    { key: 'len', label: 'ATR length', type: 'int', default: 14, min: 1, max: 200 },
    { key: 'baseLen', label: 'ATR baseline length', type: 'int', default: 50, min: 2, max: 500 },
    { key: 'minPct', label: 'Min ATR % of price', type: 'float', default: 0.05, min: 0, max: 50, step: 0.01 },
    { key: 'maxPct', label: 'Max ATR % of price', type: 'float', default: 10, min: 0, max: 100, step: 0.1 },
  ],
  conditions: [
    { id: 'band', label: 'Volatility within workable band', role: 'filter', description: 'ATR% between min and max.', long: '$pct >= @minPct and $pct <= @maxPct', short: '$pct >= @minPct and $pct <= @maxPct', family: 'volatility', defaultWeight: 1 },
    { id: 'expanding', label: 'Volatility expanding', role: 'filter', description: 'ATR above its baseline average.', long: '$atr > $base', short: '$atr > $base', family: 'volatility', defaultWeight: 1 },
  ],
  emit: () => ({
    calc: ['$atr = ta.atr(@len)', '$base = ta.sma($atr, @baseLen)', '$pct = 100 * $atr / close'],
    dashboard: [{ label: 'ATR %', value: 'str.tostring($pct, "#.00") + "%"' }],
  }),
};
