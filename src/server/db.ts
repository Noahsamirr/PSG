// SQLite persistence (Node's built-in node:sqlite) for scripts, versions, compile records,
// backtests and research reports. Swap this module for PostgreSQL without touching routes.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

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
  spec: unknown;
  validation: unknown;
  log: string[];
  note: string;
  compile: { at: string; ok: boolean; messages: string[] } | null;
  createdAt: string;
}

export interface BacktestRow {
  id: string;
  scriptId: string | null;
  label: string;
  kind: string;
  source: string;
  trades: unknown[];
  initialCapital: number | null;
  createdAt: string;
}

export interface OpportunityRow {
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
  /** The full signal + data status at save time. Never modified afterwards. */
  snapshot: unknown;
  note: string;
}

export type ReviewStatus = 'experimental' | 'awaiting_validation' | 'approved' | 'deprecated';

export interface UsageEvent {
  at: string;
  type: 'activate' | 'save' | 'script' | 'script_fail' | 'signal_error';
  symbol: string;
  tf: string;
  strategyId: string;
  detail: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, output TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY, script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE, version INTEGER NOT NULL,
        code TEXT NOT NULL, spec_json TEXT NOT NULL, validation_json TEXT NOT NULL, log_json TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '', compile_json TEXT, created_at TEXT NOT NULL, UNIQUE(script_id, version));
      CREATE TABLE IF NOT EXISTS backtests (
        id TEXT PRIMARY KEY, script_id TEXT, label TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
        trades_json TEXT NOT NULL, initial_capital REAL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_reports (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, report_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, symbol TEXT NOT NULL, source TEXT NOT NULL, ticker TEXT NOT NULL,
        instrument TEXT NOT NULL, tf TEXT NOT NULL, strategy_id TEXT NOT NULL, strategy_name TEXT NOT NULL,
        strategy_version TEXT NOT NULL, direction INTEGER NOT NULL CHECK (direction IN (1, -1)),
        signal_time TEXT NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL, targets_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('activate', 'save', 'script', 'script_fail', 'signal_error')),
        symbol TEXT NOT NULL DEFAULT '', tf TEXT NOT NULL DEFAULT '', strategy_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS usage_events_type ON usage_events(type, at);
      CREATE TABLE IF NOT EXISTS strategy_reviews (
        strategy_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('experimental', 'awaiting_validation', 'approved', 'deprecated')),
        note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS strategy_review_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, at TEXT NOT NULL);
    `);
  }

  private now() {
    return new Date().toISOString();
  }

  listScripts(): ScriptRow[] {
    const rows = this.db
      .prepare(`SELECT s.*, (SELECT MAX(version) FROM versions v WHERE v.script_id = s.id) AS latest FROM scripts s ORDER BY updated_at DESC`)
      .all() as any[];
    return rows.map((r) => ({ id: r.id, name: r.name, output: r.output, favorite: !!r.favorite, latestVersion: r.latest ?? 0, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  getScript(id: string): ScriptRow | null {
    return this.listScripts().find((s) => s.id === id) ?? null;
  }

  createScript(name: string, output: string): ScriptRow {
    const id = randomUUID();
    const t = this.now();
    this.db.prepare('INSERT INTO scripts (id, name, output, favorite, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(id, name, output, t, t);
    return this.getScript(id)!;
  }

  updateScript(id: string, patch: { name?: string; favorite?: boolean }) {
    const s = this.getScript(id);
    if (!s) return null;
    this.db.prepare('UPDATE scripts SET name = ?, favorite = ?, updated_at = ? WHERE id = ?').run(patch.name ?? s.name, patch.favorite ?? s.favorite ? 1 : 0, this.now(), id);
    return this.getScript(id);
  }

  deleteScript(id: string) {
    this.db.prepare('DELETE FROM versions WHERE script_id = ?').run(id);
    return this.db.prepare('DELETE FROM scripts WHERE id = ?').run(id).changes > 0;
  }

  addVersion(scriptId: string, v: { code: string; spec: unknown; validation: unknown; log: string[]; note?: string; output?: string }): VersionRow {
    const next = ((this.db.prepare('SELECT MAX(version) AS m FROM versions WHERE script_id = ?').get(scriptId) as any)?.m ?? 0) + 1;
    const id = randomUUID();
    const t = this.now();
    this.db
      .prepare('INSERT INTO versions (id, script_id, version, code, spec_json, validation_json, log_json, note, compile_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .run(id, scriptId, next, v.code, JSON.stringify(v.spec), JSON.stringify(v.validation), JSON.stringify(v.log), v.note ?? '', t);
    this.db.prepare('UPDATE scripts SET updated_at = ?, output = COALESCE(?, output) WHERE id = ?').run(t, v.output ?? null, scriptId);
    return this.getVersion(scriptId, next)!;
  }

  private mapVersion(r: any): VersionRow {
    return {
      id: r.id,
      scriptId: r.script_id,
      version: r.version,
      code: r.code,
      spec: JSON.parse(r.spec_json),
      validation: JSON.parse(r.validation_json),
      log: JSON.parse(r.log_json),
      note: r.note,
      compile: r.compile_json ? JSON.parse(r.compile_json) : null,
      createdAt: r.created_at,
    };
  }

  listVersions(scriptId: string): VersionRow[] {
    return (this.db.prepare('SELECT * FROM versions WHERE script_id = ? ORDER BY version DESC').all(scriptId) as any[]).map((r) => this.mapVersion(r));
  }

  getVersion(scriptId: string, version: number): VersionRow | null {
    const r = this.db.prepare('SELECT * FROM versions WHERE script_id = ? AND version = ?').get(scriptId, version);
    return r ? this.mapVersion(r) : null;
  }

  setCompile(scriptId: string, version: number, compile: VersionRow['compile'], validation: unknown) {
    this.db.prepare('UPDATE versions SET compile_json = ?, validation_json = ? WHERE script_id = ? AND version = ?').run(JSON.stringify(compile), JSON.stringify(validation), scriptId, version);
    return this.getVersion(scriptId, version);
  }

  addBacktest(b: Omit<BacktestRow, 'id' | 'createdAt'>): BacktestRow {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO backtests (id, script_id, label, kind, source, trades_json, initial_capital, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, b.scriptId, b.label, b.kind, b.source, JSON.stringify(b.trades), b.initialCapital, this.now());
    return this.getBacktest(id)!;
  }

  private mapBacktest(r: any): BacktestRow {
    return { id: r.id, scriptId: r.script_id, label: r.label, kind: r.kind, source: r.source, trades: JSON.parse(r.trades_json), initialCapital: r.initial_capital, createdAt: r.created_at };
  }

  listBacktests(scriptId?: string): BacktestRow[] {
    const rows = scriptId ? this.db.prepare('SELECT * FROM backtests WHERE script_id = ? ORDER BY created_at DESC').all(scriptId) : this.db.prepare('SELECT * FROM backtests ORDER BY created_at DESC').all();
    return (rows as any[]).map((r) => this.mapBacktest(r));
  }

  getBacktest(id: string): BacktestRow | null {
    const r = this.db.prepare('SELECT * FROM backtests WHERE id = ?').get(id);
    return r ? this.mapBacktest(r) : null;
  }

  deleteBacktest(id: string) {
    return this.db.prepare('DELETE FROM backtests WHERE id = ?').run(id).changes > 0;
  }

  addReport(report: unknown): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO research_reports (id, created_at, report_json) VALUES (?, ?, ?)').run(id, this.now(), JSON.stringify(report));
    // Keep the 30 most recent reports.
    this.db.prepare('DELETE FROM research_reports WHERE id NOT IN (SELECT id FROM research_reports ORDER BY created_at DESC LIMIT 30)').run();
    return id;
  }

  listReports(limit = 10): { id: string; createdAt: string; report: any }[] {
    return (this.db.prepare('SELECT * FROM research_reports ORDER BY created_at DESC LIMIT ?').all(limit) as any[]).map((r) => ({ id: r.id, createdAt: r.created_at, report: JSON.parse(r.report_json) }));
  }

  addOpportunity(o: Omit<OpportunityRow, 'id' | 'createdAt'>): OpportunityRow {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO opportunities (id, created_at, symbol, source, ticker, instrument, tf, strategy_id, strategy_name, strategy_version, direction, signal_time, entry, stop, targets_json, snapshot_json, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, this.now(), o.symbol, o.source, o.ticker, o.instrument, o.tf, o.strategyId, o.strategyName, o.strategyVersion, o.direction, o.signalTime, o.entry, o.stop, JSON.stringify(o.targets), JSON.stringify(o.snapshot), o.note);
    return this.getOpportunity(id)!;
  }

  private mapOpportunity(r: any): OpportunityRow {
    return {
      id: r.id,
      createdAt: r.created_at,
      symbol: r.symbol,
      source: r.source,
      ticker: r.ticker,
      instrument: r.instrument,
      tf: r.tf,
      strategyId: r.strategy_id,
      strategyName: r.strategy_name,
      strategyVersion: r.strategy_version,
      direction: r.direction,
      signalTime: r.signal_time,
      entry: r.entry,
      stop: r.stop,
      targets: JSON.parse(r.targets_json),
      snapshot: JSON.parse(r.snapshot_json),
      note: r.note,
    };
  }

  listOpportunities(): OpportunityRow[] {
    return (this.db.prepare('SELECT * FROM opportunities ORDER BY created_at DESC').all() as any[]).map((r) => this.mapOpportunity(r));
  }

  getOpportunity(id: string): OpportunityRow | null {
    const r = this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
    return r ? this.mapOpportunity(r) : null;
  }

  deleteOpportunity(id: string) {
    return this.db.prepare('DELETE FROM opportunities WHERE id = ?').run(id).changes > 0;
  }

  /** Latest stored version whose spec hash matches — lets the dashboard reuse an existing script. */
  findVersionByHash(hash: string, hashOf: (spec: any) => string): VersionRow | null {
    for (const s of this.listScripts()) {
      const v = this.getVersion(s.id, s.latestVersion);
      if (v && hashOf(v.spec) === hash) return v;
    }
    return null;
  }

  logEvent(type: UsageEvent['type'], e: { symbol?: string; tf?: string; strategyId?: string; detail?: string } = {}) {
    this.db.prepare('INSERT INTO usage_events (at, type, symbol, tf, strategy_id, detail) VALUES (?, ?, ?, ?, ?, ?)').run(this.now(), type, e.symbol ?? '', e.tf ?? '', e.strategyId ?? '', (e.detail ?? '').slice(0, 500));
  }

  /** Counts per key for one event type, optionally since an ISO date. */
  countEvents(type: UsageEvent['type'], by: 'symbol' | 'tf' | 'strategy_id', since?: string): { key: string; count: number }[] {
    return (this.db.prepare(`SELECT ${by} AS key, COUNT(*) AS count FROM usage_events WHERE type = ? AND at >= ? GROUP BY ${by} ORDER BY count DESC LIMIT 20`).all(type, since ?? '') as any[]).map((r) => ({ key: r.key, count: Number(r.count) }));
  }

  recentEvents(type: UsageEvent['type'], limit = 20): UsageEvent[] {
    return (this.db.prepare('SELECT * FROM usage_events WHERE type = ? ORDER BY id DESC LIMIT ?').all(type, limit) as any[]).map((r) => ({ at: r.at, type: r.type, symbol: r.symbol, tf: r.tf, strategyId: r.strategy_id, detail: r.detail }));
  }

  listReviews(): Record<string, { status: ReviewStatus; note: string; updatedAt: string }> {
    const out: Record<string, { status: ReviewStatus; note: string; updatedAt: string }> = {};
    for (const r of this.db.prepare('SELECT * FROM strategy_reviews').all() as any[]) out[r.strategy_id] = { status: r.status, note: r.note, updatedAt: r.updated_at };
    return out;
  }

  /** Review status changes are logged; they never touch the measured performance. */
  setReview(strategyId: string, status: ReviewStatus, note: string) {
    const t = this.now();
    this.db.prepare('INSERT INTO strategy_reviews (strategy_id, status, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(strategy_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at').run(strategyId, status, note, t);
    this.db.prepare('INSERT INTO strategy_review_log (strategy_id, status, note, at) VALUES (?, ?, ?, ?)').run(strategyId, status, note, t);
  }

  reviewLog(limit = 30): { strategyId: string; status: string; note: string; at: string }[] {
    return (this.db.prepare('SELECT * FROM strategy_review_log ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({ strategyId: r.strategy_id, status: r.status, note: r.note, at: r.at }));
  }

  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return r ? (JSON.parse(r.value) as T) : fallback;
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }
}
