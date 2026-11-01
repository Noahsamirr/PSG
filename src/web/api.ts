// Typed client for the Pine Forge API.
import type { ComponentDef, Diagnostic, Family, StrategySpec, TemplateDef, ValidationReport, Metrics, Trade, Flag, MonteCarloResult, Resource, TopicStat, NewsItem, RegimeResult, CalendarEvent, ConsensusSpec } from '../core';

import type { StrategySignal, Confluence, OutcomeEval, DataCheck, RankRow } from '../core/signals';
import type { MethodProfile } from '../core/discovery';
import type { TradePlan } from '../core/plans';
import type { Trigger } from '../core/outlook';
import type { Action, AnalystDecision, MarketContext } from '../core/analyst';
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

export interface Instrument {
  id: string;
  source: string;
  ticker: string;
  name: string;
  assetClass: string;
  kind: string;
  quoteCurrency: string;
  provider: string;
  session: string;
  realtime: boolean;
  needsKey?: boolean;
}
export interface Quote {
  source: string;
  ticker: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  exchangeTime: string | null;
  receivedAt: string;
  delayed: boolean;
  note: string;
}
export interface MarketInfo {
  symbol: string;
  source: string;
  ticker: string;
  name: string;
  instrument: string;
  provider: string;
  quoteCurrency: string;
  session: string;
  realtime: boolean;
  label: string;
  note: string;
  isProxy: boolean;
  tf: string;
  fetchedAt: string;
  data: DataCheck;
  quote: Quote | null;
  quoteError: string | null;
  change: { abs: number; pct: number; since: string } | null;
  crossCheck: { source: string; ticker: string; last: number; diffPct: number; note: string } | null;
}
export interface SignalsResponse {
  market: MarketInfo;
  bars: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  signals: StrategySignal[];
  confluence: Confluence;
}
export interface Opportunity {
  id: string;
  createdAt: string;
  symbol: string;
  source: string;
  ticker: string;
  instrument: string;
  tf: string;
  strategyId: string;
  strategyName: string;
  strategyVersion: string;
  direction: 1 | -1;
  signalTime: string;
  entry: number;
  stop: number;
  targets: number[];
  snapshot: { signal?: Partial<StrategySignal>; market?: Partial<MarketInfo>; confluence?: Confluence | null };
  note: string;
}
export interface OutlookStrategy {
  strategyId: string;
  strategyName: string;
  family: string;
  state: 'BUY' | 'SELL' | 'NO TRADE';
  stage: 'confirmed' | 'setup' | 'none';
  setupDir: 1 | -1 | 0;
  isNew: boolean;
  signalTime: string | null;
  entry: number | null;
  stop: number | null;
  targets: number[];
  reason: string;
  tfOk: boolean;
  probability: StrategySignal['probability'];
  trades: number;
  expectancyR: number | null;
  triggers: Trigger[];
  searched: { low: number; high: number };
}
export interface OutlookFrame {
  tf: string;
  error: string | null;
  price?: number | null;
  formingOpen?: number | null;
  formingCloseAt?: string | null;
  live?: boolean;
  data?: DataCheck;
  strategies: OutlookStrategy[];
}

export interface AnalystRun {
  id: string;
  name: string;
  model: string | null;
  kind: 'rules' | 'ai';
  status: 'ok' | 'cached' | 'rejected' | 'error' | 'duplicate';
  decision: AnalystDecision | null;
  error: string | null;
  problems: string[];
  ms: number;
}
export interface AnalystProvider {
  id: string;
  name: string;
  envKey: string;
  modelEnv: string;
  signupUrl: string;
  free: string;
  configured: boolean;
}
export interface AnalystResponse {
  engine: 'panel' | 'rules';
  aiConfigured: boolean;
  decision: AnalystDecision;
  verdict: { action: Action; votes: Record<Action, number>; counted: number; agree: number; summary: string; chosenFrom: string | null; waitFor: string[] };
  analysts: AnalystRun[];
  providers: AnalystProvider[];
  context: MarketContext | null;
  price: number;
  levelsConsidered: number;
  evidence: { tf: string; dataStatus: string; buy: number; sell: number; strategies: number }[];
  news: { title: string; country: string; time: number; impact: string }[];
  generatedAt: string;
}

