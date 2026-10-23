// Validation pipeline: spec → static code → trading logic → platform (TradingView) → backtest.
import { getComponent, hasComponent } from '../components';
import type { Diagnostic, StageResult, StrategySpec, ValidationReport } from '../types';
import { lintPine } from './pineLint';
import { plannedRR, SPEC_CHECKS, validateSpec } from './spec';

export { lintPine } from './pineLint';
export { validateSpec, plannedRR, tfToMinutes } from './spec';

export const LOGIC_CHECKS = [
  'entries-for-enabled-directions',
  'protective-stop-on-every-entry',
  'confirmed-bar-signals',
  'no-pyramiding / flat-only entries',
  'plotted-levels-equal-order-levels',
  'alerts-for-requested-events',
  'repainting-disclosure',
  'risk-preview',
];

export interface CompileRecord {
  at: string;
  ok: boolean;
  messages: string[];
}

export interface BacktestCheckInput {
  trades: number;
  profitFactor: number | null;
  hasCosts: boolean;
}

function stage(stageId: StageResult['stage'], title: string, checksRun: string[], diagnostics: Diagnostic[], note?: string): StageResult {
  const status = diagnostics.some((d) => d.severity === 'error') ? 'fail' : diagnostics.some((d) => d.severity === 'warning') ? 'warn' : 'pass';
  return { stage: stageId, title, status, checksRun, diagnostics, note };
}

export interface RiskPreviewInput {
  price: number;
  atr: number;
  pointValue: number;
  equity: number;
}

export interface RiskPreview {
  stopDistance: number;
  qty: number;
  riskCash: number;
  targets: number[];
  plannedRR: number;
  note: string;
}

/** Mirrors the Pine risk engine (ATR / percent / ticks stops) for a quick sanity preview. */
export function riskPreview(spec: StrategySpec, inp: RiskPreviewInput, tick = 0.01): RiskPreview {
  const r = spec.risk;
  const dist =
    r.stopMode === 'Percent' ? (inp.price * r.stopPercent) / 100 : r.stopMode === 'Ticks' ? r.stopTicks * tick : r.atrMult * inp.atr; // structure ≈ ATR for preview
  const riskUnit = dist * inp.pointValue;
  const notionalUnit = inp.price * inp.pointValue;
  let raw: number;
  switch (r.sizing.mode) {
    case 'Fixed quantity':
      raw = r.sizing.value;
      break;
    case 'Fixed cash risk':
      raw = riskUnit > 0 ? r.sizing.value / riskUnit : 0;
      break;
    case 'Percent of equity notional':
      raw = notionalUnit > 0 ? (inp.equity * r.sizing.value) / 100 / notionalUnit : 0;
      break;
    default:
      raw = riskUnit > 0 ? (inp.equity * r.sizing.value) / 100 / riskUnit : 0;
  }
  const capRisk = r.sizing.maxRiskPct > 0 && riskUnit > 0 ? (inp.equity * r.sizing.maxRiskPct) / 100 / riskUnit : raw;
  const step = r.sizing.qtyStep > 0 ? r.sizing.qtyStep : spec.market.assetClass === 'crypto' ? 0.0001 : 1;
  const qty = Math.floor(Math.min(raw, capRisk, r.sizing.maxQty) / step + 1e-9) * step;
  return {
    stopDistance: dist,
    qty,
    riskCash: qty * riskUnit,
    targets: r.tpR.slice(0, r.tpCount).map((m) => inp.price + m * dist),
    plannedRR: plannedRR(spec),
    note: r.stopMode === 'Structure' ? 'Structure stops depend on live swing levels; the preview approximates them with the ATR stop.' : 'Long-side preview; short side mirrors it.',
  };
}

