// Core domain types shared by the generator, validator, server and web UI.

export type ParamType = 'int' | 'float' | 'bool' | 'string' | 'source' | 'timeframe' | 'session' | 'color';
export type ParamValue = number | boolean | string;

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  tooltip?: string;
}

/**
 * Correlation family. Conditions (and whole strategies) in the same family
 * carry overlapping information, so scoring counts each family once.
 */
export type Family =
  | 'trend'
  | 'momentum'
  | 'meanrev'
  | 'volatility'
  | 'volume'
  | 'structure'
  | 'pattern';

export const FAMILIES: Family[] = ['trend', 'momentum', 'meanrev', 'volatility', 'volume', 'structure', 'pattern'];

export type ConditionRole = 'trigger' | 'filter' | 'confirmation' | 'exit';

export interface ConditionDef {
  id: string;
  label: string;
  role: ConditionRole;
  description: string;
  /** Pine bool expression for the long side. `$x` = component variable, `@x` = component input. Must not call ta.* (v6 lazy and/or). */
  long: string;
  short: string;
  family: Family;
  defaultWeight: number;
}

export type RepaintClass = 'none' | 'confirmation-delay' | 'htf-confirmed' | 'realtime-only';

export interface ComponentDoc {
  calculation: string;
  role: string;
  interpretation: string;
  limitations: string;
  repainting: string;
  repaintClass: RepaintClass;
  source: string;
}

export interface EmitContext {
  mode: 'strategy' | 'indicator';
  /** True when the component's own chart visuals should be emitted. */
  visuals: boolean;
}

export interface ComponentCode {
  calc: string[];
  plots?: string[];
  visuals?: string[];
  dashboard?: { label: string; value: string }[];
}

export interface ComponentDef {
  type: string;
  name: string;
  family: Family;
  summary: string;
  doc: ComponentDoc;
  params: ParamDef[];
  conditions: ConditionDef[];
  /** Helper function names this component needs (emitted once). */
  helpers?: string[];
  emit(ctx: EmitContext): ComponentCode;
  /** Pine float expressions for a structural stop level (`$`/`@` placeholders allowed). */
  structureStop?: { long: string; short: string };
}

export interface ComponentInstance {
  id: string; // unique instance id, also used as variable prefix
  type: string;
  params: Record<string, ParamValue>;
}

export interface ConditionRef {
  /** `<instanceId>.<conditionId>` */
  ref: string;
  role: ConditionRole;
  mandatory: boolean;
  weight: number;
  enabled: boolean;
}

export type ConfluenceMode = 'strict' | 'weighted' | 'hybrid';

export interface VoterSpec {
  id: string; // s1, s2...
  templateId?: string;
  name: string;
  family: Family;
  conditions: ConditionRef[];
  confluence: { mode: ConfluenceMode; minScore: number; confirmWindowBars: number; dedupeFamilies: boolean };
}

export interface ConsensusSpec {
  enabled: boolean;
  /** Bars a voter's signal stays "live" as a vote. */
  voteWindowBars: number;
  /** Percentage of voters (or families) needed for a standard consensus. */
  threshold: number;
  /** Percentage needed for a STRONG entry (100 = everyone agrees). */
  strongThreshold: number;
  /** Count agreement per correlation family instead of per voter. */
  perFamily: boolean;
  /** Strong signal requires no voter voting the opposite way. */
  vetoOnOpposite: boolean;
  tradeOn: 'strong' | 'standard';
}

export type StopMode = 'ATR' | 'Structure' | 'Percent' | 'Ticks';
export type SizingMode = 'Fixed quantity' | 'Fixed cash risk' | 'Percent of equity risk' | 'Percent of equity notional';

