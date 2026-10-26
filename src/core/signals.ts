// Turns a strategy simulation into a current BUY / SELL / NO TRADE summary, checks the market data first,
// and compares several strategies without counting correlated ones (same family) as independent evidence.
// Everything here is deterministic: same bars + same spec = same answer.
import { createHash } from 'node:crypto';
import { runSimulation, type Bar, type Overlay, type SimResult, type SimTrade } from './sim/engine';
import { specFromTemplate } from './spec';
import { getTemplate } from './templates';
import { tfMinutes } from './timeframe';
import type { Family, StrategySpec } from './types';

export type SignalState = 'BUY' | 'SELL' | 'NO TRADE';

export interface DataCheck {
  ok: boolean;
  /** live: last closed bar ended within ~2 bars; stale: older; invalid: cannot be used for signals. */
  status: 'live' | 'stale' | 'invalid';
  lastClosedAt: string | null;
  ageMinutes: number | null;
  droppedFormingBar: boolean;
  issues: string[];
}

/**
 * Validates OHLC bars and removes the still-forming last bar, so signals use confirmed bars only
 * (the same rule the generated Pine scripts follow with barstate.isconfirmed).
 */
export function checkBars(barsIn: Bar[], tf: string, now = Date.now()): { bars: Bar[]; check: DataCheck } {
  const issues: string[] = [];
  const min = tfMinutes(tf);
  if (!min) return { bars: [], check: { ok: false, status: 'invalid', lastClosedAt: null, ageMinutes: null, droppedFormingBar: false, issues: [`Unknown timeframe ${tf}`] } };
  const ms = min * 60000;
  let bars = barsIn;
  let dropped = false;
  if (bars.length && bars[bars.length - 1].t + ms > now) {
    bars = bars.slice(0, -1);
    dropped = true;
  }
  let bad = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const finite = [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0);
    if (!finite || b.h < Math.max(b.o, b.c) - 1e-9 || b.l > Math.min(b.o, b.c) + 1e-9) bad++;
    if (i > 0 && b.t <= bars[i - 1].t) {
      issues.push(`Timestamps not increasing at bar ${i}.`);
      break;
    }
  }
  if (bad) issues.push(`${bad} bar(s) with impossible OHLC values.`);
  if (bars.length < 250) issues.push(`Only ${bars.length} closed bars — at least 250 are needed for the 200-period filters to warm up.`);
  const invalid = issues.length > 0;
  // Missing candles inside a session (overnight/weekend gaps under 36h on intraday bars count; longer = market closed).
  if (!invalid && min < 1440) {
    let gaps = 0;
    for (let i = 1; i < bars.length; i++) {
      const d = bars[i].t - bars[i - 1].t;
      if (d > ms && d < 36 * 3600_000 && d <= 6 * ms) gaps++;
    }
    if (gaps > bars.length * 0.02) issues.push(`${gaps} short gaps (missing candles) — results may differ from the exchange chart.`);
  }
  const last = bars[bars.length - 1];
  const age = last ? (now - (last.t + ms)) / 60000 : null;
  const stale = !invalid && age !== null && age > Math.max(2 * min, 5);
  if (stale) issues.push(`Last closed bar ended ${Math.round(age!)} min ago — market closed or feed delayed. Signals are shown as of that bar.`);
  return {
    bars: invalid ? [] : bars,
    check: { ok: !invalid, status: invalid ? 'invalid' : stale ? 'stale' : 'live', lastClosedAt: last ? new Date(last.t + ms).toISOString() : null, ageMinutes: age === null ? null : Math.round(age * 10) / 10, droppedFormingBar: dropped, issues },
  };
}

export function specHash(spec: StrategySpec): string {
  const { meta: _m, notes: _n, ...rest } = spec;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 12);
}

/** One completed position = one trade, however many partial targets it took. */
export interface TradeResult {
  r: number;
  holdBars: number;
  /** Target and stop both inside a fill bar: order unknown from these candles. */
  ambiguous: boolean;
}

export interface PerfSummary {
  trades: number;
  wins: number;
  losses: number;
  /** |R| < 0.05 after costs; excluded from the win-rate denominator. */
  breakEven: number;
  /** wins / (wins + losses), in %. */
  winRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Win rate needed to break even with this win/loss size: |avgLoss| / (avgWin + |avgLoss|). */
  breakEvenWinRate: number | null;
  expectancyR: number | null;
  grossProfitR: number;
  grossLossR: number;
  profitFactor: number | null;
  totalR: number;
  maxDrawdownR: number;
  avgHoldBars: number | null;
  maxConsecWins: number;
  maxConsecLosses: number;
  ambiguous: number;
}

