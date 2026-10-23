// Typed client for the Pine Forge API.
import type { ComponentDef, Diagnostic, Family, StrategySpec, TemplateDef, ValidationReport, Metrics, Trade, Flag, MonteCarloResult, Resource, TopicStat, NewsItem, RegimeResult, CalendarEvent, ConsensusSpec } from '../core';

export type { StrategySpec, TemplateDef, ValidationReport, Diagnostic, Metrics, Trade, Flag, Resource };

export interface CatalogComponent extends Omit<ComponentDef, 'emit' | 'helpers' | 'structureStop'> {
  hasStructureStop: boolean;
}
export interface Catalog {
  families: Family[];
  components: CatalogComponent[];
  templates: TemplateDef[];
  presets: { id: string; name: string; description: string; templates: string[]; consensus: Partial<ConsensusSpec> }[];
}
export interface ExplainSection {
  title: string;
  items: string[];
}
export interface ScriptRow {
  id: string;
  name: string;
  output: string;
  favorite: boolean;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}
export interface VersionRow {
  id: string;
  scriptId: string;
  version: number;
  code: string;
  spec: StrategySpec;
  validation: ValidationReport;
  log: string[];
  note: string;
  compile: { at: string; ok: boolean; messages: string[] } | null;
  createdAt: string;
}
export interface GenerateResponse {
  code: string;
  log: string[];
  stats: { lines: number; inputs: number; plots: number; components: number; voters: number };
  validation: ValidationReport;
  explanation: ExplainSection[];
}
export interface InterpretResponse {
  spec: StrategySpec;
  log: string[];
  source: 'rules' | 'llm';
  aiError?: string;
}
export interface BacktestSummary {
  id: string;
  scriptId: string | null;
  label: string;
  kind: string;
  source: string;
  initialCapital: number | null;
  createdAt: string;
  tradeCount: number;
  metrics: Metrics;
}
export interface BacktestAnalysis {
  metrics: Metrics;
  equity: number[];
  inSample: Metrics;
  outSample: Metrics;
  ratio: number;
  walkForward: { fold: number; metrics: Metrics }[];
  costStress: { multiplier: number; metrics: Metrics }[];
  monteCarlo: MonteCarloResult | null;
  flags: Flag[];
  long: Metrics;
  short: Metrics;
}
export interface MarketSnapshot {
  symbol: string;
  name: string;
  ok: boolean;
  provider?: string;
  providerNote?: string;
  error?: string;
  regime?: RegimeResult;
  closes?: number[];
}
export interface ResearchReport {
  createdAt: string;
  durationMs: number;
  mode: 'quick' | 'deep';
  sources: { id: string; name: string; category: string; url: string; ok: boolean; count: number; error?: string }[];
  markets: MarketSnapshot[];
  news: NewsItem[];
  newsByAsset: Record<string, NewsItem[]>;
  topics: TopicStat[];
  overallTone: number | null;
  calendar: { events: CalendarEvent[]; blackouts: { session: string; timezone: string; label: string; time: number }[] } | null;
  cryptoFearGreed: { value: number; label: string; history: number[] } | null;
  strategyIdeas: { symbol: string; regime: string; templates: { id: string; name: string }[] }[];
  briefing: { source: 'llm' | 'rules'; model?: string; markdown: string; error?: string };
  disclaimers: string[];
}
export interface WatchItem {
  symbol: string;
  name: string;
  query: string;
  periodsPerYear?: number;
  providers: ({ kind: 'yahoo'; ticker: string; note?: string } | { kind: 'binance'; pair: string; note?: string } | { kind: 'frankfurter'; base: string; quote: string; note?: string } | { kind: 'twelvedata'; symbol: string; note?: string })[];
}
export interface Settings {
  llm: { provider: string; model: string | null; configured: boolean; note: string };
  autoRefreshMinutes: number;
  watchlist: WatchItem[];
  defaultWatchlist: WatchItem[];
  twelveDataConfigured: boolean;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  catalog: () => call<Catalog>('GET', '/catalog'),
  resources: () => call<Resource[]>('GET', '/resources'),
  settings: () => call<Settings>('GET', '/settings'),
  saveSettings: (s: Partial<Pick<Settings, 'autoRefreshMinutes' | 'watchlist'>>) => call<{ ok: boolean }>('PUT', '/settings', s),
  interpret: (prompt: string, useAI: boolean) => call<InterpretResponse>('POST', '/spec/interpret', { prompt, useAI }),
  fromTemplate: (templateId: string, output?: 'strategy' | 'indicator') => call<{ spec: StrategySpec }>('POST', '/spec/template', { templateId, output }),
  consensus: (body: { presetId?: string; templateIds?: string[]; name?: string }) => call<{ spec: StrategySpec }>('POST', '/spec/consensus', body),
  generate: (spec: StrategySpec) => call<GenerateResponse>('POST', '/generate', { spec }),
  riskPreview: (spec: StrategySpec, p: { price: number; atr: number; pointValue: number; equity: number; tick: number }) =>
    call<{ stopDistance: number; qty: number; riskCash: number; targets: number[]; plannedRR: number; note: string }>('POST', '/risk-preview', { spec, ...p }),
  lint: (code: string) => call<{ diagnostics: Diagnostic[]; checksRun: string[] }>('POST', '/lint', { code }),
  scripts: () => call<ScriptRow[]>('GET', '/scripts'),
  createScript: (spec: StrategySpec, name?: string, note?: string) => call<{ script: ScriptRow; version: VersionRow }>('POST', '/scripts', { spec, name, note }),
  script: (id: string) => call<{ script: ScriptRow; versions: VersionRow[] }>('GET', `/scripts/${id}`),
  updateScript: (id: string, patch: { name?: string; favorite?: boolean }) => call<ScriptRow>('PATCH', `/scripts/${id}`, patch),
  deleteScript: (id: string) => call<{ deleted: boolean }>('DELETE', `/scripts/${id}`),
  addVersion: (id: string, spec: StrategySpec, note: string) => call<{ version: VersionRow }>('POST', `/scripts/${id}/versions`, { spec, note }),
  addManualVersion: (id: string, spec: StrategySpec, code: string, note: string) => call<{ version: VersionRow }>('POST', `/scripts/${id}/versions`, { spec, code, note }),
  explain: (id: string, v: number) => call<ExplainSection[]>('GET', `/scripts/${id}/versions/${v}/explain`),
  recordCompile: (id: string, v: number, ok: boolean, messages: string) => call<VersionRow>('POST', `/scripts/${id}/versions/${v}/compile`, { ok, messages }),
  fix: (code: string, errors: string) => call<{ hints: { title: string; fix: string }[]; context: { line: number; text: string; before: string[]; after: string[] }[]; suggestion: string | null; aiError?: string; note: string }>('POST', '/fix', { code, errors }),
  parseBacktest: (csv: string, initialCapital?: number) => call<{ trades: Trade[]; warnings: string[]; columns: Record<string, string | null>; format: string; metrics: Metrics }>('POST', '/backtests/parse', { csv, initialCapital }),
  saveBacktest: (b: { csv: string; label: string; kind: string; scriptId?: string | null; initialCapital?: number }) => call<{ backtest: { id: string }; warnings: string[] }>('POST', '/backtests', b),
  backtests: (scriptId?: string) => call<BacktestSummary[]>('GET', `/backtests${scriptId ? `?scriptId=${scriptId}` : ''}`),
  analysis: (id: string, q: { ratio: number; folds: number; costPct: number; costCash: number }) =>
    call<{ backtest: BacktestSummary; trades: Trade[]; analysis: BacktestAnalysis }>('GET', `/backtests/${id}/analysis?ratio=${q.ratio}&folds=${q.folds}&costPct=${q.costPct}&costCash=${q.costCash}`),
  compare: (ids: string[]) => call<{ runs: { label: string; kind: string; metrics: Metrics }[]; stability: { cvNetProfit: number | null; allProfitable: boolean; message: string } }>('GET', `/backtests/compare?ids=${ids.join(',')}`),
  deleteBacktest: (id: string) => call<{ deleted: boolean }>('DELETE', `/backtests/${id}`),
  candles: (q: { symbol: string; assetClass?: string; tf: string; limit: number; source?: string; ticker?: string }) =>
    call<{ bars: { t: number; o: number; h: number; l: number; c: number; v: number }[]; source: string; ticker: string; tf: string; note: string; label: string; qtyStep: number; isProxy: boolean }>(
      'GET',
      `/candles?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()}`,
    ),
  candleSources: (symbol: string, assetClass?: string) =>
    call<{ source: string; ticker: string; isProxy: boolean; note: string; label: string }[]>('GET', `/candles/sources?${new URLSearchParams({ symbol, ...(assetClass ? { assetClass } : {}) })}`),
  popularSymbols: () => call<{ symbol: string; label: string }[]>('GET', '/candles/popular'),
  runResearch: (mode: 'quick' | 'deep') => call<ResearchReport>('POST', '/research/run', { mode }),
  latestResearch: () => call<{ id: string; createdAt: string; report: ResearchReport } | null>('GET', '/research/latest'),
  researchHistory: () => call<{ id: string; createdAt: string; mode: string; news: number; topics: TopicStat[] }[]>('GET', '/research/history'),
  researchById: (id: string) => call<{ id: string; createdAt: string; report: ResearchReport }>('GET', `/research/${id}`),
};