export function validateLogic(spec: StrategySpec, code: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (check: string, severity: Diagnostic['severity'], message: string) => out.push({ stage: 'logic', check, severity, message });
  const isStrat = spec.output === 'strategy';
  const dir = spec.filters.direction;

  if (dir !== 'short' && !/goLong = longSignal and allowLong/.test(code)) add('entries-for-enabled-directions', 'error', 'Long entries are enabled but no long entry path was generated.');
  if (dir !== 'long' && !/goShort = shortSignal and allowShort/.test(code)) add('entries-for-enabled-directions', 'error', 'Short entries are enabled but no short entry path was generated.');
  if (isStrat) {
    if (!/strategy\.entry\(/.test(code)) add('entries-for-enabled-directions', 'error', 'No strategy.entry() call.');
    if (!/strategy\.exit\([^\n]*stop = tSL/.test(code)) add('protective-stop-on-every-entry', 'error', 'No protective stop attached to entries.');
    if (!/pyramiding = 0/.test(code) || !/flat = posSize == 0 and tDir == 0/.test(code)) add('no-pyramiding / flat-only entries', 'error', 'Entries are not restricted to a flat position.');
  } else if (!/flat = tDir == 0/.test(code)) add('no-pyramiding / flat-only entries', 'error', 'Indicator simulation does not restrict entries to a flat state.');
  if (!/_sig[LS] = .*barstate\.isconfirmed/.test(code)) add('confirmed-bar-signals', 'error', 'Signals are not gated on confirmed bars.');
  if (!/plot\(i_showLevels and inTrade \? tSL/.test(code)) add('plotted-levels-equal-order-levels', 'warning', 'Stop level is not plotted from the order state.');
  if (spec.alerts.entry && !/ENTRY_LONG/.test(code)) add('alerts-for-requested-events', 'error', 'Entry alerts requested but not generated.');
  if (spec.alerts.exit && !/POSITION_CLOSED/.test(code)) add('alerts-for-requested-events', 'error', 'Exit alerts requested but not generated.');

  // Repainting disclosure per component
  for (const c of spec.components) {
    if (!hasComponent(c.type)) continue;
    const def = getComponent(c.type);
    if (def.doc.repaintClass === 'confirmation-delay') add('repainting-disclosure', 'info', `${def.name}: ${def.doc.repainting}`);
    if (def.doc.repaintClass === 'htf-confirmed') add('repainting-disclosure', 'info', `${def.name}: non-repainting HTF request (previous completed HTF bar).`);
  }
  if (!isStrat) add('repainting-disclosure', 'info', 'Indicator mode: on the live bar a "forming" marker can appear and disappear until the bar closes; confirmed signals never change.');

  const pv = riskPreview(spec, { price: 100, atr: 1, pointValue: 1, equity: spec.backtest.initialCapital });
  add('risk-preview', 'info', `Sizing check (price 100, ATR 1, point value 1, equity ${spec.backtest.initialCapital}): stop distance ${pv.stopDistance.toFixed(2)}, qty ${pv.qty}, risk ≈ ${pv.riskCash.toFixed(2)}, targets ${pv.targets.map((t) => t.toFixed(2)).join(' / ')}.`);
  if (pv.qty <= 0 && spec.risk.sizing.mode !== 'Fixed quantity') add('risk-preview', 'warning', 'Sizing rounds to 0 units in the preview — check the quantity step and account size.');
  return out;
}

export function runValidation(spec: StrategySpec, code: string, opts: { compile?: CompileRecord | null; backtest?: BacktestCheckInput | null } = {}): ValidationReport {
  const specD = validateSpec(spec);
  const lint = lintPine(code);
  const logicD = validateLogic(spec, code);
  const stages: StageResult[] = [
    stage('spec', 'Specification', SPEC_CHECKS, specD),
    stage('static', 'Static Pine v6 analysis (not a compiler)', lint.checksRun, lint.diagnostics, `${lint.stats.logicalLines} logical lines, ${lint.stats.plotCalls} plot-type calls analysed.`),
    stage('logic', 'Trading logic', LOGIC_CHECKS, logicD),
  ];
  if (opts.compile) {
    const diags: Diagnostic[] = opts.compile.messages.map((m) => ({ stage: 'platform', check: 'tradingview-compile', severity: opts.compile!.ok ? 'info' : 'error', message: m }));
    stages.push({ ...stage('platform', 'TradingView compile (user-recorded)', ['tradingview-compile'], diags), status: opts.compile.ok ? 'pass' : 'fail', note: `Recorded ${opts.compile.at}.` });
  } else {
    stages.push({
      stage: 'platform',
      title: 'TradingView compile',
      status: 'not_run',
      checksRun: [],
      diagnostics: [],
      note: 'Not compiled by TradingView yet. TradingView has no public compile API: paste the script into the Pine Editor, then record the result here (OK or the error messages).',
    });
  }
  if (opts.backtest) {
    const d: Diagnostic[] = [];
    if (opts.backtest.trades < 30) d.push({ stage: 'backtest', check: 'sample-size', severity: 'warning', message: `Only ${opts.backtest.trades} trades — too few to draw conclusions (aim for 100+).` });
    if (!opts.backtest.hasCosts) d.push({ stage: 'backtest', check: 'costs', severity: 'warning', message: 'Backtest has no commission/slippage.' });
    if (opts.backtest.profitFactor !== null && opts.backtest.profitFactor > 3 && opts.backtest.trades < 100) d.push({ stage: 'backtest', check: 'overfitting', severity: 'warning', message: 'Profit factor > 3 on a small sample is a common overfitting signature.' });
    stages.push(stage('backtest', 'Backtest sanity', ['sample-size', 'costs', 'overfitting'], d));
  } else {
    stages.push({ stage: 'backtest', title: 'Backtest sanity', status: 'not_run', checksRun: [], diagnostics: [], note: 'No backtest imported. Export the List of Trades from the Strategy Tester and import it in Backtests.' });
  }
  const all = stages.flatMap((s) => s.diagnostics);
  return {
    generatedAt: new Date().toISOString(),
    stages,
    errorCount: all.filter((d) => d.severity === 'error').length,
    warningCount: all.filter((d) => d.severity === 'warning').length,
    compiled: opts.compile ? { at: opts.compile.at, ok: opts.compile.ok, source: 'user-recorded' } : false,
  };
}
