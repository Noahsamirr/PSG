// Stage 1 — specification validation: completeness, contradictions, parameter ranges, risk plan.
import { getComponent, hasComponent } from '../components';
import type { Diagnostic, StrategySpec } from '../types';
import { rangeLabel, tfInRange, tfLabel } from '../timeframe';

export const SPEC_CHECKS = [
  'meta-complete',
  'timeframe-defined',
  'components-known',
  'parameter-ranges',
  'condition-references',
  'trigger-per-strategy',
  'contradictory-conditions',
  'correlated-conditions',
  'timeframe-consistency',
  'risk-plan',
  'position-sizing',
  'session-format',
  'consensus-config',
  'data-suitability',
  'backtest-costs',
];

/** Pairs of conditions that cannot both be required. */
const CONTRADICTIONS: [string, string][] = [
  ['adx.trending', 'adx.ranging'],
  ['macd.zoneValue', 'macd.aboveZero'],
  ['bb.reentry', 'bb.breakout'],
];

export function tfToMinutes(tf: string): number | null {
  const t = tf.trim().toUpperCase();
  const m = /^(\d*)([SDWM]?)$/.exec(t);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  switch (m[2]) {
    case '':
      return n;
    case 'S':
      return n / 60;
    case 'D':
      return n * 1440;
    case 'W':
      return n * 10080;
    case 'M':
      return n * 43200;
  }
  return null;
}

export function plannedRR(spec: StrategySpec): number {
  const r = spec.risk;
  const p1 = r.tpCount === 1 ? 1 : r.tpQtyPct[0] / 100;
  if (r.tpCount === 1) return r.tpR[0];
  if (r.tpCount === 2) return p1 * r.tpR[0] + (1 - p1) * r.tpR[1];
  const p2 = Math.min(r.tpQtyPct[1] / 100, 1 - p1);
  return p1 * r.tpR[0] + p2 * r.tpR[1] + (1 - p1 - p2) * r.tpR[2];
}

const SESSION_RE = /^\d{4}-\d{4}(:[1-7]+)?$/;

