import type { ComponentDef, ConditionDef } from '../types';
import { adx, htfBias, ichimoku, maCross, supertrend, trendFilter } from './trend';
import { macd, rsi, squeeze, stoch } from './momentum';
import { atrRegime, bollinger } from './volatility';
import { volumeSpike, vwap } from './volume';
import { candles, donchian, openingRange, pivotSR, smc } from './structure';

export const COMPONENTS: ComponentDef[] = [
  maCross,
  trendFilter,
  supertrend,
  htfBias,
  ichimoku,
  adx,
  rsi,
  macd,
  stoch,
  squeeze,
  bollinger,
  atrRegime,
  vwap,
  volumeSpike,
  donchian,
  pivotSR,
  smc,
  openingRange,
  candles,
];

const byType = new Map(COMPONENTS.map((c) => [c.type, c]));

export function getComponent(type: string): ComponentDef {
  const c = byType.get(type);
  if (!c) throw new Error(`Unknown component type "${type}"`);
  return c;
}

export function hasComponent(type: string): boolean {
  return byType.has(type);
}

export function getCondition(type: string, conditionId: string): ConditionDef | undefined {
  return byType.get(type)?.conditions.find((c) => c.id === conditionId);
}

/** Pine helper functions, emitted once when any component lists them. */
export const HELPERS: Record<string, string[]> = {
  f_ma: [
    'f_ma(series float src, simple int len, simple string maType) =>',
    '    switch maType',
    '        "SMA" => ta.sma(src, len)',
    '        "WMA" => ta.wma(src, len)',
    '        "VWMA" => ta.vwma(src, len)',
    '        "HMA" => ta.hma(src, len)',
    '        "RMA" => ta.rma(src, len)',
    '        => ta.ema(src, len)',
  ],
};
