import type { ComponentDef } from '../types';

const MA_TYPES = ['EMA', 'SMA', 'WMA', 'VWMA', 'HMA', 'RMA'];

export const maCross: ComponentDef = {
  type: 'ema',
  name: 'Moving Average Cross',
  family: 'trend',
  summary: 'Fast/slow moving-average pair. Crossovers mark trend changes; the stack order defines trend state.',
  helpers: ['f_ma'],
  doc: {
    calculation: 'Two moving averages (EMA by default) of the source: fast = MA(src, fastLen), slow = MA(src, slowLen).',
    role: 'Trend trigger (cross) or trend-state filter (stack / price location).',
    interpretation: 'Fast crossing above slow = bullish trend change; fast above slow = bullish trend state.',
    limitations: 'Lagging; whipsaws repeatedly in sideways markets. Performance depends heavily on lengths and market regime.',
    repainting: 'Does not repaint on confirmed bars. On the live bar the cross can appear and disappear until the bar closes.',
    repaintClass: 'realtime-only',
    source: 'Classic technical analysis; tested in Brock, Lakonishok & LeBaron (1992).',
  },
  params: [
    { key: 'fastLen', label: 'Fast length', type: 'int', default: 9, min: 1, max: 500 },
    { key: 'slowLen', label: 'Slow length', type: 'int', default: 21, min: 2, max: 1000 },
    { key: 'maType', label: 'MA type', type: 'string', default: 'EMA', options: MA_TYPES },
    { key: 'src', label: 'Source', type: 'source', default: 'close' },
    { key: 'show', label: 'Plot averages', type: 'bool', default: true },
  ],
  conditions: [
    { id: 'cross', label: 'Fast MA crosses slow MA', role: 'trigger', description: 'Fast MA crosses above (long) / below (short) the slow MA on this bar.', long: '$crossUp', short: '$crossDn', family: 'trend', defaultWeight: 2 },
    { id: 'stack', label: 'Fast MA above/below slow MA', role: 'filter', description: 'Trend state: fast above slow for longs, below for shorts.', long: '$fast > $slow', short: '$fast < $slow', family: 'trend', defaultWeight: 1 },
    { id: 'pullback', label: 'Pullback to fast MA then close back beyond it', role: 'trigger', description: 'Price dips through the fast MA intrabar and closes back on the trend side while the MAs are stacked.', long: '$pbL', short: '$pbS', family: 'trend', defaultWeight: 2 },
    { id: 'crossExit', label: 'Opposite MA cross (exit)', role: 'exit', description: 'Exit longs when fast crosses below slow, shorts when it crosses above.', long: '$crossDn', short: '$crossUp', family: 'trend', defaultWeight: 1 },
  ],
  emit: (ctx) => ({
    calc: [
      '$fast = f_ma(@src, @fastLen, @maType)',
      '$slow = f_ma(@src, @slowLen, @maType)',
      '$crossUp = ta.crossover($fast, $slow)',
      '$crossDn = ta.crossunder($fast, $slow)',
      '$pbL = $fast > $slow and low <= $fast and close > $fast and close > open',
      '$pbS = $fast < $slow and high >= $fast and close < $fast and close < open',
    ],
    plots: ctx.visuals
      ? [
          'plot(@show and i_showComp ? $fast : na, "Fast MA", color = color.new(#42A5F5, 0), linewidth = 1)',
          'plot(@show and i_showComp ? $slow : na, "Slow MA", color = color.new(#FFA726, 0), linewidth = 2)',
        ]
      : [],
  }),
};

