import { describe, expect, it } from 'vitest';
import { generatePine, parsePrompt, plannedRR, runValidation, specFromPrompt } from '../src/core';

describe('natural-language interpreter', () => {
  it('turns the reference XAUUSD request into the expected specification', () => {
    const { spec, log } = specFromPrompt('Generate a Pine Script v6 strategy for XAUUSD on the 15-minute timeframe. Use liquidity sweeps, BOS, FVG, an EMA trend filter, RSI confirmation, ATR-based stop-loss, and a 1:2 minimum risk-to-reward ratio. Display clear buy and sell entries, stop-loss, three take-profit levels, and alerts.');
    expect(spec.market).toMatchObject({ symbol: 'XAUUSD', timeframe: '15', assetClass: 'commodities' });
    expect(spec.output).toBe('strategy');
    expect(spec.meta.templateIds).toContain('smc_sweep_fvg');
    const refs = spec.strategies[0].conditions.map((c) => c.ref);
    expect(refs).toEqual(expect.arrayContaining(['smc.sequence', 'trend.side', 'rsi.momentum']));
    expect(spec.risk.stopMode).toBe('ATR');
    expect(spec.risk.tpCount).toBe(3);
    expect(spec.risk.minRR).toBe(2);
    expect(plannedRR(spec)).toBeGreaterThanOrEqual(2);
    expect(log.join(' ')).toMatch(/Recognised/);
    const v = runValidation(spec, generatePine(spec).code);
    expect(v.errorCount).toBe(0);
  });
  it('detects consensus requests', () => {
    const i = parsePrompt('all strategies must agree on a strong entry for BTCUSDT 4h');
    expect(i.consensus).toBe(true);
    const { spec } = specFromPrompt('all strategies must agree on a strong entry for BTCUSDT 4h');
    expect(spec.consensus.enabled).toBe(true);
    expect(spec.strategies.length).toBeGreaterThan(5);
  });
  it('raises higher-timeframe filters above the chart timeframe', () => {
    const { spec } = specFromPrompt('consensus of all strategies for EURUSD 1h');
    for (const c of spec.components.filter((x) => x.type === 'htf')) expect(['240', '1D', '1W']).toContain(c.params.tf);
  });
  it('parses risk, direction and sessions', () => {
    const i = parsePrompt('ES 5m opening range breakout, risk 0.5% per trade, long only, trailing stop, New York session');
    expect(i.templates).toContain('orb_breakout');
    expect(i.risk.riskPct).toBe(0.5);
    expect(i.direction).toBe('long');
    expect(i.risk.trailing).toBe(true);
    expect(i.session?.timezone).toBe('America/New_York');
  });
});
