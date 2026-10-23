import { readdirSync, readFileSync } from 'node:fs';
import { lintPine } from '../src/core/validation/pineLint';
const dir = process.argv[2] ?? 'generated';
let total = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.pine'))) {
  const r = lintPine(readFileSync(`${dir}/${f}`, 'utf8'));
  const errs = r.diagnostics.filter((x) => x.severity !== 'info');
  total += errs.length;
  if (errs.length) {
    console.log(`\n${f}: ${errs.length}`);
    for (const e of errs.slice(0, 15)) console.log(`  L${e.line ?? '-'} [${e.severity}] ${e.check}: ${e.message}`);
  }
}
console.log('\nTOTAL issues', total);