const BE = 0.05;

export function perf(results: TradeResult[]): PerfSummary {
  const rs = results.map((t) => t.r);
  const wins = rs.filter((r) => r >= BE);
  const losses = rs.filter((r) => r <= -BE);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const avgW = wins.length ? sum(wins) / wins.length : null;
  const avgL = losses.length ? sum(losses) / losses.length : null;
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let cw = 0;
  let cl = 0;
  let mw = 0;
  let ml = 0;
  for (const r of rs) {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    cw = r >= BE ? cw + 1 : 0;
    cl = r <= -BE ? cl + 1 : 0;
    mw = Math.max(mw, cw);
    ml = Math.max(ml, cl);
  }
  const gp = sum(wins);
  const gl = -sum(losses);
  const decided = wins.length + losses.length;
  return {
    trades: rs.length,
    wins: wins.length,
    losses: losses.length,
    breakEven: rs.length - decided,
    winRate: decided ? (100 * wins.length) / decided : null,
    avgWinR: avgW,
    avgLossR: avgL,
    breakEvenWinRate: avgW !== null && avgL !== null ? (100 * -avgL) / (avgW - avgL) : null,
    expectancyR: rs.length ? sum(rs) / rs.length : null,
    grossProfitR: gp,
    grossLossR: gl,
    profitFactor: gl > 0 ? gp / gl : null,
    totalR: sum(rs),
    maxDrawdownR: dd,
    avgHoldBars: results.length ? sum(results.map((t) => t.holdBars)) / results.length : null,
    maxConsecWins: mw,
    maxConsecLosses: ml,
    ambiguous: results.filter((t) => t.ambiguous).length,
  };
}

/**
 * Converts simulated trades into results after commission, with a conservative rule: when a bar that filled a
 * target also touched the stop, the whole position is counted at the stop (the candle cannot tell which came first).
 */
export function tradeResults(trades: SimTrade[], bars: Bar[], spec: StrategySpec): TradeResult[] {
  const b = spec.backtest;
  return trades
    .filter((t) => t.r !== null && t.exitBar !== null)
    .map((t) => {
      const targetBars = t.partials.filter((p) => /TP/i.test(p.label)).map((p) => bars[p.bar]);
      const stopTouched = (bar: Bar) => (t.dir === 1 ? bar.l <= t.stop : bar.h >= t.stop);
      const ambiguous = targetBars.some(stopTouched);
      let r = t.r as number;
      if (ambiguous) r = Math.min(r, (t.dir * (t.stop - t.entry)) / t.risk);
      const exitPx = t.exitPrice ?? bars[t.exitBar!].c;
      const costR = b.commissionType === 'percent' && t.risk > 0 ? ((b.commissionValue / 100) * (t.entry + exitPx)) / t.risk : 0;
      return { r: r - costR, holdBars: t.exitBar! - t.entryBar, ambiguous };
    });
}

export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  family: Family;
  category: string;
  strategyVersion: string;
  state: SignalState;
  /** confirmed: entry signal fired on a closed bar; setup: trigger seen, confirmation still missing; none. */
  stage: 'confirmed' | 'setup' | 'none';
  /** True when the entry signal fired on the last closed bar. */
  isNew: boolean;
  reason: string;
  /** Rule checks at the signal bar (or the last bar for a developing setup). */
  reasons: { label: string; role: string; met: boolean }[];
  invalidation: string[];
  /** Weighted share of the strategy's own filters that agree (0–100). Not a probability. */
  ruleScore: number | null;
  setupDir: 1 | -1 | 0;
  signalTime: string | null;
  barsSinceSignal: number | null;
  entry: number | null;
  /** True when the strategy-mode market order has not filled yet (fills at the next bar open). */
  pendingFill: boolean;
  stop: number | null;
  targets: number[];
  rewardRisk: number | null;
  tfOk: boolean;
  tfNote: string;
  entryLogic: string;
  exitLogic: string;
  inSample: PerfSummary;
  outOfSample: PerfSummary;
  all: PerfSummary;
  splitTime: string | null;
  costNote: string;
  /** Entry signals; `why` lists the rules that were met on that candle. */
  markers: { t: number; dir: 1 | -1; text: string; detail: string; why: string[]; price: number | null; stop: number | null; filledT: number | null }[];
  /** Exits and partial take-profits of every simulated trade. */
  exits: { t: number; dir: 1 | -1; text: string; detail: string; good: boolean }[];
  /** Indicator events (liquidity sweep, BOS/CHoCH, FVG, patterns…) from this strategy's own components. */
  events: { t: number; side: 'above' | 'below'; tone: 'bull' | 'bear' | 'neutral'; text: string; detail: string }[];
  /** Per-bar entry / stop / target levels of each trade while it is open (null between trades). */
  levels: { entry: (number | null)[]; stop: (number | null)[]; tp1: (number | null)[]; tp2: (number | null)[]; final: (number | null)[] } | null;
  indicators: { name: string; color: string; style?: Overlay['style']; values: (number | null)[] }[];
  issues: string[];
}

