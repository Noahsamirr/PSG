// Generates every template (strategy + indicator) and every consensus preset into ./generated
import { mkdirSync, writeFileSync } from 'node:fs';
import { TEMPLATES } from '../src/core/templates';
import { CONSENSUS_PRESETS, consensusFromPreset, specFromTemplate } from '../src/core/spec';
import { generatePine } from '../src/core/generator';

mkdirSync('generated', { recursive: true });
for (const t of TEMPLATES) {
  for (const output of ['strategy', 'indicator'] as const) {
    const res = generatePine(specFromTemplate(t.id, { output }));
    writeFileSync(`generated/${t.id}.${output}.pine`, res.code);
    console.log(`${t.id}.${output}: ${res.stats.lines} lines, ${res.stats.plots} plots, ${res.stats.inputs} inputs`);
  }
}
for (const p of CONSENSUS_PRESETS) {
  for (const output of ['strategy', 'indicator'] as const) {
    const spec = consensusFromPreset(p.id);
    spec.output = output;
    const res = generatePine(spec);
    writeFileSync(`generated/${p.id}.${output}.pine`, res.code);
    console.log(`${p.id}.${output}: ${res.stats.lines} lines, ${res.stats.plots} plots, ${res.stats.inputs} inputs`);
  }
}
