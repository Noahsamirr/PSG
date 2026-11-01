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
import { analystCatalog, analystsFromEnv, extractJson, usedModel, type AnalystMember, type LlmProvider } from './llm';
import { timingSafeEqual } from 'node:crypto';
import { getCandles, getQuote, POPULAR_SYMBOLS, providerStats, resolveSource, type CandleResponse, type Quote } from './candles';
import { CURATED, findInstrument, loadCatalog, searchCatalog } from './catalog';
import type { ReviewStatus } from './db';
import { DISCOVERY } from '../core/discovery';
import { buildPlans, type TradePlan } from '../core/plans';
import { scanTriggers, type TriggerScan } from '../core/outlook';
import { AI_DECISION_SCHEMA, ANALYST_SYSTEM, buildLevels, combinePanel, evidenceForPrompt, marketContextFrom, ruleBasedDecision, validateAiDecision, type AiDecision, type AnalystDecision, type AnalystInput, type FrameEvidence, type Level } from '../core/analyst';
import type { CalendarEvent } from '../core/research';
import { tfMinutes } from '../core/timeframe';
import { checkBars, confluence, evaluateOutcome, evaluateStrategy, evidenceOf, levelIssues, rankStrategies, specForTemplate, specHash, type RankRow, type StrategySignal } from '../core/signals';
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