export const trendFilter: ComponentDef = {
  type: 'trend',
  name: 'Trend Filter MA',
  family: 'trend',
  summary: 'Long-horizon moving average (200 by default) used as a regime filter: trade only in its direction.',
  helpers: ['f_ma'],
  doc: {
    calculation: 'MA(close, length). Slope = MA - MA[slopeBars].',
    role: 'Directional filter; optional exit when price crosses the MA.',
    interpretation: 'Close above a rising MA = bullish regime. Price location relative to a 200-period MA is a widely used regime proxy.',
    limitations: 'Very slow to react at turning points; filters out the first part of new trends.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'Faber (2007) "A Quantitative Approach to Tactical Asset Allocation" (10-month SMA filter); general practice.',
  },
  params: [
    { key: 'len', label: 'Length', type: 'int', default: 200, min: 2, max: 1000 },
    { key: 'maType', label: 'MA type', type: 'string', default: 'EMA', options: MA_TYPES },
    { key: 'slopeBars', label: 'Slope lookback (bars)', type: 'int', default: 5, min: 1, max: 100 },
    { key: 'show', label: 'Plot MA', type: 'bool', default: true },
  ],
  conditions: [
    { id: 'side', label: 'Price above/below trend MA', role: 'filter', description: 'Close above the trend MA for longs, below for shorts.', long: 'close > $ma', short: 'close < $ma', family: 'trend', defaultWeight: 2 },
    { id: 'slope', label: 'Trend MA sloping with trade', role: 'filter', description: 'MA higher (lower) than slopeBars ago.', long: '$ma > $ma[@slopeBars]', short: '$ma < $ma[@slopeBars]', family: 'trend', defaultWeight: 1 },
    { id: 'crossExit', label: 'Price crosses the MA (exit)', role: 'exit', description: 'Exit longs when close crosses above the MA (mean-reversion exit) — used by short-term pullback systems such as RSI(2).', long: '$xUp', short: '$xDn', family: 'trend', defaultWeight: 1 },
  ],
  emit: (ctx) => ({
    calc: ['$ma = f_ma(close, @len, @maType)', '$xUp = ta.crossover(close, $ma)', '$xDn = ta.crossunder(close, $ma)'],
    plots: ctx.visuals
      ? ['plot(@show and i_showComp ? $ma : na, "Trend MA", color = close > $ma ? color.new(#26A69A, 20) : color.new(#EF5350, 20), linewidth = 2)']
      : [],
  }),
};

export const supertrend: ComponentDef = {
  type: 'st',
  name: 'Supertrend (ATR)',
  family: 'trend',
  summary: 'ATR-based trailing band that flips between support and resistance; flips mark trend changes.',
  doc: {
    calculation: 'Built-in ta.supertrend(factor, atrPeriod): hl2 ± factor × ATR, ratcheting with price. direction < 0 = uptrend.',
    role: 'Trend trigger (flip) and trend-state filter; also a natural trailing stop.',
    interpretation: 'Close above the band (direction −1) = uptrend.',
    limitations: 'Lagging, whipsaws in ranges; the factor trades responsiveness against noise.',
    repainting: 'Confirmed-bar values are stable; the live bar may flip back before close.',
    repaintClass: 'realtime-only',
    source: 'Attributed to Olivier Seban; popularised on TradingView by many open-source Supertrend scripts.',
  },
  params: [
    { key: 'factor', label: 'ATR factor', type: 'float', default: 3.0, min: 0.1, max: 20, step: 0.1 },
    { key: 'atrLen', label: 'ATR period', type: 'int', default: 10, min: 1, max: 200 },
  ],
  conditions: [
    { id: 'flip', label: 'Supertrend flips direction', role: 'trigger', description: 'Direction changes to up (long) / down (short) on this bar.', long: '$flipUp', short: '$flipDn', family: 'trend', defaultWeight: 2 },
    { id: 'state', label: 'Supertrend direction agrees', role: 'filter', description: 'Supertrend is in an uptrend (long) / downtrend (short).', long: '$dir < 0', short: '$dir > 0', family: 'trend', defaultWeight: 1 },
    { id: 'flipExit', label: 'Supertrend flips against the trade (exit)', role: 'exit', description: 'Exit when the band flips against the position.', long: '$flipDn', short: '$flipUp', family: 'trend', defaultWeight: 1 },
  ],
  structureStop: { long: '$line', short: '$line' },
  emit: (ctx) => ({
    calc: [
      '[$line, $dir] = ta.supertrend(@factor, @atrLen)',
      '$flipUp = $dir < 0 and $dir[1] > 0',
      '$flipDn = $dir > 0 and $dir[1] < 0',
    ],
    plots: ctx.visuals
      ? ['plot(i_showComp ? $line : na, "Supertrend", color = $dir < 0 ? color.new(#26A69A, 0) : color.new(#EF5350, 0), style = plot.style_linebr, linewidth = 2)']
      : [],
  }),
};

