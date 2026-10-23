// Express application: REST API over the core generator, validator, storage, LLM and research engine.
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  buildSpecFromIntent,
  COMPONENTS,
  CONSENSUS_PRESETS,
  consensusFromPreset,
  consensusSpec,
  computeMetrics,
  costStress,
  ensureHigherTimeframes,
  equityCurve,
  explainSpec,
  FAMILIES,
  generatePine,
  INTENT_SCHEMA_DOC,
  lintPine,
  monteCarlo,
  parseTradesCsv,
  RESOURCES,
  riskPreview,
  robustnessFlags,
  runValidation,
  specFromPrompt,
  specFromTemplate,
  splitInOut,
  stability,
  TEMPLATES,
  validateSpec,
  walkForward,
  type Intent,
  type StrategySpec,
  type Trade,
} from '../core';
import type { Store } from './db';
import { extractJson, type LlmProvider } from './llm';
import { getCandles, POPULAR_SYMBOLS, resolveSource } from './candles';
import { DEFAULT_WATCHLIST, runResearch, topicCounts, type ResearchReport, type WatchItem } from './research';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res))
    .then((out) => {
      if (!res.headersSent) res.json(out);
    })
    .catch(next);
};

function requireSpec(body: any): StrategySpec {
  const spec = body?.spec as StrategySpec | undefined;
  if (!spec || spec.schemaVersion !== 1 || !Array.isArray(spec.components) || !Array.isArray(spec.strategies)) throw new HttpError(400, 'A valid "spec" (schemaVersion 1) is required.');
  return spec;
}

export function buildArtifacts(spec: StrategySpec, compile?: { at: string; ok: boolean; messages: string[] } | null) {
  const gen = generatePine(spec);
  const validation = runValidation(spec, gen.code, { compile: compile ?? null });
  return { code: gen.code, log: gen.log, stats: gen.stats, validation, explanation: explainSpec(spec) };
}

function catalog() {
  return {
    families: FAMILIES,
    components: COMPONENTS.map((c) => ({ type: c.type, name: c.name, family: c.family, summary: c.summary, doc: c.doc, params: c.params, conditions: c.conditions.map(({ long, short, ...rest }) => ({ ...rest, long, short })), hasStructureStop: !!c.structureStop })),
    templates: TEMPLATES,
    presets: CONSENSUS_PRESETS,
  };
}

function interpretSystemPrompt(): string {
  const tpl = TEMPLATES.map((t) => `- ${t.id}: ${t.name} — ${t.summary}`).join('\n');
  const comps = COMPONENTS.map((c) => `- ${c.type} (${c.name}): ${c.conditions.map((k) => `${k.id} [${k.role}] ${k.label}`).join('; ')}`).join('\n');
  return `You translate a trader's request into a structured Intent JSON for a Pine Script generator. You never write Pine code.
Only use template ids and component/condition ids from the catalog. If something requested is not supported, add a short note in "notes" instead of inventing ids.
Return ONLY one JSON object matching this shape:
${INTENT_SCHEMA_DOC}

TEMPLATES
${tpl}

COMPONENTS (type: condition ids)
${comps}`;
}

function sanitizeIntent(raw: any): Intent {
  const i: Intent = { templates: [], add: [], risk: {}, matched: [], notes: [] };
  if (typeof raw !== 'object' || !raw) return i;
  const str = (v: unknown) => (typeof v === 'string' && v.length < 200 ? v : undefined);
  i.symbol = str(raw.symbol);
  i.timeframe = str(raw.timeframe);
  i.assetClass = ['forex', 'crypto', 'stocks', 'futures', 'indices', 'commodities', 'any'].includes(raw.assetClass) ? raw.assetClass : undefined;
  i.output = raw.output === 'indicator' ? 'indicator' : raw.output === 'strategy' ? 'strategy' : undefined;
  i.templates = Array.isArray(raw.templates) ? raw.templates.filter((t: unknown) => typeof t === 'string').slice(0, 14) : [];
  i.consensus = !!raw.consensus;
  i.consensusPreset = str(raw.consensusPreset);
  i.add = Array.isArray(raw.add)
    ? raw.add
        .filter((a: any) => a && typeof a.type === 'string' && Array.isArray(a.conditions))
        .slice(0, 20)
        .map((a: any) => ({ type: a.type, params: typeof a.params === 'object' && a.params ? a.params : undefined, conditions: a.conditions.filter((c: any) => c && typeof c.id === 'string').map((c: any) => ({ id: c.id, role: c.role, mandatory: typeof c.mandatory === 'boolean' ? c.mandatory : undefined })) }))
    : [];
  const r = raw.risk ?? {};
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : undefined);
  i.risk = {
    stopMode: ['ATR', 'Structure', 'Percent', 'Ticks'].includes(r.stopMode) ? r.stopMode : undefined,
    atrMult: num(r.atrMult, 0.1, 20),
    minRR: num(r.minRR, 0.1, 20),
    tpCount: [1, 2, 3].includes(r.tpCount) ? r.tpCount : undefined,
    riskPct: num(r.riskPct, 0.01, 10),
    breakeven: typeof r.breakeven === 'boolean' ? r.breakeven : undefined,
    trailing: typeof r.trailing === 'boolean' ? r.trailing : undefined,
  };
  i.direction = ['both', 'long', 'short'].includes(raw.direction) ? raw.direction : undefined;
  if (raw.session && typeof raw.session.session === 'string' && /^\d{4}-\d{4}$/.test(raw.session.session)) i.session = { session: raw.session.session, timezone: str(raw.session.timezone) ?? 'America/New_York' };
  i.matched = Array.isArray(raw.matched) ? raw.matched.filter((x: unknown) => typeof x === 'string').slice(0, 30) : [];
  i.notes = Array.isArray(raw.notes) ? raw.notes.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [];
  return i;
}

