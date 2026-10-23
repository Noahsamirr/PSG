import { describe, expect, it } from 'vitest';
import { consensusFromPreset, generatePine, specFromPrompt, specFromTemplate, TEMPLATES, validateSpec } from '../src/core';
import { pickSharedTimeframe, rangeLabel, tfInRange, tfLabel } from '../src/core/timeframe';

describe('timeframe helpers', () => {
  it('labels TradingView timeframes', () => {
    expect(['1', '15', '60', '240', '1D', '1W'].map(tfLabel)).toEqual(['1m', '15m', '1H', '4H', '1D', '1W']);
    expect(rangeLabel(['5', '60'])).toBe('5m–1H');
  });
  it('picks a shared timeframe and names strategies outside it', () => {
    const c = pickSharedTimeframe([
      { name: 'A', range: ['15', '240'], preferred: '60' },
      { name: 'B', range: ['60', '1D'], preferred: '240' },
      { name: 'C', range: ['1', '5'], preferred: '5' },
    ]);
    expect(tfInRange(c.timeframe, ['60', '240'])).toBe(true);
    expect(c.outside).toEqual(['C']);
  });
});

describe('every script has a defined timeframe', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: recommended chart is inside its designed range`, () => {
      expect(t.chartTimeframe && t.tfRange).toBeTruthy();
      expect(tfInRange(t.chartTimeframe!, t.tfRange!)).toBe(true);
      const spec = specFromTemplate(t.id);
      expect(spec.market.timeframe).toBe(t.chartTimeframe);
      expect(spec.market.timeframeNote).toMatch(/recommended/);
    });
  }
  it('consensus specs get a timeframe, range and explanation', () => {
    const s = consensusFromPreset('trend_consensus');
    expect(s.market.timeframe).toBeTruthy();
    expect(s.market.timeframeRange).toBeTruthy();
    expect(s.market.timeframeNote).toMatch(/Turtle/);
  });
  it('tells the user when the request had no timeframe', () => {
    const r = specFromPrompt('SMC liquidity sweep FVG strategy for XAUUSD');
    expect(r.spec.market.timeframe).toBe('15');
    expect(r.log.join(' ')).toMatch(/No timeframe in your request — using the recommended 15m/);
  });
  it('warns when the requested timeframe is outside the designed range', () => {
    const r = specFromPrompt('VWAP pullback on NQ 4h');
    expect(r.log.join(' ')).toMatch(/outside the designed range/);
    expect(validateSpec(r.spec).some((d) => d.check === 'timeframe-consistency' && d.severity === 'warning')).toBe(true);
  });
  it('generated scripts state the timeframe and guard it', () => {
    const { code } = generatePine(specFromTemplate('smc_sweep_fvg'));
    expect(code).toMatch(/\/\/ TIMEFRAME: set your chart to 15m\. Designed for 5m–1H charts/);
    expect(code).toMatch(/tfOk = timeframe\.in_seconds\(\) >= timeframe\.in_seconds\("5"\) and timeframe\.in_seconds\(\) <= timeframe\.in_seconds\("60"\)/);
    expect(code).toMatch(/canTrade = tfAllowed and /);
    expect(code).toMatch(/table\.cell\(tfWarn, 0, 0, "⚠ Chart timeframe "/);
    expect(code).toMatch(/i_tfGuard = input\.string\("Warn", "Chart timeframe guard"/);
  });
  it('honours the block-entries guard setting', () => {
    const s = specFromTemplate('ema_trend');
    s.market.timeframeGuard = 'block';
    expect(generatePine(s).code).toMatch(/i_tfGuard = input\.string\("Block entries"/);
  });
});
