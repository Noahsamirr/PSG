import { describe, expect, it } from 'vitest';
import { COMPONENTS, CONSENSUS_PRESETS, consensusFromPreset, specFromTemplate, TEMPLATES } from '../src/core';
import { SIMS, inSession, resample } from '../src/core/sim/components';
import { runSimulation, type Bar } from '../src/core/sim/engine';
import * as T from '../src/core/sim/series';
import { parseOhlcCsv } from '../src/web/components/ChartPreview';

// Deterministic synthetic market: trend + cycles + noise, 15-minute bars.
function market(n = 1500, seed = 7): Bar[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const bars: Bar[] = [];
  let p = 2000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 90) * 1.2 + Math.sin(i / 23) * 0.6;
    const o = p;
    const c = Math.max(1, o + drift + rnd() * 6);
    const h = Math.max(o, c) + Math.abs(rnd()) * 4;
    const l = Math.min(o, c) - Math.abs(rnd()) * 4;
    bars.push({ t: Date.UTC(2026, 0, 5) + i * 15 * 60000, o, h, l, c, v: 1000 + Math.abs(rnd()) * 500 });
    p = c;
  }
  return bars;
}

describe('series functions match Pine definitions', () => {
  it('sma / ema / rma seed and smooth like Pine', () => {
    const x = [1, 2, 3, 4, 5, 6];
    expect(T.sma(x, 3).slice(2)).toEqual([2, 3, 4, 5]);
    expect(T.ema(x, 3)[2]).toBe(2); // seeded with SMA
    expect(T.ema(x, 3)[3]).toBeCloseTo(3);
    expect(T.rma(x, 3)[3]).toBeCloseTo((2 * 2 + 4) / 3);
  });
  it('rsi is 100 on a steady rise and 0 on a steady fall', () => {
    const up = Array.from({ length: 30 }, (_, i) => i);
    expect(T.rsi(up, 14)[29]).toBe(100);
    expect(T.rsi(up.map((v) => -v), 14)[29]).toBe(0);
  });
  it('linreg is exact on a straight line', () => {
    const line = Array.from({ length: 20 }, (_, i) => 3 * i + 1);
    expect(T.linreg(line, 10)[19]).toBeCloseTo(58);
  });
  it('pivots are reported `right` bars after the pivot', () => {
    const h = [1, 2, 3, 9, 3, 2, 1];
    const ph = T.pivothigh(h, 2, 2);
    expect(ph[5]).toBe(9);
    expect(ph.filter((v) => !Number.isNaN(v))).toEqual([9]);
  });
  it('crossover / barssince', () => {
    expect(T.crossover([1, 2, 3], [2, 2, 2])).toEqual([false, false, true]);
    expect(T.barssince([false, true, false, false])).toEqual([NaN, 0, 1, 2]);
  });
  it('supertrend follows a strong uptrend', () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1 }));
    const [, dir] = T.supertrend(bars, 3, 10);
    expect(dir[59]).toBe(-1);
  });
});

describe('component simulations', () => {
  it('cover every component and condition', () => {
    const ctx = { bars: market(400), chartTf: '15' };
    for (const c of COMPONENTS) {
      expect(SIMS[c.type], c.type).toBeTruthy();
      const params = Object.fromEntries(c.params.map((p) => [p.key, p.default]));
      const sim = SIMS[c.type](ctx, params);
      for (const k of c.conditions) {
        expect(sim.conds[k.id], `${c.type}.${k.id}`).toBeTruthy();
        expect(sim.conds[k.id].L).toHaveLength(400);
      }
    }
  });
  it('higher-timeframe values use the previous completed bucket', () => {
    const bars = market(16);
    const { htf, idx } = resample(bars, '60');
    expect(htf).toHaveLength(4);
    expect(idx.slice(0, 5)).toEqual([0, 0, 0, 0, 1]);
    expect(htf[0].c).toBe(bars[3].c);
  });
  it('sessions respect time zones', () => {
    const t = Date.UTC(2026, 0, 13, 14, 45); // 09:45 New York
    expect(inSession(t, '0930-1000', 'America/New_York')).toBe(true);
    expect(inSession(t, '0930-1000', 'UTC')).toBe(false);
  });
});

describe('preview engine', () => {
  const bars = market();
  const specs = [...TEMPLATES.map((t) => specFromTemplate(t.id)), ...CONSENSUS_PRESETS.map((p) => consensusFromPreset(p.id))];
  for (const spec of specs) {
    it(`${spec.meta.name} runs with consistent trade mechanics`, () => {
      const r = runSimulation(spec, bars, { chartTf: '15', qtyStep: 0.0001 });
      expect(r.stats.trades).toBe(r.trades.length);
      for (const t of r.trades) {
        // Strategy mode: market orders fill on the bar after the signal.
        expect(t.entryBar).toBe(spec.backtest.fillMode === 'on_close' ? t.signalBar : t.signalBar + 1);
        expect(t.exitBar!).toBeGreaterThanOrEqual(t.entryBar);
        expect(t.partials.reduce((a, p) => a + p.frac, 0)).toBeCloseTo(1, 6);
        expect(Number.isFinite(t.r!)).toBe(true);
        // A plain stop-out (no breakeven/trailing move) loses about 1R.
        if (t.reason === 'SL' && t.stop === t.initialStop && t.partials.length === 1) expect(t.r!).toBeLessThan(-0.8);
        if (t.dir === 1) expect(t.initialStop).toBeLessThan(t.entry + t.risk * 0.5 + 1e-9);
      }
    });
  }
  it('indicator mode enters on the signal close', () => {
    const spec = specFromTemplate('ema_trend', { output: 'indicator' });
    const r = runSimulation(spec, bars, { chartTf: '240' });
    for (const t of r.trades) expect(t.entryBar).toBe(t.signalBar);
  });
  it('marks STRONG consensus entries', () => {
    const spec = consensusFromPreset('reversal_consensus');
    spec.consensus.strongThreshold = 50;
    spec.consensus.threshold = 25;
    const r = runSimulation(spec, bars, { chartTf: '60' });
    expect(r.markers.some((m) => m.kind === 'strong' || m.kind === 'agreement')).toBe(true);
  });
  it('blocks entries on the wrong timeframe when the guard is set to block', () => {
    const spec = specFromTemplate('ema_trend');
    spec.market.timeframeGuard = 'block';
    const r = runSimulation(spec, bars, { chartTf: '1' });
    expect(r.tfOk).toBe(false);
    expect(r.trades).toHaveLength(0);
  });
});

describe('TradingView chart-data CSV import', () => {
  it('parses unix-second and ISO timestamps', () => {
    const a = parseOhlcCsv('time,open,high,low,close,Volume\n1767225600,1,2,0.5,1.5,10\n1767226500,1.5,2.5,1,2,12\n');
    expect(a).toHaveLength(2);
    expect(a[0].t).toBe(1767225600000);
    const b = parseOhlcCsv('Date,Open,High,Low,Close\n2026-01-01 00:00,1,2,0.5,1.5\n');
    expect(b[0].t).toBe(Date.UTC(2026, 0, 1));
  });
  it('explains missing columns', () => {
    expect(() => parseOhlcCsv('a,b\n1,2\n3,4')).toThrow(/time, open, high, low and close/);
  });
});
