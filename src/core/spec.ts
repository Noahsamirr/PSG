import { getComponent } from './components';
import { getTemplate } from './templates';
import { pickSharedTimeframe, rangeLabel, tfLabel, tfMinutes } from './timeframe';
import type {
  ComponentInstance,
  ConditionRef,
  ConsensusSpec,
  Family,
  ParamValue,
  RiskSpec,
  StrategySpec,
  TemplateDef,
  VoterSpec,
} from './types';

export const DEFAULT_RISK: RiskSpec = {
  stopMode: 'ATR',
  atrLength: 14,
  atrMult: 2,
  stopPercent: 1,
  stopTicks: 100,
  swingLookback: 10,
  structureBufferAtr: 0.2,
  maxStopAtr: 0,
  minRR: 1.5,
  tpCount: 3,
  tpR: [1, 2, 3],
  tpQtyPct: [33, 33, 34],
  breakeven: { enabled: false, triggerR: 1, offsetTicks: 0 },
  trailing: { enabled: false, atrMult: 2, activateR: 1.5 },
  sizing: { mode: 'Percent of equity risk', value: 1, maxQty: 1_000_000, maxRiskPct: 2, qtyStep: 0 },
  dailyLoss: { enabled: false, percent: 3 },
  maxConsecutiveLosses: 0,
  timeExitBars: 0,
  closeOnOpposite: false,
  cooldownBars: 0,
};

export const DEFAULT_CONSENSUS: ConsensusSpec = {
  enabled: false,
  voteWindowBars: 20,
  threshold: 60,
  strongThreshold: 100,
  perFamily: true,
  vetoOnOpposite: true,
  tradeOn: 'strong',
};

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function mergeRisk(base: RiskSpec, patch?: Partial<RiskSpec>): RiskSpec {
  const r = clone(base);
  if (!patch) return r;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      (r as any)[k] = { ...(r as any)[k], ...v };
    } else if (v !== undefined) {
      (r as any)[k] = clone(v);
    }
  }
  // Normalise the target allocation to the number of targets.
  if (patch.tpCount && !patch.tpQtyPct) {
    r.tpQtyPct = r.tpCount === 1 ? [100, 0, 0] : r.tpCount === 2 ? [50, 50, 0] : [33, 33, 34];
  }
  return r;
}

export function baseSpec(): StrategySpec {
  return {
    schemaVersion: 1,
    meta: { name: 'Untitled Strategy', version: '1.0.0', description: '', category: 'Custom', templateIds: [] },
    market: { symbol: '', assetClass: 'any', timeframe: '60', timeframeGuard: 'warn' },
    output: 'strategy',
    components: [],
    strategies: [],
    consensus: clone(DEFAULT_CONSENSUS),
    risk: clone(DEFAULT_RISK),
    backtest: {
      initialCapital: 10000,
      currency: 'USD',
      commissionType: 'percent',
      commissionValue: 0.05,
      slippageTicks: 2,
      fillMode: 'next_open',
      anchorToFill: true,
      barMagnifier: false,
      dateRange: { enabled: false, start: '2020-01-01', end: '2099-12-31' },
    },
    filters: {
      direction: 'both',
      session: { enabled: false, session: '0930-1600', timezone: 'America/New_York' },
      blackout: { enabled: false, session: '0825-0840', timezone: 'America/New_York' },
    },
    alerts: { setup: true, entry: true, exit: true, invalidation: true, json: true },
    visuals: {
      bullColor: '#26A69A',
      bearColor: '#EF5350',
      showLabels: true,
      showSetups: true,
      showLevels: true,
      showComponentVisuals: true,
      showDashboard: true,
      dashboardPosition: 'Top right',
    },
    notes: { assumptions: [], limitations: [] },
  };
}

function voterFromTemplate(t: TemplateDef, id: string, refMap: Record<string, string>): VoterSpec {
  return {
    id,
    templateId: t.id,
    name: t.name,
    family: t.family,
    conditions: t.conditions.map((c) => {
      const [inst, cond] = c.ref.split('.');
      return { ...c, ref: `${refMap[inst] ?? inst}.${cond}`, enabled: true };
    }),
    confluence: {
      mode: t.confluence?.mode ?? 'strict',
      minScore: t.confluence?.minScore ?? 60,
      confirmWindowBars: t.confluence?.confirmWindowBars ?? 0,
      dedupeFamilies: t.confluence?.dedupeFamilies ?? true,
    },
  };
}