/** Levels must be ordered stop < entry < targets (long) or the mirror (short); anything else is refused. */
export function levelIssues(dir: 1 | -1, entry: number, stop: number, targets: number[]): string[] {
  const out: string[] = [];
  if (![entry, stop, ...targets].every(Number.isFinite)) out.push('Non-numeric entry/stop/target.');
  else {
    if (dir * (entry - stop) <= 0) out.push('Stop is on the wrong side of the entry.');
    if (targets.some((t) => dir * (t - entry) <= 0)) out.push('A target is on the wrong side of the entry.');
    for (let k = 1; k < targets.length; k++) if (dir * (targets[k] - targets[k - 1]) < 0) out.push('Targets are not in order.');
  }
  return out;
}

export function specForTemplate(templateId: string, tf: string, symbol: string): StrategySpec {
  const base = specFromTemplate(templateId, { output: 'strategy' });
  // Passing the market as an override re-runs the higher-timeframe guard for the chosen chart timeframe.
  return specFromTemplate(templateId, { output: 'strategy', market: { ...base.market, symbol, timeframe: tf } });
}

const round = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(8)) : null);

/** Signal summary for one strategy over confirmed bars. Out-of-sample = trades entered in the last 30% of bars. */
export function evaluateStrategy(spec: StrategySpec, bars: Bar[], tf: string, opts: { qtyStep?: number; templateId?: string; withSeries?: boolean } = {}): StrategySignal {
  const t = opts.templateId ? getTemplate(opts.templateId) : null;
  const empty = perf([]);
  const out: StrategySignal = {
    strategyId: opts.templateId ?? spec.meta.name,
    strategyName: t?.name ?? spec.meta.name,
    family: (t?.family ?? 'trend') as Family,
    category: t?.category ?? spec.meta.category ?? '',
    strategyVersion: specHash(spec),
    state: 'NO TRADE',
    stage: 'none',
    isNew: false,
    reason: '',
    reasons: [],
    invalidation: [],
    ruleScore: null,
    setupDir: 0,
    signalTime: null,
    barsSinceSignal: null,
    entry: null,
    pendingFill: false,
    stop: null,
    targets: [],
    rewardRisk: null,
    tfOk: true,
    tfNote: spec.market.timeframeNote ?? '',
    entryLogic: t?.entryLogic ?? '',
    exitLogic: t?.exitLogic ?? '',
    inSample: empty,
    outOfSample: empty,
    all: empty,
    splitTime: null,
    costNote: `Costs: ${spec.backtest.commissionValue}% commission per side and ${spec.backtest.slippageTicks} ticks slippage; market orders fill at the next bar open; a target and the stop inside one candle count as a stop.`,
    markers: [],
    exits: [],
    events: [],
    levels: null,
    indicators: [],
    issues: [],
  };
  if (bars.length < 250) return { ...out, reason: 'Not enough valid market data to evaluate.', issues: ['insufficient data'] };
  let res: SimResult;
  try {
    res = runSimulation(spec, bars, { chartTf: tf, qtyStep: opts.qtyStep, showEvents: opts.withSeries !== false });
  } catch (e) {
    return { ...out, reason: `Strategy could not be evaluated: ${(e as Error).message}`, issues: ['evaluation error'] };
  }
  const n = bars.length;
  const split = Math.floor(n * 0.7);
  const done = res.trades.filter((x) => x.r !== null && x.exitBar !== null);
  const results = tradeResults(done, bars, spec);
  out.inSample = perf(results.filter((_, k) => done[k].entryBar < split));
  out.outOfSample = perf(results.filter((_, k) => done[k].entryBar >= split));
  out.all = perf(results);
  out.splitTime = new Date(bars[split].t).toISOString();
  out.tfOk = res.tfOk;
  // Entry price = the trade's fill price (next candle open + slippage in strategy mode), or the signal close if not filled yet.
  const bySignal = new Map([...res.trades, ...(res.open ? [res.open] : [])].map((tr) => [tr.signalBar, tr]));
  out.markers = res.markers
    .filter((m) => (m.kind === 'entry' || m.kind === 'strong') && m.dir !== 0)
    .map((m) => ({
      price: bySignal.get(m.bar)?.entry ?? null,
      stop: bySignal.get(m.bar)?.initialStop ?? null,
      filledT: bySignal.has(m.bar) && bars[bySignal.get(m.bar)!.entryBar] ? bars[bySignal.get(m.bar)!.entryBar].t : null,
      t: bars[m.bar].t,
      dir: m.dir as 1 | -1,
      text: m.text,
      detail: m.detail,
      why: res
        .info(m.bar)
        .conds.filter((c) => c.role !== 'exit' && (m.dir === 1 ? c.L : c.S))
        .map((c) => c.label),
    }));
  if (opts.withSeries !== false) {
    out.indicators = res.overlays.map((o) => ({ name: o.name, color: o.color, style: o.style, values: o.values.map(round) }));
    out.exits = res.markers.filter((m) => m.kind === 'exit' || m.kind === 'tp').map((m) => ({ t: bars[m.bar].t, dir: m.dir as 1 | -1, text: m.text.replace(/^EXIT /, ''), detail: m.detail, good: m.kind === 'tp' || !!m.good }));
    out.events = res.markers.filter((m) => m.kind === 'event').map((m) => ({ t: bars[m.bar].t, side: m.side, tone: m.dir === 1 ? 'bull' : m.dir === -1 ? 'bear' : 'neutral', text: m.text, detail: m.detail }));
    const lv = res.levels;
    out.levels = { entry: lv.entry.map(round), stop: lv.stop.map(round), tp1: lv.tp1.map(round), tp2: lv.tp2.map(round), final: lv.final.map(round) };
  }
  const ruleChecks = (i: number, side: 'L' | 'S') =>
    res
      .info(i)
      .conds.filter((c) => c.role !== 'exit')
      .map((c) => ({ label: c.label, role: c.role, met: side === 'L' ? c.L : c.S }));

  const o = res.open;
  if (!o) {
    const last = n - 1;
    const setupL = res.markers.some((m) => m.bar === last && m.kind === 'setup' && m.dir === 1);
    const setupS = res.markers.some((m) => m.bar === last && m.kind === 'setup' && m.dir === -1);
    const lastExit = res.trades[res.trades.length - 1];
    out.reason = lastExit ? `No open position: last trade closed ${n - 1 - (lastExit.exitBar ?? n - 1)} bar(s) ago (${lastExit.reason}).` : 'No entry signal in the loaded data.';
    if (setupL || setupS) {
      out.stage = 'setup';
      out.setupDir = setupL ? 1 : -1;
      out.reasons = ruleChecks(last, setupL ? 'L' : 'S');
      out.ruleScore = setupL ? res.info(last).scoreL : res.info(last).scoreS;
      out.reason += ` Developing ${setupL ? 'long' : 'short'} setup: the trigger fired on the last closed bar but confirmation is incomplete — not an entry.`;
    } else out.reason += ' Waiting for the next entry signal.';
    if (!res.tfOk) out.reason += ' Chart timeframe is outside the range this strategy was designed for.';
    return out;
  }
  const targets = o.targets;
  const issues = levelIssues(o.dir, o.entry, o.stop, targets);
  if (issues.length) {
    out.issues = issues;
    out.reason = `Signal withheld — inconsistent levels: ${issues.join(' ')}`;
    return out;
  }
  const side = o.dir === 1 ? 'L' : 'S';
  const info = res.info(o.signalBar);
  out.state = o.dir === 1 ? 'BUY' : 'SELL';
  out.stage = 'confirmed';
  out.isNew = o.signalBar === n - 1;
  out.signalTime = new Date(bars[o.signalBar].t).toISOString();
  out.barsSinceSignal = n - 1 - o.signalBar;
  out.entry = o.entry;
  out.pendingFill = !o.filled;
  out.stop = o.stop;
  out.targets = targets;
  out.reasons = ruleChecks(o.signalBar, side);
  out.ruleScore = side === 'L' ? info.scoreL : info.scoreS;
  const exitRules = res
    .info(n - 1)
    .conds.filter((c) => c.role === 'exit')
    .map((c) => `Exit rule: ${c.label}`);
  out.invalidation = [`A candle trades ${o.dir === 1 ? 'at or below' : 'at or above'} the stop (${o.stop})`, ...exitRules, `An opposite ${o.dir === 1 ? 'SELL' : 'BUY'} signal from this strategy`];
  const fin = targets[targets.length - 1];
  out.rewardRisk = Math.abs(o.entry - o.stop) > 0 ? Math.abs(fin - o.entry) / Math.abs(o.entry - o.stop) : null;
  out.reason = `${out.isNew ? 'New' : 'Active'} ${o.dir === 1 ? 'long' : 'short'} from the ${out.barsSinceSignal === 0 ? 'last closed bar' : `signal ${out.barsSinceSignal} bar(s) ago`}; stop and targets not hit yet.${o.partials.length ? ` Partial exits so far: ${o.partials.map((p) => p.label).join(', ')}.` : ''}${o.stop !== o.initialStop ? ' Stop has moved (breakeven/trail).' : ''}`;
  if (!res.tfOk) out.reason += ' Chart timeframe is outside the range this strategy was designed for.';
  return out;
}