/** Known TradingView compiler messages with a deterministic explanation. */
const KNOWN_ERRORS: { re: RegExp; title: string; fix: string }[] = [
  {
    re: /CE10243|one declaration statement/i,
    title: 'Two declaration statements (CE10243)',
    fix: 'The Pine Editor still contained its new-script template (e.g. indicator("My script") + plot(close)) when the script was pasted. Click in the editor, press Cmd/Ctrl+A, delete everything so the editor is empty, then paste the script again. Generated scripts contain exactly one declaration.',
  },
  {
    re: /version.*(5|4)|\/\/@version/i,
    title: 'Pine version mismatch',
    fix: 'The first line must be //@version=6. Make sure the whole script was pasted, starting from the //@version=6 line.',
  },
  {
    re: /Undeclared identifier|Could not find function/i,
    title: 'Unknown name',
    fix: 'Usually caused by a partial paste (a section is missing) or a hand edit. Paste the complete script again; if it persists, record the error so the generator can be fixed.',
  },
  {
    re: /too many (plots|outputs)|plot count/i,
    title: 'Plot limit exceeded',
    fix: 'Pine allows 64 plot counts. Remove indicator modules or voters you do not need, or turn off component visuals, and regenerate.',
  },
  {
    re: /loop.*too long|took too long|execution time/i,
    title: 'Execution time limit',
    fix: 'Reduce the number of voters/components or long lookbacks, or use a higher timeframe.',
  },
];

