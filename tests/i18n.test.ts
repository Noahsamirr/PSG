import { describe, expect, it } from 'vitest';
import { AR, WHY_AR } from '../src/web/i18n/ar';
import { DISCOVERY_AR } from '../src/web/i18n/discovery-ar';
import { translateServer } from '../src/web/i18n';
import { TEMPLATES, COMPONENTS, FAMILIES, generatePine, runValidation } from '../src/core';
import { DISCOVERY } from '../src/core/discovery';
import { CURATED } from '../src/server/catalog';
import { confluence, evaluateStrategy, specForTemplate } from '../src/core/signals';
import type { Bar } from '../src/core/sim/series';

const arabic = /[؀-ۿ]/;

function market(n = 1500, seed = 7): Bar[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
  const bars: Bar[] = [];
  let p = 2000;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(1, o + Math.sin(i / 90) * 1.2 + Math.sin(i / 23) * 0.6 + rnd() * 6);
    bars.push({ t: Date.UTC(2026, 0, 5) + i * 15 * 60000, o, h: Math.max(o, c) + Math.abs(rnd()) * 4, l: Math.min(o, c) - Math.abs(rnd()) * 4, c, v: 1000 });
    p = c;
  }
  return bars;
}

describe('Arabic translations', () => {
  it('cover every strategy name, category, summary, family and rule label', () => {
    for (const t of TEMPLATES) {
      for (const s of [t.name, t.category, t.summary]) expect(AR[s], s).toMatch(arabic);
      expect(WHY_AR[t.id]?.(true)).toMatch(arabic);
      expect(WHY_AR[t.id]?.(false)).toMatch(arabic);
      for (const c of t.conditions) {
        const [id, cid] = c.ref.split('.');
        const inst = t.components.find((x) => x.id === id)!;
        const label = COMPONENTS.find((x) => x.type === inst.type)!.conditions.find((x) => x.id === cid)!.label;
        expect(AR[label], label).toMatch(arabic);
      }
    }
    for (const f of FAMILIES) expect(AR[f], f).toMatch(arabic);
  });
  it('cover the gold instruments and every discovery profile', () => {
    for (const i of CURATED.filter((x) => x.assetClass === 'metals' && /XAU|PAXG|GC|GLD/.test(x.ticker))) expect(AR[i.kind], i.kind).toMatch(arabic);
    for (const p of DISCOVERY) {
      expect(DISCOVERY_AR[p.id]?.entry, p.id).toMatch(arabic);
      expect(DISCOVERY_AR[p.id].differences).toHaveLength(p.differences.length);
    }
  });
  it('translate the sentences the server produces', () => {
    const bars = market();
    let checked = 0;
    for (const t of TEMPLATES) {
      const s = evaluateStrategy(specForTemplate(t.id, '15', 'XAUUSDT'), bars, '15', { templateId: t.id });
      for (const text of [s.reason, s.costNote, ...s.invalidation]) {
        const ar = translateServer(text, 'ar');
        expect(ar, text).toMatch(arabic);
        // No untranslated English sentence fragments left (ticker/indicator names are fine).
        expect(ar, text).not.toMatch(/\b(the|and|of|from|stop|signal|position|Waiting)\b/);
        checked++;
      }
      for (const m of s.markers.slice(0, 3)) expect(translateServer(m.detail, 'ar'), m.detail).toMatch(arabic);
      for (const x of s.exits.slice(0, 3)) expect(translateServer(x.detail, 'ar'), x.detail).toMatch(arabic);
    }
    expect(checked).toBeGreaterThan(30);
    const c = confluence([{ family: 'trend', state: 'BUY' }, { family: 'momentum', state: 'BUY' }]);
    expect(translateServer(c.label, 'ar')).toMatch(arabic);
    expect(translateServer(c.explanation, 'ar')).not.toMatch(/\bstrategies\b/);
  });
  it('translate every validation stage title and badge shown on the scripts page', () => {
    const spec = specForTemplate('ema_trend', '60', 'XAUUSDT');
    const report = runValidation(spec, generatePine(spec).code, { compile: null });
    for (const st of report.stages) expect(AR[st.title], st.title).toMatch(arabic);
    for (const label of ['Checks passed', 'Compiled in TV', 'TradingView errors', 'strategy', 'indicator', 'pass', 'warn', 'fail', 'not run']) expect(AR[label], label).toMatch(arabic);
    expect(translateServer('2 errors', 'ar')).toMatch(arabic);
    expect(translateServer('1 warning', 'ar')).toMatch(arabic);
  });
  it('leaves English untouched', () => {
    expect(translateServer('Waiting for the next entry signal.', 'en')).toBe('Waiting for the next entry signal.');
  });
});