export interface Confluence {
  state: SignalState;
  label: string;
  /** Share of independent families agreeing with the leading direction (0–100). Not a probability. */
  score: number;
  agreeing: number;
  disagreeing: number;
  buyFamilies: Family[];
  sellFamilies: Family[];
  neutralFamilies: Family[];
  /** Families whose strategies disagree with each other. */
  splitFamilies: Family[];
  /** Distance between the active entries, in average stop distances. */
  priceSpread: number | null;
  explanation: string;
}

/**
 * Strategies in the same family (e.g. two trend followers) share inputs, so they count once.
 * A family votes only when its active strategies agree. The combined view is BUY/SELL only when at least
 * two independent families agree and none oppose. This describes agreement — it is not a probability.
 */
export function confluence(signals: (Pick<StrategySignal, 'family' | 'state'> & Partial<Pick<StrategySignal, 'entry' | 'stop'>>)[]): Confluence {
  const fam = new Map<Family, Set<SignalState>>();
  for (const s of signals) fam.set(s.family, (fam.get(s.family) ?? new Set()).add(s.state));
  const buy: Family[] = [];
  const sell: Family[] = [];
  const neutral: Family[] = [];
  const split: Family[] = [];
  for (const [f, set] of fam) {
    const dirs = [...set].filter((x) => x !== 'NO TRADE');
    if (dirs.length > 1) split.push(f);
    else if (dirs[0] === 'BUY') buy.push(f);
    else if (dirs[0] === 'SELL') sell.push(f);
    else neutral.push(f);
  }
  const total = fam.size;
  let state: SignalState = 'NO TRADE';
  let label = 'No agreement';
  if (buy.length >= 2 && sell.length === 0 && split.length === 0) {
    state = 'BUY';
    label = `${buy.length} of ${total} independent families agree BUY`;
  } else if (sell.length >= 2 && buy.length === 0 && split.length === 0) {
    state = 'SELL';
    label = `${sell.length} of ${total} independent families agree SELL`;
  } else if (buy.length && sell.length) label = 'Strategies disagree';
  else if (buy.length + sell.length === 1) label = `Only one family (${[...buy, ...sell][0]}) has a position — insufficient evidence`;
  const lead = Math.max(buy.length, sell.length);
  const active = signals.filter((s) => s.state !== 'NO TRADE' && s.entry != null && s.stop != null);
  let spread: number | null = null;
  if (active.length >= 2) {
    const entries = active.map((s) => s.entry as number);
    const avgRisk = active.reduce((a, s) => a + Math.abs((s.entry as number) - (s.stop as number)), 0) / active.length;
    spread = avgRisk > 0 ? (Math.max(...entries) - Math.min(...entries)) / avgRisk : null;
  }
  const explanation = `${signals.length} strateg${signals.length === 1 ? 'y' : 'ies'} in ${total} famil${total === 1 ? 'y' : 'ies'}. Strategies from the same family count once because they use correlated inputs. The score is the share of families agreeing — a description of the current rules, not a probability of success.${spread !== null && spread > 1 ? ` Active entries are ${spread.toFixed(1)} stop-distances apart, so they are not the same entry.` : ''}`;
  return {
    state,
    label,
    score: total ? Math.round((100 * lead) / total) : 0,
    agreeing: lead,
    disagreeing: Math.min(buy.length, sell.length) + split.length,
    buyFamilies: buy,
    sellFamilies: sell,
    neutralFamilies: neutral,
    splitFamilies: split,
    priceSpread: spread,
    explanation,
  };
}

