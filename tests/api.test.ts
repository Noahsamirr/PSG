import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server/app';
import { Store } from '../src/server/db';
import { createProvider } from '../src/server/llm';

let server: Server;
let base = '';
const j = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
};

beforeAll(async () => {
  const { app } = createApp(new Store(':memory:'), createProvider({ LLM_PROVIDER: 'none' }));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

describe('REST API', () => {
  it('serves the catalog', async () => {
    const r = await j('GET', '/catalog');
    expect(r.body.templates.length).toBeGreaterThanOrEqual(15);
    expect(r.body.components.length).toBeGreaterThanOrEqual(19);
  });
  it('interprets, generates, versions, records compile results and downloads', async () => {
    const i = await j('POST', '/spec/interpret', { prompt: 'EURUSD 1h ema crossover with adx filter, 2 take profits', useAI: true });
    expect(i.status).toBe(200);
    expect(i.body.source).toBe('rules');
    expect(i.body.aiError).toMatch(/No LLM/);
    const c = await j('POST', '/scripts', { spec: i.body.spec });
    expect(c.body.version.validation.errorCount).toBe(0);
    expect(c.body.version.validation.compiled).toBe(false);
    const id = c.body.script.id;
    const spec2 = { ...i.body.spec, risk: { ...i.body.spec.risk, atrMult: 3 } };
    const v2 = await j('POST', `/scripts/${id}/versions`, { spec: spec2, note: 'wider stop' });
    expect(v2.body.version.version).toBe(2);
    const manual = await j('POST', `/scripts/${id}/versions`, { spec: spec2, code: '//@version=6\nindicator("x")\nplot(close)\n', note: 'manual' });
    expect(manual.body.version.version).toBe(3);
    const bad = await j('POST', `/scripts/${id}/versions/1/compile`, { ok: false, messages: '' });
    expect(bad.status).toBe(400);
    const rec = await j('POST', `/scripts/${id}/versions/1/compile`, { ok: true });
    expect(rec.body.compile.ok).toBe(true);
    expect(rec.body.validation.compiled).toMatchObject({ ok: true, source: 'user-recorded' });
    const dl = await fetch(`${base}/scripts/${id}/versions/1/download`);
    expect(dl.headers.get('content-disposition')).toMatch(/\.pine"/);
    expect((await dl.text()).startsWith('//@version=6')).toBe(true);
  });
  it('rejects invalid input with 400', async () => {
    expect((await j('POST', '/generate', { spec: { nope: 1 } })).status).toBe(400);
    expect((await j('POST', '/spec/template', { templateId: 'missing' })).status).toBe(400);
    expect((await j('POST', '/spec/interpret', { prompt: '' })).status).toBe(400);
  });
  it('imports and analyses backtests', async () => {
    const csv = 'date,profit\n' + Array.from({ length: 40 }, (_, k) => `2024-01-${String((k % 28) + 1).padStart(2, '0')},${k % 3 ? 12 : -10}`).join('\n');
    const s = await j('POST', '/backtests', { csv, label: 'run', kind: 'out_of_sample', initialCapital: 1000 });
    expect(s.status).toBe(200);
    const a = await j('GET', `/backtests/${s.body.backtest.id}/analysis?ratio=0.7&folds=4&costPct=0&costCash=1`);
    expect(a.body.analysis.metrics.trades).toBe(40);
    expect(a.body.analysis.walkForward).toHaveLength(4);
    expect(a.body.analysis.costStress[1].metrics.netProfit).toBe(a.body.analysis.metrics.netProfit - 40);
  });
});