export function createApp(store: Store, llm: LlmProvider, analysts: AnalystMember[] = analystsFromEnv()) {
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

  // ─── Analysis dashboard: market data, signals, rankings, saved opportunities ───
  const limiter = new Map<string, number[]>();
  /** Small in-memory rate limit for the expensive endpoints (per client IP). */
  const rateLimit = (req: Request, key: string, perMinute: number) => {
    const id = `${key}:${req.ip}`;
    const now = Date.now();
    const hits = (limiter.get(id) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= perMinute) throw new HttpError(429, `Too many requests — limit is ${perMinute} per minute. Try again shortly.`);
    hits.push(now);
    limiter.set(id, hits);
  };
  const GOLD_TICKERS = ['XAUUSDT', 'PAXGUSDT', 'XAUTUSDT', 'GC=F', 'GLD', 'XAU/USD'];
  const loadMarket = async (q: Record<string, unknown>) => {
    const tf = String(q.tf ?? '60');
    const source = q.source ? String(q.source) : undefined;
    const ticker = q.ticker ? String(q.ticker).slice(0, 40) : undefined;
    const symbol = String(q.symbol ?? ticker ?? 'XAUUSDT').slice(0, 40);
    let candles: CandleResponse;
    try {
      candles = await getCandles({ symbol, tf, limit: Math.min(Number(q.limit ?? 1500) || 1500, 5000), source: (source as never) ?? 'auto', ticker });
    } catch (e) {
      throw new HttpError(502, `Market data unavailable for ${ticker ?? symbol}: ${(e as Error).message}`);
    }
    const live = q.live === true || q.live === 'true';
    const { bars, check } = checkBars(candles.bars, candles.tf, Date.now(), { live });
    let quote: Quote | null = null;
    let quoteError: string | null = null;
    try {
      quote = await getQuote(candles.source, candles.ticker);
    } catch (e) {
      quoteError = (e as Error).message;
    }
    const cat = await loadCatalog();
    const inst = findInstrument(cat.list, candles.source, candles.ticker);
    // 24h change from closed candles (or the live quote) — never extrapolated.
    const last = bars[bars.length - 1];
    let change: { abs: number; pct: number; since: string } | null = null;
    if (last) {
      const ref = [...bars].reverse().find((b) => b.t <= last.t - 24 * 3600_000) ?? bars[0];
      const px = quote?.last ?? last.c;
      change = { abs: px - ref.c, pct: (100 * (px - ref.c)) / ref.c, since: new Date(ref.t).toISOString() };
    }
    // Gold: show a second, independent gold price so a bad feed is visible instead of silently trusted.
    let crossCheck: { source: string; ticker: string; last: number; diffPct: number; note: string } | null = null;
    if (GOLD_TICKERS.includes(candles.ticker) && quote?.last) {
      const [rs, rt] = candles.ticker === 'XAUUSDT' ? (['binance', 'PAXGUSDT'] as const) : (['binancef', 'XAUUSDT'] as const);
      try {
        const rq = await getQuote(rs, rt);
        if (rq.last) crossCheck = { source: rs, ticker: rt, last: rq.last, diffPct: (100 * (quote.last - rq.last)) / rq.last, note: rt === 'PAXGUSDT' ? 'PAXG is a gold-backed token and can trade at a small premium/discount to gold.' : 'Binance gold perpetual (tracks spot gold).' };
      } catch {
        /* reference unavailable — shown as missing, not guessed */
      }
    }
    const market = {
      symbol,
      source: candles.source,
      ticker: candles.ticker,
      name: inst?.name ?? candles.label.split(' — ')[1] ?? candles.ticker,
      instrument: candles.instrument,
      provider: inst?.provider ?? candles.label.split(' ')[0],
      quoteCurrency: inst?.quoteCurrency ?? (candles.ticker.endsWith('USDT') ? 'USDT' : 'USD'),
      session: inst?.session ?? '',
      realtime: inst?.realtime ?? (candles.source === 'binance' || candles.source === 'binancef'),
      label: candles.label,
      note: candles.note,
      isProxy: candles.isProxy,
      tf: candles.tf,
      fetchedAt: candles.fetchedAt,
      data: check,
      quote,
      quoteError,
      change,
      crossCheck,
    };
    return { market, bars, allBars: candles.bars, qtyStep: candles.qtyStep, live };
  };
  app.get('/api/market/assets', (_req, res) => {
    res.json(CURATED);
  });
  app.get(
    '/api/market/search',
    wrap(async (req) => {
      const cat = await loadCatalog();
      return { results: searchCatalog(cat.list, String(req.query.q ?? '').slice(0, 40)), total: cat.list.length, errors: cat.errors };
    }),
  );
  app.get(
    '/api/market/quote',
    wrap(async (req) => {
      const source = String(req.query.source ?? '');
      if (!['binance', 'binancef', 'yahoo', 'twelvedata'].includes(source)) throw new HttpError(400, 'Unknown data source');
      try {
        return await getQuote(source as never, String(req.query.ticker ?? '').slice(0, 40));
      } catch (e) {
        throw new HttpError(502, `Quote unavailable: ${(e as Error).message}`);
      }
    }),
  );
  app.get(
    '/api/strategies',
    wrap(() => {
      const reviews = store.listReviews();
      return TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, family: t.family, summary: t.summary, timeframes: t.timeframes, tfRange: t.tfRange, review: reviews[t.id] ?? { status: 'experimental', note: '', updatedAt: null } }));
    }),
  );
  app.post(
    '/api/signals',
    wrap(async (req) => {
      rateLimit(req, 'signals', 120);
      const ids: string[] = Array.isArray(req.body?.strategies) ? req.body.strategies.map(String).slice(0, 8) : [];
      if (!ids.length) throw new HttpError(400, 'Pick at least one strategy.');
      for (const id of ids) if (!TEMPLATES.some((t) => t.id === id)) throw new HttpError(400, `Unknown strategy "${id}"`);
      let m: Awaited<ReturnType<typeof loadMarket>>;
      try {
        m = await loadMarket(req.body ?? {});
      } catch (e) {
        store.logEvent('signal_error', { symbol: String(req.body?.ticker ?? req.body?.symbol ?? ''), tf: String(req.body?.tf ?? ''), detail: (e as Error).message });
        throw e;
      }
      const activated: string[] = Array.isArray(req.body?.activated) ? req.body.activated.map(String) : [];
      for (const id of activated.filter((x) => ids.includes(x))) store.logEvent('activate', { symbol: m.market.ticker, tf: m.market.tf, strategyId: id });
      // Invalid data never produces actionable signals.
      const signals: StrategySignal[] = ids.map((id) => {
        const spec = specForTemplate(id, m.market.tf, m.market.ticker);
        return evaluateStrategy(spec, m.market.data.ok ? m.bars : [], m.market.tf, { qtyStep: m.qtyStep, templateId: id });
      });
      return { market: m.market, bars: m.allBars, signals, confluence: confluence(signals) };
    }),
  );
  // Every strategy evaluated on one market/timeframe, cached per candle (shared by trade plans and the analyst).
  const planCache = new Map<string, { plans: TradePlan[]; evaluated: number; signals: StrategySignal[] }>();
  const evaluateAll = (m: Awaited<ReturnType<typeof loadMarket>>) => {
    // In live mode the newest candle changes every few seconds, so the cache key follows its current close.
    const lastBar = m.bars[m.bars.length - 1];
    const key = [m.market.source, m.market.ticker, m.market.tf, m.market.data.lastClosedAt, m.live ? `live:${lastBar?.t}:${lastBar?.c}` : 'closed'].join('|');
    let hit = planCache.get(key);
    if (!hit) {
      const signals = TEMPLATES.map((t) => evaluateStrategy(specForTemplate(t.id, m.market.tf, m.market.ticker), m.bars, m.market.tf, { qtyStep: m.qtyStep, templateId: t.id, withSeries: false }));
      hit = { plans: buildPlans(signals), evaluated: signals.length, signals };
      planCache.set(key, hit);
      if (planCache.size > 50) planCache.delete(planCache.keys().next().value!);
    }
    return hit;
  };
  // Next-entry trigger search for one strategy, cached per candle (recomputed at most every 20 s while it forms).
  const triggerCache = new Map<string, TriggerScan>();
  const triggersFor = (m: Awaited<ReturnType<typeof loadMarket>>, id: string) => {
    const raw = m.allBars;
    const closed = m.live ? m.bars.slice(0, -1) : m.bars;
    const forming = raw.length && raw[raw.length - 1].t > (closed[closed.length - 1]?.t ?? Infinity) ? raw[raw.length - 1] : null;
    const spec = specForTemplate(id, m.market.tf, m.market.ticker);
    // Higher-timeframe strategies need a longer history for their filters to warm up.
    const needsLong = spec.components.some((c) => c.type === 'htf');
    const key = [m.market.source, m.market.ticker, m.market.tf, id, closed[closed.length - 1]?.t, forming ? forming.t : 'none', Math.floor(Date.now() / 20000)].join('|');
    let scan = triggerCache.get(key);
    if (!scan) {
      scan = scanTriggers(spec, closed, forming, m.market.tf, { qtyStep: m.qtyStep, barsUsed: needsLong ? 1000 : 600, steps: needsLong ? 11 : 15 });
      triggerCache.set(key, scan);
      if (triggerCache.size > 300) triggerCache.delete(triggerCache.keys().next().value!);
    }
    return { scan, forming };
  };
  app.post(
    '/api/trade-plans',
    wrap(async (req) => {
      rateLimit(req, 'plans', 120);
      const m = await loadMarket(req.body ?? {});
      if (!m.market.data.ok) throw new HttpError(422, `No trade plans on invalid data: ${m.market.data.issues.join(' ')}`);
      const { plans, evaluated } = evaluateAll(m);
      return { market: m.market, plans, evaluated };
    }),
  );
  // Multi-timeframe outlook: each strategy's current view and next entry triggers on 5m / 15m / 30m / 1H.
  app.post(
    '/api/outlook',
    wrap(async (req) => {
      rateLimit(req, 'outlook', 60);
      const ids: string[] = Array.isArray(req.body?.strategies) ? req.body.strategies.map(String).slice(0, 6) : [];
      if (!ids.length) throw new HttpError(400, 'Pick at least one strategy.');
      for (const id of ids) if (!TEMPLATES.some((t) => t.id === id)) throw new HttpError(400, `Unknown strategy "${id}"`);
      const tfs: string[] = (Array.isArray(req.body?.tfs) ? req.body.tfs.map(String) : ['5', '15', '30', '60']).filter((x: string) => ['1', '3', '5', '15', '30', '60', '120', '240'].includes(x)).slice(0, 4);
      const frames = [];
      for (const tf of tfs) {
        let m: Awaited<ReturnType<typeof loadMarket>>;
        try {
          m = await loadMarket({ ...req.body, tf });
        } catch (e) {
          frames.push({ tf, error: (e as Error).message, strategies: [] });
          continue;
        }
        if (!m.market.data.ok) {
          frames.push({ tf, error: m.market.data.issues.join(' '), strategies: [] });
          continue;
        }
        const raw = m.allBars;
        const all = evaluateAll(m).signals;
        // The candle that closes next: the forming one (when the source has it).
        const closedBars = m.live ? m.bars.slice(0, -1) : m.bars;
        const forming = raw.length && raw[raw.length - 1].t > (closedBars[closedBars.length - 1]?.t ?? Infinity) ? raw[raw.length - 1] : null;
        const strategies = ids.map((id) => {
          const sig = all.find((x) => x.strategyId === id)!;
          const scan = triggersFor(m, id).scan;
          return {
            strategyId: id,
            strategyName: sig.strategyName,
            family: sig.family,
            state: sig.state,
            stage: sig.stage,
            setupDir: sig.setupDir,
            isNew: sig.isNew,
            signalTime: sig.signalTime,
            entry: sig.entry,
            stop: sig.stop,
            targets: sig.targets,
            reason: sig.reason,
            tfOk: sig.tfOk,
            probability: sig.probability,
            trades: sig.all.trades,
            expectancyR: sig.all.expectancyR,
            triggers: scan.triggers,
            searched: scan.searched,
          };
        });
        const last = raw[raw.length - 1];
        frames.push({ tf, error: null, price: m.market.quote?.last ?? last?.c ?? null, formingOpen: forming?.o ?? null, formingCloseAt: forming ? new Date(forming.t + Number(tfMinutes(tf)) * 60000).toISOString() : null, live: m.live, data: m.market.data, strategies });
      }
      return { ticker: req.body?.ticker ?? req.body?.symbol, frames };
    }),
  );
  /** Plain-language version of the AI provider errors a user can act on. */
  const friendlyAiError = (msg: string, provider = '') => {
    const envKey = analystCatalog().find((p) => provider.startsWith(p.id))?.envKey ?? (provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY');
    if (/credit balance is too low/i.test(msg)) return 'Your Anthropic account has no credit left. Add credit under Plans & Billing at platform.claude.com (or turn Claude off with AI_ANALYSTS_OFF=anthropic in .env).';
    if (/RESOURCE_EXHAUSTED|quota|insufficient_quota|credits/i.test(msg)) return 'The free-tier limit for this key is used up for now. Wait a minute (or until tomorrow for a daily limit) and try again.';
    if (/invalid x-api-key|authentication_error|API_KEY_INVALID|API key not valid|invalid api key|PERMISSION_DENIED|\b401\b|\b403\b/i.test(msg)) return `The key was rejected. Check ${envKey} in the .env file (no spaces) and restart the app.`;
    if (/rate_limit|rate limit|\b429\b|\b413\b|too large|tokens per minute/i.test(msg)) return 'This free tier is rate-limiting right now (too many requests or tokens per minute). Wait a minute and try again.';
    if (/overloaded|529|\b503\b|UNAVAILABLE|high demand/i.test(msg)) return 'The AI service is busy right now (free tiers get overloaded at times). Try again in a minute.';
    if (/aborted due to timeout|TimeoutError/i.test(msg)) return 'The AI took too long to answer (free-tier models can be slow when busy). Try again in a minute.';
    if (/ECONNREFUSED|fetch failed/i.test(msg) && provider === 'ollama') return 'Ollama is not running on this computer. Start the Ollama app, or remove OLLAMA_MODEL from .env.';
    if (/No JSON object|Unexpected token|JSON/i.test(msg)) return 'The AI answered, but not in the required format, so its answer was not used.';
    const m = /"message":"([^"]+)"/.exec(msg);
    return m ? m[1] : msg;
  };

  // Economic calendar (Forex Factory weekly JSON), cached 30 minutes; failures just mean "no news data".
  let calCache: { at: number; events: CalendarEvent[] } | null = null;
  const calendarEvents = async (): Promise<CalendarEvent[]> => {
    if (calCache && Date.now() - calCache.at < 30 * 60_000) return calCache.events;
    try {
      const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as { title: string; country: string; date: string; impact: string }[];
      const events = raw.map((e) => ({ title: String(e.title), country: String(e.country), time: Date.parse(e.date), impact: String(e.impact) })).filter((e) => Number.isFinite(e.time));
      calCache = { at: Date.now(), events };
      return events;
    } catch {
      return calCache?.events ?? [];
    }
  };

  // Trade analyst panel: the rule-based analyst plus every configured AI (Gemini ×2, Groq, Mistral, …) weigh the same
  // evidence (all strategies on 5m–1H, next triggers, news, daily background). AIs may only pick price levels by id;
  // each answer is validated, then the answers are combined by vote (see combinePanel).
  const aiCache = new Map<string, { at: number; decision: AnalystDecision | null; problems: string[]; model: string | null }>();
  type AnalystRun = { id: string; name: string; model: string | null; kind: 'rules' | 'ai'; status: 'ok' | 'cached' | 'rejected' | 'error' | 'duplicate'; decision: AnalystDecision | null; error: string | null; problems: string[]; ms: number };
  const runAnalyst = async (m: AnalystMember, input: AnalystInput, levels: Level[], cacheKey: string): Promise<AnalystRun> => {
    const t0 = Date.now();
    const base = { id: m.id, name: m.name, kind: 'ai' as const };
    const key = `${m.id}|${cacheKey}`;
    const cached = aiCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60_000) return { ...base, model: cached.model, status: 'cached', decision: cached.decision, error: null, problems: cached.problems, ms: 0 };
    try {
      const evidence = evidenceForPrompt(input, levels, { compact: m.compact });
      const ai = await m.llm.completeJson<AiDecision>(ANALYST_SYSTEM, `Evidence (JSON):\n${JSON.stringify(evidence)}`, AI_DECISION_SCHEMA as unknown as Record<string, unknown>);
      const v = validateAiDecision(ai, levels, input);
      const model = usedModel(m.llm);
      aiCache.set(key, { at: Date.now(), decision: v.decision, problems: v.problems, model });
      if (aiCache.size > 300) aiCache.delete(aiCache.keys().next().value!);
      return { ...base, model, status: v.decision ? 'ok' : 'rejected', decision: v.decision, error: null, problems: v.problems, ms: Date.now() - t0 };
    } catch (e) {
      return { ...base, model: usedModel(m.llm), status: 'error', decision: null, error: friendlyAiError((e as Error).message, m.id), problems: [], ms: Date.now() - t0 };
    }
  };
  app.post(
    '/api/analyst',
    wrap(async (req) => {
      rateLimit(req, 'analyst', 30);
      const body = req.body ?? {};
      const focusTf = ['5', '15', '30', '60'].includes(String(body.focusTf)) ? String(body.focusTf) : '15';
      const ids: string[] = (Array.isArray(body.strategies) ? body.strategies.map(String) : []).filter((id: string) => TEMPLATES.some((t) => t.id === id)).slice(0, 6);
      const frames: FrameEvidence[] = [];
      let price: number | null = null;
      let change: number | null = null;
      for (const tf of ['5', '15', '30', '60']) {
        try {
          const m = await loadMarket({ ...body, tf });
          price ??= m.market.quote?.last ?? m.allBars[m.allBars.length - 1]?.c ?? null;
          change ??= m.market.change?.pct ?? null;
          if (!m.market.data.ok) {
            frames.push({ tf, dataStatus: 'invalid', signals: [], triggers: [] });
            continue;
          }
          frames.push({
            tf,
            dataStatus: m.market.data.status,
            signals: evaluateAll(m).signals,
            triggers: ids.map((id) => ({ strategyId: id, strategyName: TEMPLATES.find((t) => t.id === id)!.name, triggers: triggersFor(m, id).scan.triggers })),
          });
        } catch {
          frames.push({ tf, dataStatus: 'unavailable', signals: [], triggers: [] });
        }
      }
      if (price === null || !frames.some((f) => f.signals.length)) throw new HttpError(502, 'Market data is unavailable, so no analysis can be made right now.');
      const ticker = String(body.ticker ?? body.symbol ?? '');
      // Daily background (asset trend, dollar, yields, headlines) from the latest research report; refresh it in the
      // background when it is older than 6 hours so the next analysis has it.
      const latest = store.listReports(1)[0]?.report as ResearchReport | undefined;
      if (!latest || Date.now() - Date.parse(latest.createdAt) > 6 * 3600_000) research('quick').catch(() => {});
      const input: AnalystInput = { ticker, price, change24hPct: change, focusTf, frames, events: await calendarEvents(), context: marketContextFrom(latest, ticker) };
      const levels = buildLevels(input);
      const rules = ruleBasedDecision(input);
      const runs: AnalystRun[] = [{ id: 'rules', name: 'Rule-based analyst', model: null, kind: 'rules', status: 'ok', decision: rules, error: null, problems: [], ms: 0 }];
      if (body.useAI !== false && analysts.length) {
        // Same evidence (same candles on every timeframe) = same answer for 10 minutes, so a refresh does not pay twice.
        const cacheKey = [ticker, focusTf, ids.join(','), body.live ? 'live' : 'closed', input.context?.asOf ?? '', ...frames.map((f) => `${f.tf}:${f.signals.map((x) => `${x.strategyId}${x.state}${x.signalTime ?? ''}`).join('')}`)].join('|');
        const ai = await Promise.all(analysts.map((m) => runAnalyst(m, input, levels, cacheKey)));
        // Two analysts that ended up on the same model (e.g. after a fallback) would be one opinion counted twice.
        for (const r of ai) {
          if (r.decision && ai.some((o) => o !== r && o.decision && o.model === r.model && ai.indexOf(o) < ai.indexOf(r))) {
            r.status = 'duplicate';
            r.decision = null;
          }
        }
        runs.push(...ai);
      }
      const verdict = combinePanel(runs.map((r) => ({ id: r.id, name: r.name, model: r.model, decision: r.decision })), focusTf);
      return {
        engine: runs.length > 1 ? 'panel' : 'rules',
        aiConfigured: analysts.length > 0,
        decision: verdict.decision,
        verdict: { action: verdict.action, votes: verdict.votes, counted: verdict.counted, agree: verdict.agree, summary: verdict.summary, chosenFrom: verdict.chosenFrom, waitFor: verdict.waitFor },
        analysts: runs,
        providers: analystCatalog(),
        context: input.context ?? null,
        price,
        levelsConsidered: levels.length,
        evidence: frames.map((f) => ({ tf: f.tf, dataStatus: f.dataStatus, buy: f.signals.filter((x) => x.state === 'BUY').length, sell: f.signals.filter((x) => x.state === 'SELL').length, strategies: f.signals.length })),
        news: input.events.filter((e) => e.impact === 'High' && e.time >= Date.now() - 3600_000 && e.time <= Date.now() + 36 * 3600_000).slice(0, 6),
        generatedAt: new Date().toISOString(),
      };
    }),
  );
  app.post(
    '/api/rankings',
    wrap(async (req) => {
      rateLimit(req, 'rankings', 6);
      const m = await loadMarket(req.body ?? {});
      if (!m.market.data.ok) throw new HttpError(422, `Cannot rank on invalid data: ${m.market.data.issues.join(' ')}`);
      const minTrades = store.getSetting<number>('ranking.minTrades', 30);
      const minOos = store.getSetting<number>('ranking.minOos', 10);
      const reviews = store.listReviews();
      const rows: RankRow[] = TEMPLATES.map((t) => {
        const s = evaluateStrategy(specForTemplate(t.id, m.market.tf, m.market.ticker), m.bars, m.market.tf, { qtyStep: m.qtyStep, templateId: t.id, withSeries: false });
        return { strategyId: t.id, strategyName: t.name, family: t.family, category: t.category, strategyVersion: s.strategyVersion, all: s.all, outOfSample: s.outOfSample, evidence: evidenceOf(s.all, s.outOfSample, minTrades, minOos), tfOk: s.tfOk };
      });
      return {
        market: m.market,
        bars: { count: m.bars.length, from: new Date(m.bars[0].t).toISOString(), to: m.market.data.lastClosedAt },
        minTrades,
        minOos,
        rows: rankStrategies(rows).map((r) => ({ ...r, review: reviews[r.strategyId]?.status ?? 'experimental' })),
        method: `Every strategy runs on the same ${m.bars.length} closed ${m.market.ticker} bars with the same execution model (next-bar-open fills, ${'commission + slippage'}, conservative same-candle rule). Ranked by out-of-sample expectancy (last 30% of bars, after costs). "High evidence" needs ≥ ${minTrades} trades and ≥ ${minOos} out-of-sample trades; others are listed as insufficient evidence. Past results on one market and period do not predict future results.`,
      };
    }),
  );
  app.post(
    '/api/strategy-script',
    wrap((req) => {
      const id = String(req.body?.strategyId ?? '');
      if (!TEMPLATES.some((t) => t.id === id)) throw new HttpError(400, `Unknown strategy "${id}"`);
      const tf = String(req.body?.tf ?? '60');
      const sym = String(req.body?.symbol ?? '');
      const spec = specForTemplate(id, tf, sym);
      const hash = specHash(spec);
      const existing = store.findVersionByHash(hash, specHash);
      if (existing) {
        store.logEvent('script', { symbol: sym, tf, strategyId: id, detail: 'reused' });
        return { reused: true, scriptId: existing.scriptId, version: existing.version, validation: existing.validation, strategyVersion: hash };
      }
      const art = buildArtifacts(spec);
      if (art.validation.errorCount > 0) {
        // Invalid scripts are not stored as reusable versions.
        store.logEvent('script_fail', { symbol: sym, tf, strategyId: id, detail: `${art.validation.errorCount} validation error(s)` });
        throw new HttpError(422, `Generated script failed validation with ${art.validation.errorCount} error(s); it was not saved.`);
      }
      const script = store.createScript(`${spec.meta.name} · ${spec.market.symbol || 'any'} · ${spec.market.timeframe}`, spec.output);
      const v = store.addVersion(script.id, { code: art.code, spec, validation: art.validation, log: art.log, note: 'Generated from the market dashboard', output: spec.output });
      store.logEvent('script', { symbol: sym, tf, strategyId: id, detail: 'generated' });
      return { reused: false, scriptId: script.id, version: v.version, validation: v.validation, strategyVersion: hash };
    }),
  );
  app.get('/api/opportunities', wrap(() => store.listOpportunities()));
  app.post(
    '/api/opportunities',
    wrap((req) => {
      const b = req.body ?? {};
      const sig = b.signal as StrategySignal | undefined;
      const mk = b.market as { symbol: string; source: string; ticker: string; instrument: string; tf: string } | undefined;
      if (!sig || !mk || (sig.state !== 'BUY' && sig.state !== 'SELL')) throw new HttpError(400, 'Only a BUY or SELL signal can be saved.');
      if (sig.entry == null || sig.stop == null || !sig.signalTime || !Array.isArray(sig.targets) || !sig.targets.length) throw new HttpError(400, 'Signal is missing entry, stop or targets.');
      // A trailed stop may be beyond the entry; then only the targets' side is checked.
      const issues = levelIssues(sig.state === 'BUY' ? 1 : -1, Number(sig.entry), sig.stopMoved ? Number(sig.entry) - (sig.state === 'BUY' ? 1 : -1) : Number(sig.stop), sig.targets.map(Number));
      if (issues.length) throw new HttpError(400, `Inconsistent levels: ${issues.join(' ')}`);
      const o = store.addOpportunity({
        symbol: String(mk.symbol),
        source: String(mk.source),
        ticker: String(mk.ticker),
        instrument: String(mk.instrument),
        tf: String(mk.tf),
        strategyId: String(sig.strategyId),
        strategyName: String(sig.strategyName),
        strategyVersion: String(sig.strategyVersion),
        direction: sig.state === 'BUY' ? 1 : -1,
        signalTime: sig.signalTime,
        entry: Number(sig.entry),
        stop: Number(sig.stop),
        targets: sig.targets.map(Number),
        snapshot: { signal: { ...sig, markers: undefined, indicators: undefined, levels: undefined, events: undefined, exits: undefined }, market: b.market, confluence: b.confluence ?? null },
        note: String(b.note ?? '').slice(0, 500),
      });
      store.logEvent('save', { symbol: o.ticker, tf: o.tf, strategyId: o.strategyId });
      return o;
    }),
  );
  app.get(
    '/api/opportunities/:id',
    wrap((req) => {
      const o = store.getOpportunity(String(req.params.id));
      if (!o) throw new HttpError(404, 'Opportunity not found');
      return o;
    }),
  );
  app.get(
    '/api/opportunities/:id/evaluate',
    wrap(async (req) => {
      const o = store.getOpportunity(String(req.params.id));
      if (!o) throw new HttpError(404, 'Opportunity not found');
      let candles: CandleResponse;
      try {
        candles = await getCandles({ symbol: o.ticker, tf: o.tf, limit: 1500, source: o.source as never, ticker: o.ticker });
      } catch (e) {
        throw new HttpError(502, `Cannot evaluate — market data unavailable: ${(e as Error).message}`);
      }
      const { bars } = checkBars(candles.bars, candles.tf);
      // Outcomes are measured forward only, from the first bar that opened after the opportunity was saved.
      return evaluateOutcome({ dir: o.direction, entry: o.entry, stop: o.stop, targets: o.targets, savedAt: Date.parse(o.createdAt) }, bars);
    }),
  );
  app.delete(
    '/api/opportunities/:id',
    wrap((req) => ({ deleted: store.deleteOpportunity(String(req.params.id)) })),
  );

  // ─── Strategy discovery: published methodologies mapped to independent implementations ───
  app.get('/api/discovery', (_req, res) => {
    res.json(DISCOVERY);
  });

  // ─── Administrator (requires ADMIN_TOKEN; separate from the user workflow) ───
  const requireAdmin = (req: Request) => {
    const token = process.env.ADMIN_TOKEN;
    if (!token) throw new HttpError(503, 'Administrator access is disabled. Set ADMIN_TOKEN in the server environment to enable it.');
    const given = Buffer.from(String(req.headers['x-admin-token'] ?? ''));
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(401, 'Administrator token missing or invalid.');
  };
  app.get(
    '/api/admin/overview',
    wrap((req) => {
      requireAdmin(req);
      const since = req.query.since ? String(req.query.since) : undefined;
      const scripts = store.listScripts().map((s) => {
        const v = store.getVersion(s.id, s.latestVersion);
        return { id: s.id, name: s.name, version: s.latestVersion, errors: v?.validation && (v.validation as any).errorCount, warnings: v?.validation && (v.validation as any).warningCount, compiled: v?.compile ?? null, updatedAt: s.updatedAt };
      });
      const gen = store.countEvents('script', 'strategy_id', since).reduce((a, x) => a + x.count, 0);
      const fails = store.countEvents('script_fail', 'strategy_id', since).reduce((a, x) => a + x.count, 0);
      return {
        usage: {
          strategies: store.countEvents('activate', 'strategy_id', since),
          saved: store.countEvents('save', 'strategy_id', since),
          assets: store.countEvents('activate', 'symbol', since),
          timeframes: store.countEvents('activate', 'tf', since),
        },
        scripts: { awaitingCompile: scripts.filter((s) => !s.compiled), withErrors: scripts.filter((s) => (s.errors ?? 0) > 0), total: scripts.length, generationFailRate: gen + fails ? fails / (gen + fails) : null, recentFailures: store.recentEvents('script_fail', 10) },
        providers: providerStats,
        signalErrors: store.recentEvents('signal_error', 15),
        reviews: store.listReviews(),
        reviewLog: store.reviewLog(),
        ranking: { minTrades: store.getSetting<number>('ranking.minTrades', 30), minOos: store.getSetting<number>('ranking.minOos', 10) },
        llm: llm.status(),
      };
    }),
  );
  app.put(
    '/api/admin/strategies/:id/review',
    wrap((req) => {
      requireAdmin(req);
      const id = String(req.params.id);
      if (!TEMPLATES.some((t) => t.id === id)) throw new HttpError(404, 'Unknown strategy');
      const status = String(req.body?.status ?? '') as ReviewStatus;
      if (!['experimental', 'awaiting_validation', 'approved', 'deprecated'].includes(status)) throw new HttpError(400, 'Invalid status');
      const note = String(req.body?.note ?? '').slice(0, 500);
      if (status === 'approved' && !note) throw new HttpError(400, 'Approval needs a note naming the evidence (asset, timeframe, period, trade count).');
      store.setReview(id, status, note);
      return { ok: true, review: store.listReviews()[id] };
    }),
  );
  app.put(
    '/api/admin/ranking',
    wrap((req) => {
      requireAdmin(req);
      const minTrades = Math.round(Number(req.body?.minTrades));
      const minOos = Math.round(Number(req.body?.minOos));
      if (!(minTrades >= 10 && minTrades <= 1000) || !(minOos >= 5 && minOos <= minTrades)) throw new HttpError(400, 'minTrades must be 10–1000 and minOos 5–minTrades.');
      store.setSetting('ranking.minTrades', minTrades);
      store.setSetting('ranking.minOos', minOos);
      return { minTrades, minOos };
    }),
  );

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