export const htfBias: ComponentDef = {
  type: 'htf',
  name: 'Higher-Timeframe Trend Bias',
  family: 'trend',
  summary: 'Non-repainting higher-timeframe MA bias using request.security on the previous confirmed HTF bar.',
  helpers: ['f_ma'],
  doc: {
    calculation: 'request.security(sym, htf, [close[1], MA(close,len)[1]], lookahead = barmerge.lookahead_on): the last *completed* HTF bar close vs its MA.',
    role: 'Directional filter so lower-timeframe entries align with the higher-timeframe trend.',
    interpretation: 'HTF close above HTF MA = bullish bias.',
    limitations: 'Bias updates only when an HTF bar completes (by design). Must be a higher timeframe than the chart, otherwise results are meaningless.',
    repainting: 'Non-repainting: uses the [1] offset with lookahead_on, the pattern recommended in TradingView\'s repainting documentation.',
    repaintClass: 'htf-confirmed',
    source: 'TradingView Pine Script docs — "Repainting" and "Other timeframes and data" pages.',
  },
  params: [
    { key: 'tf', label: 'Higher timeframe', type: 'timeframe', default: '240' },
    { key: 'len', label: 'HTF MA length', type: 'int', default: 50, min: 2, max: 500 },
    { key: 'maType', label: 'MA type', type: 'string', default: 'EMA', options: MA_TYPES },
    { key: 'show', label: 'Plot HTF MA', type: 'bool', default: true },
  ],
  conditions: [
    { id: 'bias', label: 'HTF trend bias agrees', role: 'filter', description: 'Completed HTF close above (long) / below (short) the HTF MA.', long: '$cl > $ma', short: '$cl < $ma', family: 'trend', defaultWeight: 2 },
  ],
  emit: (ctx) => ({
    calc: [
      '[$cl, $ma] = request.security(syminfo.tickerid, @tf, [close[1], f_ma(close, @len, @maType)[1]], lookahead = barmerge.lookahead_on)',
      '$tfOk = timeframe.in_seconds(@tf) > timeframe.in_seconds(timeframe.period)',
    ],
    plots: ctx.visuals
      ? ['plot(@show and i_showComp ? $ma : na, "HTF MA", color = color.new(#AB47BC, 0), style = plot.style_stepline, linewidth = 2)']
      : [],
    dashboard: [{ label: 'HTF bias', value: '($cl > $ma ? "Bullish" : $cl < $ma ? "Bearish" : "Neutral") + ($tfOk ? "" : " (HTF ≤ chart TF!)")' }],
  }),
};