function parseCompileMessages(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function analyzeBacktest(trades: Trade[], initialCapital: number | null, q: Record<string, unknown>) {
  const ratio = Math.min(0.9, Math.max(0.5, Number(q.ratio ?? 0.7)));
  const folds = Math.min(10, Math.max(2, Number(q.folds ?? 5)));
  const costPct = Math.max(0, Number(q.costPct ?? 0.05));
  const costCash = Math.max(0, Number(q.costCash ?? 0));
  const { inSample, outSample } = splitInOut(trades, { ratio });
  return {
    metrics: computeMetrics(trades, initialCapital ?? undefined),
    equity: equityCurve(trades, initialCapital ?? 0),
    inSample: computeMetrics(inSample),
    outSample: computeMetrics(outSample),
    ratio,
    walkForward: walkForward(trades, folds),
    costStress: costStress(trades, { pctOfNotional: costPct, cashPerTrade: costCash }, [0, 1, 2, 3]),
    monteCarlo: monteCarlo(trades, 1000),
    flags: robustnessFlags(trades, { ratio }),
    long: computeMetrics(trades.filter((t) => t.direction === 'long')),
    short: computeMetrics(trades.filter((t) => t.direction === 'short')),
  };
}

export function createApp(store: Store, llm: LlmProvider) {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
  app.get('/api/catalog', (_req, res) => {
    res.json(catalog());
  });
  app.get('/api/resources', (_req, res) => {
    res.json(RESOURCES);
  });

  app.get(
    '/api/settings',
    wrap(() => ({ llm: llm.status(), autoRefreshMinutes: store.getSetting('research.autoRefreshMinutes', 0), watchlist: store.getSetting<WatchItem[]>('research.watchlist', DEFAULT_WATCHLIST), defaultWatchlist: DEFAULT_WATCHLIST, twelveDataConfigured: !!process.env.TWELVEDATA_API_KEY })),
  );
  app.put(
    '/api/settings',
    wrap((req) => {
      const b = req.body ?? {};
      if (b.autoRefreshMinutes !== undefined) {
        const m = Number(b.autoRefreshMinutes);
        if (!Number.isFinite(m) || m < 0 || m > 1440) throw new HttpError(400, 'autoRefreshMinutes must be 0–1440');
        store.setSetting('research.autoRefreshMinutes', m === 0 ? 0 : Math.max(15, m));
      }
      if (Array.isArray(b.watchlist)) store.setSetting('research.watchlist', b.watchlist.slice(0, 30));
      return { ok: true, autoRefreshMinutes: store.getSetting('research.autoRefreshMinutes', 0), watchlist: store.getSetting('research.watchlist', DEFAULT_WATCHLIST) };
    }),
  );

  // ─── Specifications ───
  app.post(
    '/api/spec/interpret',
    wrap(async (req) => {
      const prompt = String(req.body?.prompt ?? '').trim();
      if (!prompt) throw new HttpError(400, 'prompt is required');
      if (prompt.length > 8000) throw new HttpError(400, 'prompt is too long (max 8000 characters)');
      const useAI = !!req.body?.useAI;
      if (useAI && llm.status().configured) {
        try {
          const reply = await llm.complete(interpretSystemPrompt(), prompt, 4000);
          const intent = sanitizeIntent(extractJson(reply));
          const built = buildSpecFromIntent(intent, prompt);
          built.log.unshift(`AI interpretation (${llm.status().model}). Recognised: ${intent.matched.join(', ') || '—'}.`);
          return { ...built, intent, source: 'llm' };
        } catch (e) {
          const res = specFromPrompt(prompt);
          return { ...res, source: 'rules', aiError: `AI interpretation failed (${(e as Error).message}); used the rule-based interpreter.` };
        }
      }
      return { ...specFromPrompt(prompt), source: 'rules', aiError: useAI ? 'No LLM configured — used the rule-based interpreter.' : undefined };
    }),
  );
  app.post(
    '/api/spec/template',
    wrap((req) => {
      const { templateId, output, market } = req.body ?? {};
      const spec = specFromTemplate(String(templateId), { output, market });
      ensureHigherTimeframes(spec);
      return { spec };
    }),
  );
  app.post(
    '/api/spec/consensus',
    wrap((req) => {
      const { presetId, templateIds, consensus, name } = req.body ?? {};
      const spec = presetId ? consensusFromPreset(String(presetId)) : consensusSpec(templateIds ?? [], consensus, name);
      return { spec };
    }),
  );
  app.post('/api/spec/validate', wrap((req) => ({ diagnostics: validateSpec(requireSpec(req.body)) })));
  app.post(
    '/api/generate',
    wrap((req) => buildArtifacts(requireSpec(req.body))),
  );
  app.post(
    '/api/risk-preview',
    wrap((req) => {
      const spec = requireSpec(req.body);
      const { price = 100, atr = 1, pointValue = 1, equity = spec.backtest.initialCapital, tick = 0.01 } = req.body ?? {};
      return riskPreview(spec, { price: Number(price), atr: Number(atr), pointValue: Number(pointValue), equity: Number(equity) }, Number(tick));
    }),
  );
  app.post(
    '/api/lint',
    wrap((req) => lintPine(String(req.body?.code ?? ''))),
  );

  // ─── Scripts & versions ───
  app.get('/api/scripts', wrap(() => store.listScripts()));
  app.post(
    '/api/scripts',
    wrap((req) => {
      const spec = requireSpec(req.body);
      const art = buildArtifacts(spec);
      const script = store.createScript(String(req.body?.name ?? spec.meta.name).slice(0, 120), spec.output);
      const version = store.addVersion(script.id, { code: art.code, spec, validation: art.validation, log: art.log, note: String(req.body?.note ?? 'Initial version'), output: spec.output });
      return { script: store.getScript(script.id), version, explanation: art.explanation, stats: art.stats };
    }),
  );
  app.get(
    '/api/scripts/:id',
    wrap((req) => {
      const script = store.getScript(String(req.params.id));
      if (!script) throw new HttpError(404, 'Script not found');
      return { script, versions: store.listVersions(script.id) };
    }),
  );
  app.patch(
    '/api/scripts/:id',
    wrap((req) => {
      const s = store.updateScript(String(req.params.id), { name: req.body?.name, favorite: req.body?.favorite });
      if (!s) throw new HttpError(404, 'Script not found');
      return s;
    }),
  );
  app.delete(
    '/api/scripts/:id',
    wrap((req) => ({ deleted: store.deleteScript(String(req.params.id)) })),
  );
  app.post(
    '/api/scripts/:id/versions',
    wrap((req) => {
      const id = String(req.params.id);
      if (!store.getScript(id)) throw new HttpError(404, 'Script not found');
      const spec = requireSpec(req.body);
      if (typeof req.body?.code === 'string') {
        // Manual edit: keep the hand-edited code, validate it against the base specification.
        const code = req.body.code as string;
        if (code.length > 2_000_000) throw new HttpError(400, 'Script too large');
        const validation = runValidation(spec, code);
        const version = store.addVersion(id, { code, spec, validation, log: ['Manual code edit — not regenerated from the specification.'], note: String(req.body?.note ?? 'Manual edit'), output: spec.output });
        return { version, explanation: explainSpec(spec) };
      }
      const art = buildArtifacts(spec);
      const version = store.addVersion(id, { code: art.code, spec, validation: art.validation, log: art.log, note: String(req.body?.note ?? ''), output: spec.output });
      return { version, explanation: art.explanation, stats: art.stats };
    }),
  );
  app.get(
    '/api/scripts/:id/versions/:v/explain',
    wrap((req) => {
      const v = store.getVersion(String(req.params.id), Number(req.params.v));
      if (!v) throw new HttpError(404, 'Version not found');
      return explainSpec(v.spec as StrategySpec);
    }),
  );
  app.get('/api/scripts/:id/versions/:v/download', (req, res) => {
    const s = store.getScript(String(req.params.id));
    const v = store.getVersion(String(req.params.id), Number(req.params.v));
    if (!s || !v) return res.status(404).json({ error: 'Version not found' });
    const file = `${s.name.replace(/[^\w.-]+/g, '_').slice(0, 60)}_v${v.version}.pine`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.send(v.code);
  });
  app.post(
    '/api/scripts/:id/versions/:v/compile',
    wrap((req) => {
      const id = String(req.params.id);
      const n = Number(req.params.v);
      const v = store.getVersion(id, n);
      if (!v) throw new HttpError(404, 'Version not found');
      const ok = !!req.body?.ok;
      const messages = ok ? ['Compiled and added to chart in TradingView (recorded by user).', ...parseCompileMessages(String(req.body?.messages ?? ''))] : parseCompileMessages(String(req.body?.messages ?? ''));
      if (!ok && !messages.length) throw new HttpError(400, 'Paste the TradingView error messages when recording a failed compile.');
      const compile = { at: new Date().toISOString(), ok, messages };
      const validation = runValidation(v.spec as StrategySpec, v.code, { compile });
      return store.setCompile(id, n, compile, validation);
    }),
  );
  app.post(
    '/api/fix',
    wrap(async (req) => {
      const code = String(req.body?.code ?? '');
      const errors = String(req.body?.errors ?? '');
      const lines = code.split('\n');
      const refs = [...errors.matchAll(/line\s*(\d+)|^\s*(\d+)\s*:|:(\d+):/gim)].map((m) => Number(m[1] ?? m[2] ?? m[3])).filter((n) => n > 0 && n <= lines.length);
      const context = [...new Set(refs)].slice(0, 10).map((n) => ({ line: n, text: lines[n - 1], before: lines.slice(Math.max(0, n - 3), n - 1), after: lines.slice(n, n + 2) }));
      let suggestion: string | null = null;
      let aiError: string | undefined;
      if (llm.status().configured && errors.trim()) {
        try {
          suggestion = await llm.complete(
            'You are a Pine Script v6 expert. Explain each TradingView compiler error and propose the minimal corrected lines. Do not change trading logic. Answer in Markdown; show corrected code lines in ```pine blocks with their line numbers.',
            `ERRORS\n${errors}\n\nRELEVANT LINES\n${context.map((c) => `${c.line}: ${c.text}`).join('\n')}\n\nFULL SCRIPT\n${code.slice(0, 120000)}`,
            8000,
          );
        } catch (e) {
          aiError = (e as Error).message;
        }
      }
      const hints = KNOWN_ERRORS.filter((k) => k.re.test(errors)).map(({ title, fix }) => ({ title, fix }));
      return { hints, context, suggestion, aiError, lint: lintPine(code), note: 'Generated scripts should be fixed by regenerating from the specification; AI suggestions are advisory and must be re-validated.' };
    }),
  );

  // ─── Backtests ───
  app.post(
    '/api/backtests/parse',
    wrap((req) => {
      const parsed = parseTradesCsv(String(req.body?.csv ?? ''));
      return { ...parsed, metrics: computeMetrics(parsed.trades, req.body?.initialCapital ? Number(req.body.initialCapital) : undefined) };
    }),
  );
  app.post(
    '/api/backtests',
    wrap((req) => {
      const b = req.body ?? {};
      const kind = ['backtest', 'out_of_sample', 'paper', 'live'].includes(b.kind) ? b.kind : 'backtest';
      const parsed = b.csv ? parseTradesCsv(String(b.csv)) : { trades: Array.isArray(b.trades) ? b.trades : [], warnings: [] };
      if (!parsed.trades.length) throw new HttpError(400, `No trades found. ${parsed.warnings.join(' ')}`);
      const row = store.addBacktest({ scriptId: b.scriptId ?? null, label: String(b.label ?? 'Imported run').slice(0, 120), kind, source: b.csv ? 'csv' : 'manual', trades: parsed.trades, initialCapital: b.initialCapital ? Number(b.initialCapital) : null });
      return { backtest: row, warnings: parsed.warnings };
    }),
  );
  app.get(
    '/api/backtests',
    wrap((req) =>
      store.listBacktests(req.query.scriptId ? String(req.query.scriptId) : undefined).map((b) => ({ ...b, trades: undefined, tradeCount: b.trades.length, metrics: computeMetrics(b.trades as Trade[], b.initialCapital ?? undefined) })),
    ),
  );
  app.get(
    '/api/backtests/compare',
    wrap((req) => {
      const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
      const runs = ids.map((id) => store.getBacktest(id)).filter((b): b is NonNullable<typeof b> => !!b);
      const summaries = runs.map((b) => ({ label: b.label, kind: b.kind as any, metrics: computeMetrics(b.trades as Trade[], b.initialCapital ?? undefined) }));
      return { runs: summaries, stability: stability(summaries) };
    }),
  );
  app.get(
    '/api/backtests/:id/analysis',
    wrap((req) => {
      const b = store.getBacktest(String(req.params.id));
      if (!b) throw new HttpError(404, 'Backtest not found');
      return { backtest: { ...b, trades: undefined }, trades: b.trades, analysis: analyzeBacktest(b.trades as Trade[], b.initialCapital, req.query as Record<string, unknown>) };
    }),
  );
  app.delete(
    '/api/backtests/:id',
    wrap((req) => ({ deleted: store.deleteBacktest(String(req.params.id)) })),
  );

  // ─── Candles for the in-app chart preview ───
  app.get(
    '/api/candles',
    wrap(async (req) => {
      const q = req.query as Record<string, string | undefined>;
      try {
        return await getCandles({ symbol: q.symbol ?? '', assetClass: q.assetClass, tf: q.tf ?? '60', limit: Number(q.limit ?? 1000), source: (q.source as never) ?? 'auto', ticker: q.ticker });
      } catch (e) {
        throw new HttpError(502, (e as Error).message);
      }
    }),
  );
  app.get('/api/candles/sources', wrap((req) => resolveSource(String(req.query.symbol ?? ''), req.query.assetClass ? String(req.query.assetClass) : undefined)));
  app.get('/api/candles/popular', (_req, res) => {
    res.json(POPULAR_SYMBOLS);
  });

  // ─── Market research ───
  let running: Promise<ResearchReport> | null = null;
  const research = async (mode: 'quick' | 'deep') => {
    if (running) return running;
    const prev = store.listReports(1)[0]?.report as ResearchReport | undefined;
    running = runResearch({ mode, watchlist: store.getSetting<WatchItem[]>('research.watchlist', DEFAULT_WATCHLIST), previousTopics: prev ? topicCounts(prev) : undefined, llm }).finally(() => (running = null));
    const report = await running;
    store.addReport(report);
    return report;
  };
  app.post('/api/research/run', wrap((req) => research(req.body?.mode === 'deep' ? 'deep' : 'quick')));
  app.get('/api/research/latest', wrap(() => store.listReports(1)[0] ?? null));
  app.get('/api/research/history', wrap(() => store.listReports(20).map((r) => ({ id: r.id, createdAt: r.createdAt, mode: r.report.mode, news: r.report.news?.length ?? 0, topics: (r.report.topics ?? []).slice(0, 5) }))));
  app.get(
    '/api/research/:id',
    wrap((req) => {
      const r = store.listReports(30).find((x) => x.id === req.params.id);
      if (!r) throw new HttpError(404, 'Report not found');
      return r;
    }),
  );

  // Errors
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message0 = err instanceof Error ? err.message : '';
    const status = err instanceof HttpError ? err.status : /^(Unknown|A consensus|Condition|Component|No strategy|Specification)/.test(message0) ? 400 : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });
  return { app, research };
}
