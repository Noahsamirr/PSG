import type { ComponentDef } from '../types';

export const vwap: ComponentDef = {
  type: 'vwap',
  name: 'Anchored VWAP',
  family: 'volume',
  summary: 'Volume-weighted average price anchored to the session, week or month, with standard-deviation bands.',
  doc: {
    calculation: 'Cumulative Σ(hlc3·volume)/Σ(volume) since the anchor; bands = VWAP ± mult × volume-weighted standard deviation.',
    role: 'Intraday fair-value reference: reclaim/pullback triggers and side-of-VWAP filter.',
    interpretation: 'Price holding above session VWAP = buyers in control of the session on average.',
    limitations: 'Requires real volume. Spot FX and some CFDs on TradingView report tick volume (activity proxy), not traded volume. Not meaningful on daily+ charts with a session anchor.',
    repainting: 'No repainting on confirmed bars; the live-bar VWAP moves until close.',
    repaintClass: 'realtime-only',
    source: 'Berkowitz, Logue & Noser (1988), "The Total Cost of Transactions on the NYSE", Journal of Finance.',
  },
  params: [
    { key: 'anchor', label: 'Anchor', type: 'string', default: 'Session', options: ['Session', 'Week', 'Month'] },
    { key: 'bandMult', label: 'Band multiplier', type: 'float', default: 1.0, min: 0.1, max: 5, step: 0.1 },
  ],
  conditions: [
    { id: 'reclaim', label: 'Close reclaims VWAP', role: 'trigger', description: 'Close crosses above (long) / below (short) VWAP.', long: '$xUp', short: '$xDn', family: 'volume', defaultWeight: 2 },
    { id: 'bounce', label: 'Pullback to VWAP holds', role: 'trigger', description: 'Bar trades through VWAP and closes back on the trend side with a directional candle.', long: '$bounceL', short: '$bounceS', family: 'volume', defaultWeight: 2 },
    { id: 'side', label: 'Price on the trade side of VWAP', role: 'filter', description: 'Close above VWAP (long) / below (short).', long: 'close > $v', short: 'close < $v', family: 'volume', defaultWeight: 1 },
    { id: 'notStretched', label: 'Not stretched beyond the outer band', role: 'filter', description: 'Avoid chasing: close below the upper band (long) / above the lower band (short).', long: 'close < $up', short: 'close > $lo', family: 'meanrev', defaultWeight: 1 },
  ],
  emit: (ctx) => ({
    calc: [
      '$reset = switch @anchor',
      '    "Week" => timeframe.change("1W")',
      '    "Month" => timeframe.change("1M")',
      '    => timeframe.change("1D")',
      'var float $sPV = 0.0',
      'var float $sV = 0.0',
      'var float $sP2V = 0.0',
      'if $reset or barstate.isfirst',
      '    $sPV := 0.0',
      '    $sV := 0.0',
      '    $sP2V := 0.0',
      '$sPV += hlc3 * nz(volume)',
      '$sV += nz(volume)',
      '$sP2V += hlc3 * hlc3 * nz(volume)',
      '$v = $sV > 0 ? $sPV / $sV : hlc3',
      '$sd = $sV > 0 ? math.sqrt(math.max($sP2V / $sV - $v * $v, 0)) : 0.0',
      '$up = $v + @bandMult * $sd',
      '$lo = $v - @bandMult * $sd',
      '$xUp = ta.crossover(close, $v)',
      '$xDn = ta.crossunder(close, $v)',
      '$bounceL = low < $v and close > $v and close > open',
      '$bounceS = high > $v and close < $v and close < open',
    ],
    plots: ctx.visuals
      ? [
          'plot(i_showComp ? $v : na, "VWAP", color = color.new(#E040FB, 0), linewidth = 2, style = plot.style_linebr)',
          'plot(i_showComp ? $up : na, "VWAP upper", color = color.new(#E040FB, 65), style = plot.style_linebr)',
          'plot(i_showComp ? $lo : na, "VWAP lower", color = color.new(#E040FB, 65), style = plot.style_linebr)',
        ]
      : [],
  }),
};

export const volumeSpike: ComponentDef = {
  type: 'vol',
  name: 'Relative Volume',
  family: 'volume',
  summary: 'Volume relative to its moving average, used as participation confirmation.',
  doc: {
    calculation: 'RVOL = volume / SMA(volume, len).',
    role: 'Confirmation that a breakout or reversal occurs on above-average participation.',
    interpretation: 'RVOL above the multiplier = unusual participation.',
    limitations: 'PROXY ONLY: TradingView OHLCV volume cannot reveal bid/ask aggression, order-book depth or institutional positioning. FX volume is tick volume.',
    repainting: 'Live-bar volume grows until close; confirmed values are stable.',
    repaintClass: 'realtime-only',
    source: 'General volume analysis practice.',
  },
  params: [
    { key: 'len', label: 'Average length', type: 'int', default: 20, min: 1, max: 500 },
    { key: 'mult', label: 'Spike multiplier', type: 'float', default: 1.5, min: 0.1, max: 10, step: 0.1 },
  ],
  conditions: [
    { id: 'spike', label: 'Above-average volume', role: 'confirmation', description: 'Volume greater than mult × average volume (participation proxy).', long: '$rvol > @mult', short: '$rvol > @mult', family: 'volume', defaultWeight: 1 },
  ],
  emit: () => ({
    calc: ['$avg = ta.sma(volume, @len)', '$rvol = $avg > 0 ? volume / $avg : 0.0'],
    dashboard: [{ label: 'RVOL', value: 'str.tostring($rvol, "#.00") + "x"' }],
  }),
};