export interface RankRow {
  strategyId: string;
  strategyName: string;
  family: Family;
  category: string;
  strategyVersion: string;
  all: PerfSummary;
  outOfSample: PerfSummary;
  /** high: ≥ minTrades in total and ≥ minOos out-of-sample; low: some trades; none. */
  evidence: 'high' | 'low' | 'none';
  tfOk: boolean;
}

export function evidenceOf(all: PerfSummary, oos: PerfSummary, minTrades: number, minOos: number): RankRow['evidence'] {
  return all.trades >= minTrades && oos.trades >= minOos ? 'high' : all.trades > 0 ? 'low' : 'none';
}

/**
 * Ranks strategies by out-of-sample expectancy after costs, but strategies with enough trades always come
 * first; the rest follow as insufficient evidence. Same bars and execution model for every strategy.
 */
export function rankStrategies(rows: RankRow[]): RankRow[] {
  const order = { high: 0, low: 1, none: 2 };
  return [...rows].sort((a, b) => order[a.evidence] - order[b.evidence] || (b.outOfSample.expectancyR ?? -99) - (a.outOfSample.expectancyR ?? -99) || (b.all.expectancyR ?? -99) - (a.all.expectancyR ?? -99));
}

export interface OutcomeEval {
  status: 'open' | 'target' | 'stopped' | 'pending' | 'no-data';
  barsChecked: number;
  hitAt: string | null;
  /** Result in R if closed; current unrealised R if still open. */
  r: number | null;
  mfeR: number;
  maeR: number;
  lastPrice: number | null;
  note: string;
}

