// Builds compact specs that together exercise every code path of the generator:
//  - coverage: one strategy voter using all 19 components (strategy mode)
//  - consensus-mini: two-voter consensus (indicator mode → simulation + consensus engine)
import { mkdirSync, writeFileSync } from 'node:fs';
import { COMPONENTS } from '../src/core/components';
import { baseSpec, consensusSpec } from '../src/core/spec';
import { generatePine } from '../src/core/generator';
import type { StrategySpec } from '../src/core/types';

export function coverageSpec(): StrategySpec {
  const spec = baseSpec();
  spec.meta.name = 'Coverage';
  spec.components = COMPONENTS.map((c) => ({ id: c.type, type: c.type, params: {} }));
  spec.strategies = [{
    id: 's1', name: 'Coverage', family: 'trend',
    conditions: COMPONENTS.flatMap((c) => c.conditions.map((k) => ({ ref: `${c.type}.${k.id}`, role: k.role, mandatory: false, weight: k.defaultWeight, enabled: true }))),
    confluence: { mode: 'weighted', minScore: 0, confirmWindowBars: 3, dedupeFamilies: true },
  }];
  spec.risk.stopMode = 'Structure';
  return spec;
}

if (process.argv[1]?.endsWith('coverage-specs.ts')) {
  mkdirSync('generated/compile', { recursive: true });
  const a = generatePine(coverageSpec());
  writeFileSync('generated/compile/coverage.strategy.pine', a.code);
  const c = consensusSpec(['ichimoku_tk', 'donchian_turtle']);
  c.output = 'indicator';
  const b = generatePine(c);
  writeFileSync('generated/compile/consensus-mini.indicator.pine', b.code);
  console.log('coverage', a.code.length, 'consensus-mini', b.code.length);
}
