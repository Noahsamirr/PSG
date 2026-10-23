import { describe, expect, it } from 'vitest';
import { CONSENSUS_PRESETS, consensusFromPreset, generatePine, lintPine, runValidation, specFromTemplate, TEMPLATES, validateSpec, COMPONENTS, baseSpec } from '../src/core';

const outputs = ['strategy', 'indicator'] as const;

describe('generator — every template in both output modes', () => {
  for (const t of TEMPLATES) {
    for (const output of outputs) {
      it(`${t.id} (${output}) generates code that passes all static/logic checks`, () => {
        const spec = specFromTemplate(t.id, { output });
        expect(validateSpec(spec).filter((d) => d.severity === 'error')).toEqual([]);
        const { code } = generatePine(spec);
        const report = runValidation(spec, code);
        const errs = report.stages.flatMap((s) => s.diagnostics).filter((d) => d.severity === 'error');
        expect(errs).toEqual([]);
        expect(code.startsWith('//@version=6')).toBe(true);
        expect(report.compiled).toBe(false); // never claims compilation without a TradingView record
      });
    }
  }
});

describe('generator invariants', () => {
  const spec = specFromTemplate('smc_sweep_fvg');
  const { code } = generatePine(spec);
  it('places real strategy orders with a protective stop', () => {
    expect(code).toMatch(/strategy\.entry\(/);
    expect(code).toMatch(/strategy\.exit\(pre \+ "TPF", entryId, limit = tpFinalNow, stop = tSL/);
  });
  it('only enters when flat and never pyramids', () => {
    expect(code).toMatch(/pyramiding = 0/);
    expect(code).toMatch(/flat = posSize == 0 and tDir == 0/);
  });
  it('gates signals on confirmed bars', () => {
    expect(code).toMatch(/s1_sigL = s1_liveL and s1_qualL and barstate\.isconfirmed/);
  });
  it('uses the non-repainting higher-timeframe pattern', () => {
    expect(code).toMatch(/request\.security\(syminfo\.tickerid, i_htf_tf, \[close\[1\], f_ma\(close, i_htf_len, i_htf_maType\)\[1\]\], lookahead = barmerge\.lookahead_on\)/);
  });
  it('contains no removed v5 syntax', () => {
    expect(code).not.toMatch(/\bwhen\s*=|\btransp\s*=|\bstudy\(/);
  });
  it('plots stop/target levels from the same variables the orders use', () => {
    expect(code).toMatch(/plot\(i_showLevels and inTrade \? tSL : na/);
  });
  it('keeps shorttitle within TradingView limits', () => {
    const st = /shorttitle = "([^"]*)"/.exec(code)![1];
    expect(st.length).toBeLessThanOrEqual(10);
  });
  it('indicator mode uses alertcondition and never strategy orders', () => {
    const ind = generatePine(specFromTemplate('ema_trend', { output: 'indicator' })).code;
    expect(ind).toMatch(/^indicator\(/m);
    expect(ind).not.toMatch(/strategy\.(entry|exit|close)\(/);
    expect(ind).toMatch(/alertcondition\(evLongEntry/);
  });
});

describe('consensus engine', () => {
  for (const p of CONSENSUS_PRESETS) {
    it(`${p.id} generates a valid consensus script`, () => {
      const spec = consensusFromPreset(p.id);
      const { code, stats } = generatePine(spec);
      expect(stats.voters).toBe(p.templates.length);
      expect(code).toMatch(/strongLFirst = strongL and not strongL\[1\]/);
      expect(code).toMatch(/plotshape\(strongLFirst and not evLongEntry, "Strong long agreement"/);
      const errs = lintPine(code).diagnostics.filter((d) => d.severity === 'error');
      expect(errs).toEqual([]);
    });
  }
  it('de-duplicates identical components across voters', () => {
    const spec = consensusFromPreset('trend_consensus');
    const trends = spec.components.filter((c) => c.type === 'trend');
    const keys = trends.map((c) => JSON.stringify(c.params));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('coverage spec (all components, all conditions)', () => {
  it('generates lint-clean code using every component', () => {
    const spec = baseSpec();
    spec.components = COMPONENTS.map((c) => ({ id: c.type, type: c.type, params: {} }));
    spec.strategies = [{ id: 's1', name: 'All', family: 'trend', conditions: COMPONENTS.flatMap((c) => c.conditions.map((k) => ({ ref: `${c.type}.${k.id}`, role: k.role, mandatory: false, weight: 1, enabled: true }))), confluence: { mode: 'weighted', minScore: 0, confirmWindowBars: 2, dedupeFamilies: true } }];
    const { code } = generatePine(spec);
    expect(lintPine(code).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