/**
 * Follows a saved signal forward on bars after it was saved. Conservative: if stop and the first target
 * are touched in the same bar, the stop is assumed first. Never mutates the saved record.
 */
export function evaluateOutcome(o: { dir: 1 | -1; entry: number; stop: number; targets: number[]; savedAt: number }, bars: Bar[]): OutcomeEval {
  const after = bars.filter((b) => b.t >= o.savedAt);
  const risk = Math.abs(o.entry - o.stop);
  if (!after.length || !(risk > 0)) return { status: after.length ? 'no-data' : 'pending', barsChecked: 0, hitAt: null, r: null, mfeR: 0, maeR: 0, lastPrice: bars[bars.length - 1]?.c ?? null, note: after.length ? 'Invalid risk.' : 'No closed bars since the opportunity was saved yet.' };
  const tp = o.targets[0];
  let mfe = 0;
  let mae = 0;
  for (const b of after) {
    const fav = o.dir === 1 ? b.h - o.entry : o.entry - b.l;
    const adv = o.dir === 1 ? o.entry - b.l : b.h - o.entry;
    mfe = Math.max(mfe, fav / risk);
    mae = Math.max(mae, adv / risk);
    const stopHit = o.dir === 1 ? b.l <= o.stop : b.h >= o.stop;
    const tpHit = tp !== undefined && (o.dir === 1 ? b.h >= tp : b.l <= tp);
    if (stopHit) return { status: 'stopped', barsChecked: after.indexOf(b) + 1, hitAt: new Date(b.t).toISOString(), r: -1, mfeR: mfe, maeR: mae, lastPrice: b.c, note: tpHit ? 'Stop and first target touched in the same bar — counted as a stop (conservative).' : 'Stop hit.' };
    if (tpHit) return { status: 'target', barsChecked: after.indexOf(b) + 1, hitAt: new Date(b.t).toISOString(), r: Math.abs(tp - o.entry) / risk, mfeR: mfe, maeR: mae, lastPrice: b.c, note: 'First target hit.' };
  }
  const last = after[after.length - 1].c;
  return { status: 'open', barsChecked: after.length, hitAt: null, r: (o.dir * (last - o.entry)) / risk, mfeR: mfe, maeR: mae, lastPrice: last, note: 'Neither stop nor first target reached yet.' };
}