export function validateSpec(spec: StrategySpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (check: string, severity: Diagnostic['severity'], message: string) => out.push({ stage: 'spec', check, severity, message });

  if (!spec.meta.name.trim()) add('meta-complete', 'error', 'Strategy name is required.');
  if (!/^\d+\.\d+\.\d+$/.test(spec.meta.version)) add('meta-complete', 'warning', `Version "${spec.meta.version}" is not semantic (x.y.z).`);
  if (!spec.market.timeframe) add('timeframe-consistency', 'error', 'Chart timeframe is not set — choose the timeframe the strategy is designed for.');
  else if (tfToMinutes(spec.market.timeframe) === null) add('timeframe-consistency', 'error', `"${spec.market.timeframe}" is not a TradingView timeframe (use 1, 5, 15, 60, 240, 1D, 1W…).`);
  else if (spec.market.timeframeRange && tfInRange(spec.market.timeframe, spec.market.timeframeRange) === false)
    add('timeframe-consistency', 'warning', `Chart timeframe ${tfLabel(spec.market.timeframe)} is outside the designed range ${rangeLabel(spec.market.timeframeRange)}. Parameters were chosen for that range; re-test or pick a timeframe inside it.`);
  else add('timeframe-consistency', 'info', `Designed for ${spec.market.timeframeRange ? rangeLabel(spec.market.timeframeRange) : tfLabel(spec.market.timeframe)} charts; set your TradingView chart to ${tfLabel(spec.market.timeframe)}.`);
  if (!spec.market.symbol) add('meta-complete', 'info', 'No instrument set — the script works on any chart, but contract assumptions are unchecked.');

  // Components
  const ids = new Set<string>();
  for (const c of spec.components) {
    if (ids.has(c.id)) add('components-known', 'error', `Duplicate component id "${c.id}".`);
    ids.add(c.id);
    if (!/^[A-Za-z_]\w*$/.test(c.id)) add('components-known', 'error', `Component id "${c.id}" is not a valid Pine identifier.`);
    if (!hasComponent(c.type)) {
      add('components-known', 'error', `Unknown component type "${c.type}".`);
      continue;
    }
    for (const p of getComponent(c.type).params) {
      const v = c.params[p.key];
      if (v === undefined) continue;
      if ((p.type === 'int' || p.type === 'float') && typeof v === 'number') {
        if (p.min !== undefined && v < p.min) add('parameter-ranges', 'error', `${c.id}.${p.key} = ${v} is below the minimum ${p.min}.`);
        if (p.max !== undefined && v > p.max) add('parameter-ranges', 'error', `${c.id}.${p.key} = ${v} is above the maximum ${p.max}.`);
        if (p.type === 'int' && !Number.isInteger(v)) add('parameter-ranges', 'error', `${c.id}.${p.key} must be an integer.`);
      } else if ((p.type === 'int' || p.type === 'float') && typeof v !== 'number') add('parameter-ranges', 'error', `${c.id}.${p.key} must be a number.`);
      if (p.options && !p.options.includes(String(v))) add('parameter-ranges', 'error', `${c.id}.${p.key} = "${v}" is not one of ${p.options.join(', ')}.`);
      if (p.type === 'session' && !SESSION_RE.test(String(v))) add('session-format', 'error', `${c.id}.${p.key} "${v}" is not a valid session (HHMM-HHMM).`);
    }
    if (c.type === 'ema' && Number(c.params.fastLen ?? 9) >= Number(c.params.slowLen ?? 21)) add('parameter-ranges', 'warning', `${c.id}: fast length should be shorter than slow length.`);
    if (c.type === 'macd' && Number(c.params.fast ?? 12) >= Number(c.params.slow ?? 26)) add('parameter-ranges', 'warning', `${c.id}: MACD fast length should be shorter than slow length.`);
    if (c.type === 'rsi' && Number(c.params.os ?? 30) >= Number(c.params.ob ?? 70)) add('parameter-ranges', 'error', `${c.id}: oversold must be below overbought.`);
    if (c.type === 'htf') {
      const chart = tfToMinutes(spec.market.timeframe);
      const htf = tfToMinutes(String(c.params.tf ?? '240'));
      if (chart !== null && htf !== null && htf <= chart) add('timeframe-consistency', 'error', `${c.id}: higher timeframe (${c.params.tf ?? '240'}) must be higher than the chart timeframe (${spec.market.timeframe}).`);
    }
  }

  // Strategies / conditions
  if (!spec.strategies.length) add('trigger-per-strategy', 'error', 'At least one strategy (voter) is required.');
  const used = new Set<string>();
  for (const v of spec.strategies) {
    const enabled = v.conditions.filter((c) => c.enabled);
    for (const c of enabled) {
      const [inst, cond] = c.ref.split('.');
      const comp = spec.components.find((x) => x.id === inst);
      used.add(inst);
      if (!comp) {
        add('condition-references', 'error', `${v.name}: condition "${c.ref}" references a missing component.`);
        continue;
      }
      if (hasComponent(comp.type) && !getComponent(comp.type).conditions.some((x) => x.id === cond)) add('condition-references', 'error', `${v.name}: component ${comp.type} has no condition "${cond}".`);
      if (c.weight < 0) add('condition-references', 'error', `${v.name}: weight of ${c.ref} is negative.`);
    }
    if (!enabled.some((c) => c.role === 'trigger')) add('trigger-per-strategy', 'error', `${v.name}: no enabled entry trigger — the strategy can never signal.`);
    const typeKey = (ref: string) => `${spec.components.find((x) => x.id === ref.split('.')[0])?.type}.${ref.split('.')[1]}`;
    for (const [a, b] of CONTRADICTIONS) {
      const ma = enabled.find((c) => c.role !== 'exit' && typeKey(c.ref) === a);
      const mb = enabled.find((c) => c.role !== 'exit' && typeKey(c.ref) === b);
      if (ma && mb) {
        const strictBoth = v.confluence.mode === 'strict' || (ma.mandatory && mb.mandatory);
        add('contradictory-conditions', strictBoth ? 'error' : 'warning', `${v.name}: "${ma.ref}" and "${mb.ref}" contradict each other${strictBoth ? ' and are both required — no signal can ever qualify' : ''}.`);
      }
    }
    // Correlated (same-family) scored conditions
    const scored = enabled.filter((c) => c.role === 'filter' || c.role === 'confirmation');
    const fam = new Map<string, string[]>();
    for (const c of scored) {
      const comp = spec.components.find((x) => x.id === c.ref.split('.')[0]);
      if (!comp || !hasComponent(comp.type)) continue;
      const def = getComponent(comp.type).conditions.find((x) => x.id === c.ref.split('.')[1]);
      if (!def) continue;
      fam.set(def.family, [...(fam.get(def.family) ?? []), c.ref]);
    }
    for (const [f, list] of fam) {
      if (list.length > 1 && v.confluence.mode !== 'strict') {
        add('correlated-conditions', v.confluence.dedupeFamilies ? 'info' : 'warning', `${v.name}: ${list.length} "${f}" conditions (${list.join(', ')}) carry overlapping information${v.confluence.dedupeFamilies ? ' — family de-duplication counts them once' : ' and will be double-counted in the score'}.`);
      }
    }
    if (v.confluence.mode !== 'strict' && (v.confluence.minScore < 0 || v.confluence.minScore > 100)) add('contradictory-conditions', 'error', `${v.name}: minimum score must be 0–100.`);
  }
  for (const c of spec.components) if (!used.has(c.id)) add('condition-references', 'info', `Component "${c.id}" is calculated and plotted but no rule uses it.`);

  // Risk
  const r = spec.risk;
  const rr = plannedRR(spec);
  if (r.tpR.slice(0, r.tpCount).some((x, i, a) => i > 0 && x <= a[i - 1])) add('risk-plan', 'error', 'Take-profit R multiples must increase (TP1 < TP2 < TP3).');
  if (r.tpCount >= 2) {
    const alloc = r.tpQtyPct.slice(0, r.tpCount - 1).reduce((a, b) => a + b, 0);
    if (alloc >= 100) add('risk-plan', 'error', 'Partial exits before the final target close 100% or more — nothing is left for the final target.');
  }
  if (rr < r.minRR) add('risk-plan', 'error', `Planned weighted reward:risk ${rr.toFixed(2)} is below the minimum ${r.minRR} — the script will refuse all entries.`);
  else add('risk-plan', 'info', `Planned weighted reward:risk = ${rr.toFixed(2)} (minimum ${r.minRR}).`);
  if (r.stopMode === 'ATR' && r.atrMult <= 0) add('risk-plan', 'error', 'ATR stop multiplier must be > 0.');
  if (r.stopMode === 'Structure') {
    const trigTypes = spec.strategies.flatMap((v) => v.conditions.filter((c) => c.enabled && c.role === 'trigger').map((c) => spec.components.find((x) => x.id === c.ref.split('.')[0])?.type));
    if (!trigTypes.some((t) => t && hasComponent(t) && getComponent(t).structureStop)) add('risk-plan', 'info', `Structure stop: no trigger component defines a structural level, so the lowest low / highest high of the last ${r.swingLookback} bars is used.`);
  }
  if (r.breakeven.enabled && r.breakeven.triggerR <= 0) add('risk-plan', 'error', 'Breakeven trigger must be > 0 R.');
  if (r.trailing.enabled && r.trailing.atrMult <= 0) add('risk-plan', 'error', 'Trailing ATR multiple must be > 0.');
  if (r.sizing.value <= 0) add('position-sizing', 'error', 'Sizing value must be > 0.');
  if (r.sizing.mode === 'Percent of equity risk' && r.sizing.value > 5) add('position-sizing', 'warning', `Risking ${r.sizing.value}% of equity per trade is aggressive; a losing streak of 10 trades would cost ~${(100 * (1 - Math.pow(1 - r.sizing.value / 100, 10))).toFixed(0)}%.`);
  if (r.sizing.maxRiskPct > 0 && r.sizing.mode === 'Percent of equity risk' && r.sizing.value > r.sizing.maxRiskPct) add('position-sizing', 'warning', `Sizing risk ${r.sizing.value}% exceeds the max-risk cap ${r.sizing.maxRiskPct}% — the cap will reduce size.`);
  if (spec.market.assetClass === 'futures' && r.sizing.mode !== 'Fixed quantity') add('position-sizing', 'info', 'Futures: size is computed from syminfo.pointvalue and rounded to whole contracts; small accounts may round to 0.');

  // Filters / sessions
  for (const [name, s] of [['session', spec.filters.session], ['blackout', spec.filters.blackout]] as const) {
    if (s.enabled && !SESSION_RE.test(s.session)) add('session-format', 'error', `The ${name} "${s.session}" is not a valid session string (HHMM-HHMM).`);
  }
  if (spec.backtest.dateRange.enabled && spec.backtest.dateRange.start >= spec.backtest.dateRange.end) add('session-format', 'error', 'Backtest start date must be before end date.');

  // Consensus
  const cs = spec.consensus;
  if (cs.enabled) {
    if (spec.strategies.length < 2) add('consensus-config', 'error', 'Consensus mode needs at least two strategies.');
    if (cs.strongThreshold < cs.threshold) add('consensus-config', 'error', 'STRONG agreement threshold must be ≥ the standard threshold.');
    const fams = new Set(spec.strategies.map((s) => s.family));
    if (fams.has('trend') && fams.has('meanrev') && cs.strongThreshold >= 100) add('consensus-config', 'warning', 'Trend-following and mean-reversion voters usually disagree by design; a 100% STRONG threshold may rarely or never trigger.');
    if (cs.voteWindowBars === 0) add('consensus-config', 'info', 'Votes never expire (window 0): each strategy votes with its most recent signal however old.');
  } else if (spec.strategies.length > 1) add('consensus-config', 'warning', 'Several strategies are defined but consensus is off — only the first is generated.');

  // Data suitability
  const types = new Set(spec.components.map((c) => c.type));
  if ((types.has('vwap') || types.has('vol')) && spec.market.assetClass === 'forex') add('data-suitability', 'warning', 'Spot FX on TradingView usually reports tick volume; VWAP/volume rules are activity proxies only.');
  const tfMin = tfToMinutes(spec.market.timeframe);
  if ((types.has('orb') || (types.has('vwap') && spec.components.find((c) => c.type === 'vwap')?.params.anchor !== 'Month')) && tfMin !== null && tfMin >= 1440) add('data-suitability', 'warning', 'Opening-range / session-VWAP logic is intraday; it is not meaningful on daily or higher charts.');
  if (types.has('orb') && tfMin !== null && tfMin >= 30) add('data-suitability', 'warning', 'Chart timeframe should be smaller than the opening-range duration.');

  // Costs
  if (spec.output === 'strategy') {
    if (spec.backtest.commissionValue <= 0) add('backtest-costs', 'warning', 'Commission is 0 — backtest results will be optimistic.');
    if (spec.backtest.slippageTicks <= 0) add('backtest-costs', 'warning', 'Slippage is 0 ticks — backtest results will be optimistic.');
    if (spec.backtest.fillMode === 'on_close') add('backtest-costs', 'warning', 'Orders fill on the signal bar close (process_orders_on_close). This is optimistic for live trading where the order reaches the market after the close.');
  }
  return out;
}