export interface RiskSpec {
  stopMode: StopMode;
  atrLength: number;
  atrMult: number;
  stopPercent: number;
  stopTicks: number;
  swingLookback: number;
  structureBufferAtr: number;
  maxStopAtr: number; // skip trades whose stop is wider than this many ATRs (0 = off)
  minRR: number; // minimum weighted-average reward:risk of the target plan
  tpCount: 1 | 2 | 3;
  tpR: [number, number, number];
  tpQtyPct: [number, number, number];
  breakeven: { enabled: boolean; triggerR: number; offsetTicks: number };
  trailing: { enabled: boolean; atrMult: number; activateR: number };
  sizing: { mode: SizingMode; value: number; maxQty: number; maxRiskPct: number; qtyStep: number };
  dailyLoss: { enabled: boolean; percent: number };
  maxConsecutiveLosses: number; // 0 = off
  timeExitBars: number; // 0 = off
  closeOnOpposite: boolean;
  cooldownBars: number;
}

export interface BacktestSpec {
  initialCapital: number;
  currency: string; // 'NONE' = symbol currency
  commissionType: 'percent' | 'cash_per_contract' | 'cash_per_order';
  commissionValue: number;
  slippageTicks: number;
  fillMode: 'next_open' | 'on_close';
  anchorToFill: boolean;
  barMagnifier: boolean;
  dateRange: { enabled: boolean; start: string; end: string };
}

export interface FilterSpec {
  direction: 'both' | 'long' | 'short';
  session: { enabled: boolean; session: string; timezone: string };
  blackout: { enabled: boolean; session: string; timezone: string };
}

export interface AlertSpec {
  setup: boolean;
  entry: boolean;
  exit: boolean;
  invalidation: boolean;
  json: boolean;
}

export interface VisualSpec {
  bullColor: string;
  bearColor: string;
  showLabels: boolean;
  showSetups: boolean;
  showLevels: boolean;
  showComponentVisuals: boolean;
  showDashboard: boolean;
  dashboardPosition: 'Top right' | 'Top left' | 'Bottom right' | 'Bottom left';
}

export interface StrategySpec {
  schemaVersion: 1;
  meta: { name: string; version: string; description: string; category: string; templateIds: string[] };
  market: {
    symbol: string;
    assetClass: 'forex' | 'crypto' | 'stocks' | 'futures' | 'indices' | 'commodities' | 'any';
    /** Chart timeframe the script is designed and tuned for. */
    timeframe: string;
    /** Designed range of chart timeframes (inclusive). */
    timeframeRange?: [string, string];
    /** How the timeframe was chosen (shown in the UI and script header). */
    timeframeNote?: string;
    /** What the generated script does on other chart timeframes. */
    timeframeGuard?: 'off' | 'warn' | 'block';
  };
  output: 'strategy' | 'indicator';
  components: ComponentInstance[];
  strategies: VoterSpec[];
  consensus: ConsensusSpec;
  risk: RiskSpec;
  backtest: BacktestSpec;
  filters: FilterSpec;
  alerts: AlertSpec;
  visuals: VisualSpec;
  notes: { assumptions: string[]; limitations: string[] };
}

export interface SourceRef {
  title: string;
  url?: string;
  note?: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  category: string;
  family: Family;
  summary: string;
  entryLogic: string;
  exitLogic: string;
  regime: string;
  markets: string;
  timeframes: string;
  /** Default chart timeframe for new specs (TradingView format). */
  chartTimeframe?: string;
  /** Range of chart timeframes the method is designed for (inclusive). */
  tfRange?: [string, string];
  strengths: string[];
  weaknesses: string[];
  failureModes: string[];
  evidence: string;
  testing: string;
  sources: SourceRef[];
  implementationNotes: string;
  components: ComponentInstance[];
  conditions: Omit<ConditionRef, 'enabled'>[];
  confluence?: Partial<VoterSpec['confluence']>;
  risk?: Partial<RiskSpec>;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  stage: 'spec' | 'static' | 'logic' | 'platform' | 'backtest';
  check: string;
  severity: Severity;
  message: string;
  line?: number;
}

export interface StageResult {
  stage: Diagnostic['stage'];
  title: string;
  status: 'pass' | 'warn' | 'fail' | 'not_run';
  checksRun: string[];
  diagnostics: Diagnostic[];
  note?: string;
}

export interface ValidationReport {
  generatedAt: string;
  stages: StageResult[];
  errorCount: number;
  warningCount: number;
  /** Never true unless a real TradingView compile result was recorded. */
  compiled: false | { at: string; ok: boolean; source: 'user-recorded' };
}