function paramsKey(type: string, params: Record<string, ParamValue>): string {
  const def = getComponent(type);
  const full: Record<string, ParamValue> = {};
  for (const p of def.params) full[p.key] = params[p.key] ?? p.default;
  return type + JSON.stringify(full);
}

/**
 * Adds a template's components to `components`, re-using identical instances
 * and renaming clashing ids. Returns old-id → new-id mapping.
 */
export function mergeComponents(components: ComponentInstance[], incoming: ComponentInstance[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const inc of incoming) {
    const key = paramsKey(inc.type, inc.params);
    const same = components.find((c) => paramsKey(c.type, c.params) === key);
    if (same) {
      map[inc.id] = same.id;
      continue;
    }
    let id = inc.id;
    let n = 2;
    while (components.some((c) => c.id === id)) id = `${inc.id}${n++}`;
    components.push({ id, type: inc.type, params: clone(inc.params) });
    map[inc.id] = id;
  }
  return map;
}

export function specFromTemplate(templateId: string, overrides?: Partial<Pick<StrategySpec, 'output' | 'market'>>): StrategySpec {
  const t = getTemplate(templateId);
  const spec = baseSpec();
  spec.meta = { name: t.name, version: '1.0.0', description: t.summary, category: t.category, templateIds: [t.id] };
  const map = mergeComponents(spec.components, t.components);
  spec.strategies = [voterFromTemplate(t, 's1', map)];
  spec.risk = mergeRisk(DEFAULT_RISK, t.risk);
  if (t.id === 'vwap_pullback' || t.id === 'orb_breakout') spec.filters.session.enabled = true;
  spec.notes.limitations = [t.weaknesses.join('; '), `Evidence: ${t.evidence}`];
  if (t.chartTimeframe) spec.market.timeframe = t.chartTimeframe;
  if (t.tfRange) spec.market.timeframeRange = [...t.tfRange];
  spec.market.timeframeNote = `${t.name} is designed for ${t.tfRange ? rangeLabel(t.tfRange) : t.timeframes} charts; recommended ${tfLabel(spec.market.timeframe)}.`;
  if (overrides?.output) spec.output = overrides.output;
  if (overrides?.market) spec.market = { ...spec.market, ...overrides.market };
  ensureHigherTimeframes(spec);
  return spec;
}

export const CONSENSUS_PRESETS: { id: string; name: string; description: string; templates: string[]; consensus: Partial<ConsensusSpec> }[] = [
  {
    id: 'trend_consensus',
    name: 'Trend Consensus — Strong Entry',
    description: 'Seven independent trend/momentum/breakout strategies vote. A STRONG entry is marked on the first bar where every voter agrees (per family), with no voter opposing.',
    templates: ['ema_trend', 'macd_trend', 'supertrend_trend', 'mtf_pullback', 'squeeze_breakout', 'ichimoku_tk', 'donchian_turtle'],
    consensus: { threshold: 60, strongThreshold: 100, perFamily: true, voteWindowBars: 30 },
  },
  {
    id: 'reversal_consensus',
    name: 'Reversal Consensus — Strong Entry',
    description: 'Mean-reversion and level-based strategies vote; strong entry when all reversal families agree.',
    templates: ['rsi2_meanrev', 'bb_meanrev', 'sr_bounce', 'smc_sweep_fvg'],
    consensus: { threshold: 50, strongThreshold: 100, perFamily: true, voteWindowBars: 10 },
  },
  {
    id: 'all_market',
    name: 'Full Library Consensus',
    description: 'Every template votes. Trend and mean-reversion systems often disagree by design, so the default strong threshold is 80% of families.',
    templates: [
      'ema_trend', 'rsi2_meanrev', 'macd_trend', 'bb_meanrev', 'donchian_retest', 'donchian_turtle', 'vwap_pullback',
      'supertrend_trend', 'sr_bounce', 'mtf_pullback', 'smc_sweep_fvg', 'squeeze_breakout', 'ichimoku_tk', 'stoch_pullback',
    ],
    consensus: { threshold: 50, strongThreshold: 80, perFamily: true, voteWindowBars: 20 },
  },
];