export type ReviewStatus = 'experimental' | 'awaiting_validation' | 'approved' | 'deprecated';
export interface StrategyInfo {
  id: string;
  name: string;
  category: string;
  family: Family;
  summary: string;
  timeframes: string;
  tfRange?: [string, string];
  review: { status: ReviewStatus; note: string; updatedAt: string | null };
}
export interface Rankings {
  market: MarketInfo;
  bars: { count: number; from: string; to: string | null };
  minTrades: number;
  minOos: number;
  rows: (RankRow & { review: ReviewStatus })[];
  method: string;
}
export interface AdminOverview {
  usage: Record<'strategies' | 'saved' | 'assets' | 'timeframes', { key: string; count: number }[]>;
  scripts: { awaitingCompile: { id: string; name: string; version: number; errors?: number; warnings?: number }[]; withErrors: { id: string; name: string; version: number; errors?: number }[]; total: number; generationFailRate: number | null; recentFailures: { at: string; strategyId: string; detail: string }[] };
  providers: Record<string, { ok: number; fail: number; lastError: string | null; lastErrorAt: string | null; lastOkAt: string | null }>;
  signalErrors: { at: string; symbol: string; tf: string; detail: string }[];
  reviews: Record<string, { status: ReviewStatus; note: string; updatedAt: string }>;
  reviewLog: { strategyId: string; status: string; note: string; at: string }[];
  ranking: { minTrades: number; minOos: number };
  llm: { provider: string; model: string | null; configured: boolean; note: string };
}
export type { StrategySignal, Confluence, OutcomeEval, DataCheck, RankRow, MethodProfile, TradePlan, Trigger };

async function callAuth<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method, headers: { 'x-admin-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  searchInstruments: (q: string) => call<{ results: Instrument[]; total: number; errors: string[] }>('GET', `/market/search?q=${encodeURIComponent(q)}`),
  quote: (source: string, ticker: string) => call<Quote>('GET', `/market/quote?source=${encodeURIComponent(source)}&ticker=${encodeURIComponent(ticker)}`),
  strategies: () => call<StrategyInfo[]>('GET', '/strategies'),
  signals: (body: { source: string; ticker: string; tf: string; strategies: string[]; activated?: string[]; live?: boolean; limit?: number }) => call<SignalsResponse>('POST', '/signals', body),
  outlook: (body: { source: string; ticker: string; strategies: string[]; tfs?: string[]; live?: boolean }) => call<{ ticker: string; frames: OutlookFrame[] }>('POST', '/outlook', body),
  tradePlans: (body: { source: string; ticker: string; tf: string; live?: boolean }) => call<{ market: MarketInfo; plans: TradePlan[]; evaluated: number }>('POST', '/trade-plans', body),
  analyst: (body: { source: string; ticker: string; focusTf: string; strategies: string[]; live?: boolean; useAI?: boolean }) => call<AnalystResponse>('POST', '/analyst', body),
  rankings: (body: { source: string; ticker: string; tf: string }) => call<Rankings>('POST', '/rankings', body),
  strategyScript: (body: { strategyId: string; tf: string; symbol: string }) => call<{ reused: boolean; scriptId: string; version: number; validation: ValidationReport; strategyVersion: string }>('POST', '/strategy-script', body),
  opportunities: () => call<Opportunity[]>('GET', '/opportunities'),
  saveOpportunity: (body: { signal: StrategySignal; market: MarketInfo; confluence: Confluence; note?: string }) => call<Opportunity>('POST', '/opportunities', body),
  evaluateOpportunity: (id: string) => call<OutcomeEval>('GET', `/opportunities/${id}/evaluate`),
  deleteOpportunity: (id: string) => call<{ deleted: boolean }>('DELETE', `/opportunities/${id}`),
  discovery: () => call<MethodProfile[]>('GET', '/discovery'),
  admin: (token: string) => callAuth<AdminOverview>('GET', '/admin/overview', token),
  adminReview: (token: string, id: string, status: ReviewStatus, note: string) => callAuth<{ ok: boolean }>('PUT', `/admin/strategies/${id}/review`, token, { status, note }),
  adminRanking: (token: string, minTrades: number, minOos: number) => callAuth<{ minTrades: number; minOos: number }>('PUT', '/admin/ranking', token, { minTrades, minOos }),
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
