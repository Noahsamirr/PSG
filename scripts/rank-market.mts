// Ranks every strategy on one market with the dashboard's execution model, printing in-sample and out-of-sample results.
// Usage: npx tsx scripts/rank-market.mts <binance|binancef|yahoo|twelvedata> <TICKER> <TF>   e.g. binance PAXGUSDT 1D
import { getCandles } from '../src/server/candles';
import { checkBars, evaluateStrategy, evidenceOf, rankStrategies, specForTemplate } from '../src/core/signals';
import { TEMPLATES } from '../src/core/templates';

const [source, ticker, tf] = process.argv.slice(-3);
const c = await getCandles({ symbol: ticker, ticker, source: source as never, tf, limit: 3000 });
const { bars, check } = checkBars(c.bars, c.tf);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
console.log(`${source} ${ticker} ${tf}: ${bars.length} closed bars ${day(bars[0].t)} -> ${day(bars[bars.length - 1].t)} status=${check.status} ${check.issues.join(' ')}`);
const rows = TEMPLATES.map((t) => {
  const s = evaluateStrategy(specForTemplate(t.id, c.tf, ticker), bars, c.tf, { qtyStep: c.qtyStep, templateId: t.id, withSeries: false });
  return { strategyId: t.id, strategyName: t.name, family: t.family, category: t.category, strategyVersion: s.strategyVersion, all: s.all, outOfSample: s.outOfSample, inSample: s.inSample, evidence: evidenceOf(s.all, s.outOfSample, 30, 10), tfOk: s.tfOk };
});
const f = (x: number | null, d = 2) => (x === null ? '—' : x.toFixed(d));
for (const r of rankStrategies(rows) as typeof rows) {
  console.log([r.strategyId.padEnd(18), r.evidence.padEnd(5), r.tfOk ? 'tf-ok ' : 'tf-out', `all ${String(r.all.trades).padStart(3)} exp ${f(r.all.expectancyR).padStart(6)} win ${f(r.all.winRate, 0).padStart(3)}% BE ${f(r.all.breakEvenWinRate, 0).padStart(3)}% PF ${f(r.all.profitFactor).padStart(5)} DD ${f(r.all.maxDrawdownR, 1).padStart(5)}R`, `| IS ${String(r.inSample.trades).padStart(3)} exp ${f(r.inSample.expectancyR).padStart(6)}`, `| OOS ${String(r.outOfSample.trades).padStart(3)} exp ${f(r.outOfSample.expectancyR).padStart(6)} PF ${f(r.outOfSample.profitFactor).padStart(5)}`, `amb ${r.all.ambiguous}`].join(' '));
}