export const ichimoku: ComponentDef = {
  type: 'ichi',
  name: 'Ichimoku Kinko Hyo',
  family: 'trend',
  summary: 'Tenkan/Kijun cross with Kumo (cloud) location filter and Chikou confirmation.',
  doc: {
    calculation: 'Tenkan = mid of 9-bar range; Kijun = mid of 26-bar range; Span A = avg(Tenkan, Kijun); Span B = mid of 52-bar range; spans displaced forward 26 bars.',
    role: 'Trend trigger (TK cross) and trend filter (price vs. cloud, Chikou vs. past price).',
    interpretation: 'Price above the cloud with Tenkan crossing above Kijun = bullish.',
    limitations: 'Lagging; default parameters derive from a 6-day trading week. Many conditions overlap (all are range midpoints).',
    repainting: 'No repainting. The cloud is plotted with a forward offset, but signals use the cloud value that is visible at the current bar (span[displacement-1]), not future values.',
    repaintClass: 'realtime-only',
    source: 'Goichi Hosoda (1969); Patel, "Trading with Ichimoku Clouds" (2010).',
  },
  params: [
    { key: 'conv', label: 'Tenkan length', type: 'int', default: 9, min: 1, max: 200 },
    { key: 'base', label: 'Kijun length', type: 'int', default: 26, min: 1, max: 200 },
    { key: 'spanB', label: 'Span B length', type: 'int', default: 52, min: 1, max: 400 },
    { key: 'disp', label: 'Displacement', type: 'int', default: 26, min: 1, max: 200 },
  ],
  conditions: [
    { id: 'tk', label: 'Tenkan crosses Kijun', role: 'trigger', description: 'Tenkan-sen crosses above (long) / below (short) Kijun-sen.', long: '$tkUp', short: '$tkDn', family: 'trend', defaultWeight: 2 },
    { id: 'cloud', label: 'Price beyond the cloud', role: 'filter', description: 'Close above the top (long) / below the bottom (short) of the current cloud.', long: 'close > $cloudTop', short: 'close < $cloudBot', family: 'trend', defaultWeight: 2 },
    { id: 'chikou', label: 'Chikou confirms', role: 'confirmation', description: 'Close above (below) the close `displacement` bars ago.', long: 'close > close[@disp]', short: 'close < close[@disp]', family: 'trend', defaultWeight: 1 },
  ],
  emit: (ctx) => ({
    calc: [
      '$tenkan = math.avg(ta.highest(high, @conv), ta.lowest(low, @conv))',
      '$kijun = math.avg(ta.highest(high, @base), ta.lowest(low, @base))',
      '$spanA = math.avg($tenkan, $kijun)',
      '$spanB = math.avg(ta.highest(high, @spanB), ta.lowest(low, @spanB))',
      '$cloudTop = math.max($spanA[@disp - 1], $spanB[@disp - 1])',
      '$cloudBot = math.min($spanA[@disp - 1], $spanB[@disp - 1])',
      '$tkUp = ta.crossover($tenkan, $kijun)',
      '$tkDn = ta.crossunder($tenkan, $kijun)',
    ],
    plots: ctx.visuals
      ? [
          'plot(i_showComp ? $tenkan : na, "Tenkan", color = color.new(#29B6F6, 0))',
          'plot(i_showComp ? $kijun : na, "Kijun", color = color.new(#EF6C00, 0))',
          '$pA = plot(i_showComp ? $spanA : na, "Span A", color = color.new(#26A69A, 60), offset = @disp - 1)',
          '$pB = plot(i_showComp ? $spanB : na, "Span B", color = color.new(#EF5350, 60), offset = @disp - 1)',
          'fill($pA, $pB, color = $spanA > $spanB ? color.new(#26A69A, 88) : color.new(#EF5350, 88), title = "Kumo")',
        ]
      : [],
  }),
};

export const adx: ComponentDef = {
  type: 'adx',
  name: 'ADX / DMI Trend Strength',
  family: 'trend',
  summary: 'Wilder\'s Directional Movement: ADX measures trend strength, +DI/−DI give direction.',
  doc: {
    calculation: 'ta.dmi(diLen, adxSmoothing) → [+DI, −DI, ADX] (Wilder smoothing).',
    role: 'Regime filter: avoid trend strategies when ADX is low (ranging market).',
    interpretation: 'ADX above threshold = trending; +DI > −DI = bullish direction.',
    limitations: 'ADX lags and rises in strong moves of either direction; thresholds are market-dependent.',
    repainting: 'No repainting on confirmed bars.',
    repaintClass: 'realtime-only',
    source: 'J. Welles Wilder, "New Concepts in Technical Trading Systems" (1978).',
  },
  params: [
    { key: 'len', label: 'DI length', type: 'int', default: 14, min: 1, max: 200 },
    { key: 'smooth', label: 'ADX smoothing', type: 'int', default: 14, min: 1, max: 200 },
    { key: 'thr', label: 'Trend threshold', type: 'float', default: 20, min: 0, max: 100, step: 0.5 },
  ],
  conditions: [
    { id: 'trending', label: 'ADX above threshold', role: 'filter', description: 'Market is trending (ADX > threshold).', long: '$adx > @thr', short: '$adx > @thr', family: 'trend', defaultWeight: 1 },
    { id: 'di', label: '+DI/−DI direction agrees', role: 'filter', description: '+DI above −DI for longs, below for shorts.', long: '$dip > $dim', short: '$dip < $dim', family: 'trend', defaultWeight: 1 },
    { id: 'ranging', label: 'ADX below threshold (range regime)', role: 'filter', description: 'Market is NOT trending — for mean-reversion systems.', long: '$adx < @thr', short: '$adx < @thr', family: 'meanrev', defaultWeight: 1 },
  ],
  emit: () => ({
    calc: ['[$dip, $dim, $adx] = ta.dmi(@len, @smooth)'],
    dashboard: [{ label: 'ADX', value: 'str.tostring($adx, "#.0") + ($adx > @thr ? " trending" : " ranging")' }],
  }),
};