export function consensusSpec(templateIds: string[], consensus?: Partial<ConsensusSpec>, name?: string): StrategySpec {
  if (templateIds.length < 2) throw new Error('A consensus needs at least two strategies');
  const spec = baseSpec();
  const templates = templateIds.map(getTemplate);
  spec.meta = {
    name: name ?? `Consensus: ${templates.length} strategies`,
    version: '1.0.0',
    description: `Multi-strategy consensus of ${templates.map((t) => t.name).join(', ')}. Strong entries require agreement across voters.`,
    category: 'Consensus',
    templateIds: [...templateIds],
  };
  templates.forEach((t, i) => {
    const map = mergeComponents(spec.components, t.components);
    spec.strategies.push(voterFromTemplate(t, `s${i + 1}`, map));
  });
  spec.consensus = { ...clone(DEFAULT_CONSENSUS), ...consensus, enabled: true };
  spec.risk = mergeRisk(DEFAULT_RISK, { stopMode: 'ATR', atrMult: 2, tpCount: 3, tpR: [1, 2, 3] });
  const tf = pickSharedTimeframe(templates.filter((t) => t.tfRange).map((t) => ({ name: t.name, range: t.tfRange!, preferred: t.chartTimeframe })));
  spec.market.timeframe = tf.timeframe;
  spec.market.timeframeRange = tf.range;
  spec.market.timeframeNote = tf.note;
  ensureHigherTimeframes(spec);
  spec.notes.limitations = [
    'Votes are counted from each strategy\'s own confirmed signals within the vote window; per-strategy exit rules are not used in consensus mode.',
    'More agreeing strategies does not mean a higher probability of profit — correlated strategies are grouped by family to limit double counting.',
  ];
  return spec;
}

export function consensusFromPreset(presetId: string): StrategySpec {
  const p = CONSENSUS_PRESETS.find((x) => x.id === presetId);
  if (!p) throw new Error(`Unknown consensus preset "${presetId}"`);
  return consensusSpec(p.templates, p.consensus, p.name);
}

/** Add a component (if missing) and a condition to a voter. Used by the NL builder and the UI. */
export function addCondition(spec: StrategySpec, voterId: string, inst: ComponentInstance, condId: string, patch?: Partial<ConditionRef>): string {
  const map = mergeComponents(spec.components, [inst]);
  const ref = `${map[inst.id]}.${condId}`;
  const voter = spec.strategies.find((v) => v.id === voterId);
  if (!voter) throw new Error(`No strategy ${voterId}`);
  const def = getComponent(inst.type).conditions.find((c) => c.id === condId);
  if (!def) throw new Error(`Component ${inst.type} has no condition ${condId}`);
  if (!voter.conditions.some((c) => c.ref === ref)) {
    voter.conditions.push({ ref, role: def.role, mandatory: def.role !== 'confirmation', weight: def.defaultWeight, enabled: true, ...patch });
  }
  return ref;
}

const TF_LADDER = ['1', '5', '15', '60', '240', '1D', '1W', '1M'];
const TF_MIN: Record<string, number> = { '1': 1, '5': 5, '15': 15, '60': 60, '240': 240, '1D': 1440, '1W': 10080, '1M': 43200 };


/** Raises any higher-timeframe filter that is not above the chart timeframe (≈4× when possible). */
export function ensureHigherTimeframes(spec: StrategySpec): string[] {
  const chart = tfMinutes(spec.market.timeframe);
  if (chart === null) return [];
  const log: string[] = [];
  for (const c of spec.components.filter((x) => x.type === 'htf')) {
    const cur = tfMinutes(String(c.params.tf ?? '240'));
    if (cur !== null && cur > chart) continue;
    const next = TF_LADDER.find((t) => TF_MIN[t] >= chart * 4) ?? TF_LADDER.find((t) => TF_MIN[t] > chart) ?? '1M';
    log.push(`Higher-timeframe filter "${c.id}" raised from ${c.params.tf ?? '240'} to ${next} (must be above the ${spec.market.timeframe} chart).`);
    c.params.tf = next;
  }
  return log;
}

export function resolvedParams(inst: ComponentInstance): Record<string, ParamValue> {
  const def = getComponent(inst.type);
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) out[p.key] = inst.params[p.key] ?? p.default;
  return out;
}

export function familyOfVoters(spec: StrategySpec): Family[] {
  return [...new Set(spec.strategies.map((s) => s.family))];
}
