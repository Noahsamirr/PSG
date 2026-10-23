// Regenerates docs/STRATEGY_CATALOG.md from the template and component definitions.
import { writeFileSync } from 'node:fs';
import { COMPONENTS, TEMPLATES } from '../src/core';
import { rangeLabel, tfLabel } from '../src/core/timeframe';

const out: string[] = ['# Strategy & Indicator Catalog', '', '_Generated from `src/core/templates` and `src/core/components` by `npm run docs:catalog` — do not edit by hand._', ''];
out.push('## Strategy templates', '');
out.push('| Template | Category | Family | Set chart to | Designed range | Markets | Evidence (short) |', '|---|---|---|---|---|---|---|');
for (const t of TEMPLATES) out.push(`| ${t.name} | ${t.category} | ${t.family} | **${tfLabel(t.chartTimeframe!)}** | ${rangeLabel(t.tfRange!)} | ${t.markets} | ${t.evidence.split('. ')[0]}. |`);
for (const t of TEMPLATES) {
  out.push('', `### ${t.name} (\`${t.id}\`)`, '', t.summary, '');
  out.push(`- **Entry:** ${t.entryLogic}`, `- **Exit:** ${t.exitLogic}`, `- **Regime:** ${t.regime}`, `- **Timeframe:** set the chart to **${tfLabel(t.chartTimeframe!)}** (designed for ${rangeLabel(t.tfRange!)}; ${t.timeframes})`, `- **Markets:** ${t.markets}`);
  out.push(`- **Indicators:** ${t.components.map((c) => COMPONENTS.find((x) => x.type === c.type)!.name).join(', ')}`);
  out.push(`- **Rules:** ${t.conditions.map((c) => `${c.ref} (${c.role}${c.mandatory && c.role !== 'trigger' && c.role !== 'exit' ? ', mandatory' : ''})`).join('; ')} — ${t.confluence?.mode ?? 'strict'} confluence`);
  out.push(`- **Strengths:** ${t.strengths.join('; ')}`, `- **Weaknesses:** ${t.weaknesses.join('; ')}`, `- **Failure conditions:** ${t.failureModes.join('; ')}`);
  out.push(`- **Evidence quality:** ${t.evidence}`, `- **Testing requirements:** ${t.testing}`, `- **Why included:** ${t.implementationNotes}`);
  out.push(`- **Sources:** ${t.sources.map((s) => (s.url ? `[${s.title}](${s.url})` : s.title) + (s.note ? ` — ${s.note}` : '')).join('; ')}`);
}
out.push('', '## Indicator modules', '');
for (const c of COMPONENTS) {
  out.push(`### ${c.name} (\`${c.type}\`, ${c.family})`, '', c.summary, '');
  out.push(`- **Calculation:** ${c.doc.calculation}`, `- **Parameters:** ${c.params.map((p) => `${p.label} = ${p.default}`).join(', ')}`, `- **Role:** ${c.doc.role}`, `- **Interpretation:** ${c.doc.interpretation}`, `- **Limitations:** ${c.doc.limitations}`, `- **Repainting:** ${c.doc.repainting}`, `- **Source:** ${c.doc.source}`);
  out.push(`- **Conditions:** ${c.conditions.map((k) => `\`${k.id}\` ${k.label} [${k.role}]`).join('; ')}`, '');
}
writeFileSync('docs/STRATEGY_CATALOG.md', out.join('\n'));
console.log('wrote docs/STRATEGY_CATALOG.md');
