// Dev helper: express file B as ranges of file A's lines plus literal lines (to transfer only new text).
import { readFileSync } from 'node:fs';
const A = readFileSync(process.argv[2], 'utf8').split('\n');
const B = readFileSync(process.argv[3], 'utf8').split('\n');
const idx = new Map();
A.forEach((l, i) => { if (!idx.has(l)) idx.set(l, []); idx.get(l).push(i); });
const out = [];
let i = 0;
while (i < B.length) {
  let best = null;
  for (const s of idx.get(B[i]) ?? []) {
    let n = 0;
    while (i + n < B.length && s + n < A.length && A[s + n] === B[i + n]) n++;
    if (!best || n > best.n) best = { s, n };
  }
  if (best && best.n >= 2) { out.push(`R ${best.s} ${best.n}`); i += best.n; }
  else { out.push('L ' + B[i]); i++; }
}
console.log(out.join('\n'));
