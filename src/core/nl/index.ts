// Natural language → Intent → StrategySpec.
// The rule-based parser runs offline; an LLM adapter may produce the same Intent shape instead.
// Generated Pine code always comes from the vetted component library, never from free text.
import { getComponent, hasComponent } from '../components';
import { addCondition, consensusSpec, CONSENSUS_PRESETS, ensureHigherTimeframes, specFromTemplate } from '../spec';
import { hasTemplate, TEMPLATES } from '../templates';
import type { ConditionRole, ParamValue, StopMode, StrategySpec } from '../types';
import { rangeLabel, tfInRange, tfLabel } from '../timeframe';

export interface IntentAddition {
  type: string;
  params?: Record<string, ParamValue>;
  conditions: { id: string; role?: ConditionRole; mandatory?: boolean; weight?: number }[];
}

export interface Intent {
  name?: string;
  symbol?: string;
  assetClass?: StrategySpec['market']['assetClass'];
  timeframe?: string;
  output?: 'strategy' | 'indicator';
  templates: string[];
  consensus?: boolean;
  consensusPreset?: string;
  add: IntentAddition[];
  risk: {
    stopMode?: StopMode;
    atrMult?: number;
    minRR?: number;
    tpCount?: 1 | 2 | 3;
    riskPct?: number;
    breakeven?: boolean;
    trailing?: boolean;
  };
  direction?: 'both' | 'long' | 'short';
  session?: { session: string; timezone: string };
  htfTimeframe?: string;
  matched: string[];
  notes: string[];
}

interface Rule {
  re: RegExp;
  label: string;
  apply: (i: Intent, m: RegExpMatchArray, text: string) => void;
}

const addCond = (i: Intent, type: string, id: string, params?: Record<string, ParamValue>, role?: ConditionRole, mandatory?: boolean) => {
  let a = i.add.find((x) => x.type === type && JSON.stringify(x.params ?? {}) === JSON.stringify(params ?? {}));
  if (!a) i.add.push((a = { type, params, conditions: [] }));
  if (!a.conditions.some((c) => c.id === id)) a.conditions.push({ id, role, mandatory });
};
const tpl = (i: Intent, id: string) => {
  if (!i.templates.includes(id)) i.templates.push(id);
};

const NOT_SYMBOLS = new Set(
  'RSI EMA SMA WMA ATR BOS FVG MACD ADX VWAP SMC ICT CHOCH TP SL RR HTF LTF MTF OB ORB TTM DMI USD PINE AND THE FOR WITH BUY SELL LONG SHORT TP1 TP2 TP3 API JSON NY UK EU KC BB TF R'.split(' '),
);

function inferAsset(sym: string): Intent['assetClass'] {
  const s = sym.toUpperCase().replace(/^[A-Z]+:/, '');
  if (/^(XAU|XAG|XPT|XPD|USOIL|UKOIL|WTI|BRENT)/.test(s)) return 'commodities';
  if (/(USDT|USDC|BUSD)$/.test(s) || /^(BTC|ETH|SOL|XRP|ADA|DOGE|BNB|LTC|AVAX|DOT|LINK)/.test(s)) return 'crypto';
  if (/1!$|^(ES|NQ|YM|RTY|CL|GC|SI|ZB|ZN|6E|MES|MNQ)\d*!?$/.test(s)) return 'futures';
  if (/^(US30|NAS100|SPX500|US500|GER40|DE40|UK100|JP225|HK50|SPX|NDX|DJI)$/.test(s)) return 'indices';
  if (/^(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)$/.test(s)) return 'forex';
  return 'stocks';
}

const RULES: Rule[] = [
  // Output type
  { re: /\bindicator\b/i, label: 'indicator output', apply: (i, _m, t) => { if (!/\bstrateg(y|ies)\b.*\b(orders?|backtest|tester)\b/i.test(t) && !/\bpine script v6 strategy\b/i.test(t)) i.output = 'indicator'; } },
  { re: /\b(backtest|strategy tester|strategy\(\)|pine script v6 strategy)\b/i, label: 'strategy output', apply: (i) => (i.output = 'strategy') },
  // SMC / ICT
  { re: /\b(liquidity sweeps?|stop hunts?|sweeps? of (highs|lows|liquidity))\b/i, label: 'liquidity sweep', apply: (i) => tpl(i, 'smc_sweep_fvg') },
  { re: /\b(fvg|fair value gaps?|imbalance)\b/i, label: 'fair value gap', apply: (i) => tpl(i, 'smc_sweep_fvg') },
  { re: /\b(bos|break of structure|choch|change of character|market structure shift|mss)\b/i, label: 'structure break', apply: (i) => { if (!i.templates.includes('smc_sweep_fvg')) addCond(i, 'smc', 'shift', undefined, 'trigger'); } },
  { re: /\border ?blocks?\b|\bbreaker\b/i, label: 'order block', apply: (i) => addCond(i, 'smc', 'inOb', undefined, 'confirmation', false) },
  { re: /\bpremium\b|\bdiscount\b/i, label: 'premium/discount', apply: (i) => addCond(i, 'smc', 'discount', undefined, 'filter', true) },
  { re: /\b(smc|smart money|ict|inner circle)\b/i, label: 'SMC/ICT', apply: (i) => tpl(i, 'smc_sweep_fvg') },
  // Moving averages
  { re: /\b(ema|sma|moving average)s?\s+(cross(over)?|crossing)\b|\bgolden cross\b|\bdeath cross\b/i, label: 'MA cross', apply: (i) => tpl(i, 'ema_trend') },
  { re: /\b(\d{2,3})\s*(ema|sma)\b|\b(ema|sma)\s*\(?\s*(\d{2,3})\)?/i, label: 'MA length', apply: (i, m) => { const len = Number(m[1] ?? m[4]); if (len >= 100) addCond(i, 'trend', 'side', { len, maType: (m[2] ?? m[3]).toUpperCase() }, 'filter', true); } },
  { re: /\b(ema|sma|moving average)\s+(trend\s+)?filter\b|\btrend filter\b/i, label: 'trend filter', apply: (i) => { if (!i.add.some((a) => a.type === 'trend')) addCond(i, 'trend', 'side', { len: 200, maType: 'EMA' }, 'filter', true); } },
  // Oscillators
  { re: /\brsi\s*\(?\s*2\s*\)?|\bconnors\b/i, label: 'RSI(2)', apply: (i) => tpl(i, 'rsi2_meanrev') },
  { re: /\brsi\b[^.]*\b(oversold|overbought|reversal|mean reversion|divergence)\b|\b(oversold|overbought)\b[^.]*\brsi\b/i, label: 'RSI reversal', apply: (i) => { if (i.templates.some((t) => t === 'rsi2_meanrev' || t === 'bb_meanrev')) return; if (!i.templates.length) addCond(i, 'rsi', 'reversal', undefined, 'trigger'); else addCond(i, 'rsi', 'notExtreme', undefined, 'filter', true); } },
  { re: /\brsi\b\s*(confirmation|confirm|filter|momentum|above 50|> ?50)/i, label: 'RSI confirmation', apply: (i) => addCond(i, 'rsi', 'momentum', undefined, 'confirmation', true) },
  { re: /\bmacd\b/i, label: 'MACD', apply: (i, _m, t) => { if (/macd\s*(confirmation|filter|confirm)/i.test(t)) addCond(i, 'macd', 'hist', undefined, 'confirmation', false); else tpl(i, 'macd_trend'); } },
  { re: /\bstoch(astic)?\b/i, label: 'Stochastic', apply: (i) => tpl(i, 'stoch_pullback') },
  { re: /\badx\b|\btrend strength\b/i, label: 'ADX', apply: (i) => addCond(i, 'adx', 'trending', undefined, 'filter', true) },
  // Volatility / bands
  { re: /\b(ttm|squeeze)\b/i, label: 'volatility squeeze', apply: (i) => tpl(i, 'squeeze_breakout') },
  { re: /\bbollinger\b/i, label: 'Bollinger Bands', apply: (i) => { if (!i.templates.includes('squeeze_breakout')) tpl(i, 'bb_meanrev'); } },
  { re: /\bsupertrend\b|\bsuper trend\b|\but ?bot\b|\batr trend\b/i, label: 'Supertrend', apply: (i) => tpl(i, 'supertrend_trend') },
  { re: /\bichimoku\b|\bkumo\b|\btenkan\b/i, label: 'Ichimoku', apply: (i) => tpl(i, 'ichimoku_tk') },
  // Structure / breakout
  { re: /\bbreak(out)?\s*(and|&|\+)\s*retest\b|\bretest\b/i, label: 'breakout & retest', apply: (i) => tpl(i, 'donchian_retest') },
  { re: /\bturtle\b|\bdonchian\b|\bchannel breakout\b/i, label: 'channel breakout', apply: (i) => tpl(i, 'donchian_turtle') },
  { re: /\bsupport\b.*\bresistance\b|\bs\/r\b|\bpivot (levels?|points?)\b/i, label: 'support/resistance', apply: (i) => tpl(i, 'sr_bounce') },
  { re: /\bopening range\b|\borb\b/i, label: 'opening range breakout', apply: (i) => tpl(i, 'orb_breakout') },
  { re: /\bvwap\b/i, label: 'VWAP', apply: (i) => { if (!i.templates.length) tpl(i, 'vwap_pullback'); else addCond(i, 'vwap', 'side', undefined, 'filter', true); } },
  { re: /\b(multi[- ]?time ?frame|mtf|higher time ?frame|htf)\b/i, label: 'multi-timeframe', apply: (i) => { if (!i.templates.length) tpl(i, 'mtf_pullback'); } },
  { re: /\b(volume (spike|confirmation|filter)|relative volume|rvol|high volume)\b/i, label: 'volume confirmation', apply: (i) => addCond(i, 'vol', 'spike', undefined, 'confirmation', false) },
  { re: /\b(engulfing|pin ?bars?|hammer|shooting star|candlestick patterns?|price action)\b/i, label: 'candlestick confirmation', apply: (i) => addCond(i, 'candle', 'any', undefined, 'confirmation', false) },
  // Consensus
  { re: /\b(consensus|all (the )?strateg(y|ies) (must )?agree|strategies agree|strong entry|agreement|vote)\b/i, label: 'multi-strategy consensus', apply: (i) => (i.consensus = true) },
  { re: /\b(all|every)\s+(available\s+)?strateg(y|ies)\b|\bfull library\b/i, label: 'all strategies', apply: (i) => { i.consensus = true; i.consensusPreset = 'all_market'; } },
  { re: /\b(reversal|mean[- ]reversion) consensus\b/i, label: 'reversal consensus', apply: (i) => { i.consensus = true; i.consensusPreset = 'reversal_consensus'; } },
  { re: /\btrend consensus\b/i, label: 'trend consensus', apply: (i) => { i.consensus = true; i.consensusPreset = 'trend_consensus'; } },
  // Risk
  { re: /\b(\d+(?:\.\d+)?)\s*(?:x|×)?\s*atr\b|\batr\s*(?:x|×)\s*(\d+(?:\.\d+)?)/i, label: 'ATR multiple', apply: (i, m) => { i.risk.stopMode = 'ATR'; i.risk.atrMult = Number(m[1] ?? m[2]); } },
  { re: /\batr[- ]?(based)?\s*(stop|sl|stop[- ]loss)\b/i, label: 'ATR stop', apply: (i) => (i.risk.stopMode = 'ATR') },
  { re: /\b(structure|structural|swing)[- ]?(based)?\s*(stop|sl|stop[- ]loss)\b|\bstop (below|above) the (sweep|swing|structure)\b/i, label: 'structure stop', apply: (i) => (i.risk.stopMode = 'Structure') },
  { re: /\b(\d+(?:\.\d+)?)\s*%\s*(stop|sl)\b/i, label: 'percent stop', apply: (i) => (i.risk.stopMode = 'Percent') },
  { re: /\b1\s*:\s*(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*r\b(?![a-z])|\brr\s*(?:of|=)?\s*(\d+(?:\.\d+)?)/i, label: 'reward:risk', apply: (i, m) => { const v = Number(m[1] ?? m[2] ?? m[3]); if (v > 0 && v <= 20) i.risk.minRR = v; } },
  { re: /\b(three|3)\s*(take[- ]?profits?|tps?|targets?)\b|\btp1\b.*\btp2\b.*\btp3\b/i, label: '3 targets', apply: (i) => (i.risk.tpCount = 3) },
  { re: /\b(two|2)\s*(take[- ]?profits?|tps?|targets?)\b/i, label: '2 targets', apply: (i) => (i.risk.tpCount = 2) },
  { re: /\b(single|one|1)\s*(take[- ]?profit|tp|target)\b/i, label: '1 target', apply: (i) => (i.risk.tpCount = 1) },
  { re: /\brisk(ing)?\s*(\d+(?:\.\d+)?)\s*%|\b(\d+(?:\.\d+)?)\s*%\s*(risk|of equity)/i, label: 'risk per trade', apply: (i, m) => (i.risk.riskPct = Number(m[2] ?? m[3])) },
  { re: /\bbreak[- ]?even\b|\bbe\b stop/i, label: 'breakeven', apply: (i) => (i.risk.breakeven = true) },
  { re: /\btrail(ing)?\s*(stop|sl)?\b/i, label: 'trailing stop', apply: (i) => (i.risk.trailing = true) },
  { re: /\blong[- ]only\b|\bonly (long|buy)s?\b/i, label: 'long only', apply: (i) => (i.direction = 'long') },
  { re: /\bshort[- ]only\b|\bonly (short|sell)s?\b/i, label: 'short only', apply: (i) => (i.direction = 'short') },
  // Sessions
  { re: /\blondon\b/i, label: 'London session', apply: (i) => (i.session = { session: '0800-1630', timezone: 'Europe/London' }) },
  { re: /\b(new york|ny)\s*(session|open)?\b/i, label: 'New York session', apply: (i) => (i.session = { session: '0930-1600', timezone: 'America/New_York' }) },
  { re: /\b(asian?|tokyo)\s*session\b/i, label: 'Asian session', apply: (i) => (i.session = { session: '0900-1500', timezone: 'Asia/Tokyo' }) },
];

export function parsePrompt(text: string): Intent {
  const intent: Intent = { templates: [], add: [], risk: {}, matched: [], notes: [] };
  // Symbol
  const symCandidates = [...text.matchAll(/\b([A-Z]{1,8}:)?([A-Z][A-Z0-9]{1,9}!?)\b/g)].map((m) => m[2]).filter((s) => !NOT_SYMBOLS.has(s) && /[A-Z]{2,}/.test(s) && !/^V\d$/.test(s));
  const known = symCandidates.find((s) => /^(XAU|XAG|BTC|ETH|EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY|US30|NAS100|SPX|NDX|ES|NQ|CL|GC)/.test(s)) ?? symCandidates.find((s) => s.length >= 3 && s.length <= 10);
  if (known) {
    intent.symbol = known;
    intent.assetClass = inferAsset(known);
    intent.matched.push(`instrument ${known} (${intent.assetClass})`);
  }
  // Timeframe
  const tf =
    /\b(\d{1,3})\s*-?\s*(m|min|mins|minute|minutes)\b/i.exec(text) ??
    /\bm(\d{1,3})\b/i.exec(text);
  const tfh = /\b(\d{1,2})\s*-?\s*(h|hr|hrs|hour|hours)\b/i.exec(text) ?? /\bh(\d{1,2})\b/i.exec(text);
  if (/\b(daily|1d|d1|day chart)\b/i.test(text)) intent.timeframe = '1D';
  else if (/\b(weekly|1w)\b/i.test(text)) intent.timeframe = '1W';
  else if (tfh) intent.timeframe = String(Number(tfh[1]) * 60);
  else if (tf) intent.timeframe = String(Number(tf[1]));
  if (intent.timeframe) intent.matched.push(`timeframe ${intent.timeframe}`);
  // HTF hint ("4h bias", "1h trend")
  const htf = /\b(\d{1,2})\s*h(our)?\s*(trend|bias|structure|direction)\b|\b(daily|weekly)\s*(trend|bias)\b/i.exec(text);

  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) {
      r.apply(intent, m, text);
      intent.matched.push(r.label);
    }
  }
  if (htf) {
    const tfv = htf[4] ? (htf[4].toLowerCase() === 'daily' ? '1D' : '1W') : String(Number(htf[1]) * 60);
    if (!intent.templates.includes('mtf_pullback') && !intent.templates.includes('smc_sweep_fvg')) addCond(intent, 'htf', 'bias', { tf: tfv }, 'filter', true);
    intent.add.forEach((a) => a.type === 'htf' && (a.params = { ...a.params, tf: tfv }));
    intent.notes.push(`Higher-timeframe bias set to ${tfv}.`);
    intent.htfTimeframe = tfv;
  }
  const words = text.replace(/[^\w\s/-]/g, ' ').trim();
  intent.name = intent.templates.length ? undefined : words.split(/\s+/).slice(0, 5).join(' ');
  return intent;
}

function tpPlan(minRR: number, count: 1 | 2 | 3): [number, number, number] {
  const r = (x: number) => Math.round(x * 10) / 10;
  if (count === 1) return [r(minRR), r(minRR * 1.5), r(minRR * 2)];
  if (count === 2) return [r(minRR * 0.75), r(minRR * 1.25), r(minRR * 2)];
  return [r(minRR * 0.5), r(minRR), r(minRR * 1.5)];
}

export interface BuildResult {
  spec: StrategySpec;
  log: string[];
}

export function buildSpecFromIntent(intent: Intent, rawPrompt = ''): BuildResult {
  const log: string[] = [];
  const valid = intent.templates.filter((t) => {
    if (!hasTemplate(t)) {
      log.push(`Ignored unknown template "${t}".`);
      return false;
    }
    return true;
  });
  let spec: StrategySpec;
  if (intent.consensus && (intent.consensusPreset || valid.length >= 2)) {
    const preset = intent.consensusPreset ? CONSENSUS_PRESETS.find((p) => p.id === intent.consensusPreset) : undefined;
    const ids = preset && valid.length < 2 ? preset.templates : valid.length >= 2 ? valid : CONSENSUS_PRESETS[0].templates;
    spec = consensusSpec(ids, preset?.consensus, preset && valid.length < 2 ? preset.name : undefined);
    log.push(`Consensus of ${ids.length} strategies: ${ids.join(', ')}. STRONG entry = first bar where they all agree.`);
  } else {
    const primary = valid[0] ?? (intent.add.some((a) => a.type === 'smc') ? 'smc_sweep_fvg' : 'ema_trend');
    if (!valid.length) log.push(`No complete strategy recognised — started from the "${primary}" template.`);
    if (valid.length > 1) log.push(`Several methods mentioned (${valid.join(', ')}); using "${primary}" as the primary strategy. Ask for "consensus" to make them vote together.`);
    spec = specFromTemplate(primary);
    log.push(`Primary template: ${TEMPLATES.find((t) => t.id === primary)!.name}.`);
    for (const extra of valid.slice(1)) {
      // Fold the extra template's non-trigger rules in as confirmations.
      const t = TEMPLATES.find((x) => x.id === extra)!;
      for (const c of t.conditions.filter((c) => c.role !== 'exit')) {
        const [instId, condId] = c.ref.split('.');
        const inst = t.components.find((x) => x.id === instId)!;
        addCondition(spec, 's1', inst, condId, { role: c.role === 'trigger' ? 'confirmation' : c.role, mandatory: false, weight: 1 });
      }
      log.push(`Added ${t.name} rules as weighted confirmations.`);
    }
  }
  // Extra components/conditions (single-strategy mode)
  if (!spec.consensus.enabled) {
    for (const a of intent.add) {
      if (!hasComponent(a.type)) {
        log.push(`Ignored unknown component "${a.type}".`);
        continue;
      }
      for (const c of a.conditions) {
        const def = getComponent(a.type).conditions.find((x) => x.id === c.id);
        if (!def) {
          log.push(`Ignored unknown condition ${a.type}.${c.id}.`);
          continue;
        }
        const ref = addCondition(spec, 's1', { id: a.type, type: a.type, params: a.params ?? {} }, c.id, { role: c.role ?? def.role, mandatory: c.mandatory ?? def.role !== 'confirmation', weight: c.weight ?? def.defaultWeight });
        log.push(`Added rule: ${def.label} (${ref}, ${c.role ?? def.role}${c.mandatory === false ? ', scored' : ''}).`);
      }
    }
    const v = spec.strategies[0];
    if (v.conditions.some((c) => !c.mandatory && c.role !== 'trigger' && c.role !== 'exit') && v.confluence.mode === 'strict') {
      v.confluence.mode = 'hybrid';
      v.confluence.minScore = 0;
      log.push('Switched to hybrid confluence: mandatory rules must pass; optional confirmations are scored and shown, threshold 0% (raise it to require them).');
    }
  } else if (intent.add.length) log.push('Extra indicator rules are not added to individual voters in consensus mode — edit voters in the spec editor.');

  // Market & output
  if (intent.symbol) spec.market.symbol = intent.symbol;
  if (intent.assetClass) spec.market.assetClass = intent.assetClass;
  if (intent.timeframe) {
    spec.market.timeframe = intent.timeframe;
    const range = spec.market.timeframeRange;
    if (range && tfInRange(intent.timeframe, range) === false) {
      spec.market.timeframeNote = `You asked for ${tfLabel(intent.timeframe)}, but this method is designed for ${rangeLabel(range)}. Parameters may need re-tuning; the script warns on the chart.`;
      log.push(`⚠ Timeframe ${tfLabel(intent.timeframe)} is outside the designed range ${rangeLabel(range)} — kept as requested; test carefully or choose a timeframe inside the range.`);
    } else {
      spec.market.timeframeNote = `Chart timeframe ${tfLabel(intent.timeframe)} (from your request)${range ? `; designed range ${rangeLabel(range)}` : ''}.`;
      log.push(`Timeframe: ${tfLabel(intent.timeframe)} (from your request)${range ? `, inside the designed range ${rangeLabel(range)}` : ''}.`);
    }
  } else {
    log.push(`No timeframe in your request — using the recommended ${tfLabel(spec.market.timeframe)}${spec.market.timeframeRange ? ` (designed range ${rangeLabel(spec.market.timeframeRange)})` : ''}. Set your TradingView chart to ${tfLabel(spec.market.timeframe)}.`);
    if (spec.market.timeframeNote) log.push(spec.market.timeframeNote);
  }
  if (intent.output) spec.output = intent.output;
  if (intent.direction) spec.filters.direction = intent.direction;
  if (intent.session) {
    spec.filters.session = { enabled: true, ...intent.session };
    log.push(`Session filter ${intent.session.session} (${intent.session.timezone}).`);
  }
  const htfTf = intent.htfTimeframe;
  if (htfTf) spec.components.filter((c) => c.type === 'htf').forEach((c) => (c.params.tf = htfTf));
  log.push(...ensureHigherTimeframes(spec));
  // Risk
  const r = spec.risk;
  if (intent.risk.stopMode) r.stopMode = intent.risk.stopMode;
  if (intent.risk.atrMult) r.atrMult = intent.risk.atrMult;
  if (intent.risk.tpCount) {
    r.tpCount = intent.risk.tpCount;
    r.tpQtyPct = r.tpCount === 1 ? [100, 0, 0] : r.tpCount === 2 ? [50, 50, 0] : [33, 33, 34];
  }
  if (intent.risk.minRR) {
    r.minRR = intent.risk.minRR;
    r.tpR = tpPlan(intent.risk.minRR, r.tpCount);
    log.push(`Targets set to ${r.tpR.slice(0, r.tpCount).join('R / ')}R so the weighted plan meets the 1:${intent.risk.minRR} minimum.`);
  }
  if (intent.risk.riskPct) {
    r.sizing.mode = 'Percent of equity risk';
    r.sizing.value = intent.risk.riskPct;
    r.sizing.maxRiskPct = Math.max(r.sizing.maxRiskPct, intent.risk.riskPct);
  }
  if (intent.risk.breakeven) r.breakeven.enabled = true;
  if (intent.risk.trailing) r.trailing.enabled = true;
  if (r.stopMode === 'ATR') log.push(`Stop: ${r.atrMult} × ATR(${r.atrLength}).`);
  else log.push(`Stop: ${r.stopMode}.`);

  // Name
  const base = spec.meta.name;
  spec.meta.name = intent.symbol ? `${base} — ${intent.symbol}${intent.timeframe ? ' ' + intent.timeframe : ''}` : base;
  if (rawPrompt) spec.meta.description = `${spec.meta.description}\nRequest: ${rawPrompt.slice(0, 400)}`;
  spec.notes.assumptions.push('Generated from a natural-language request; review every rule in the specification before use.');
  for (const n of intent.notes) log.push(n);
  return { spec, log };
}

export function specFromPrompt(text: string): BuildResult & { intent: Intent } {
  const intent = parsePrompt(text);
  const res = buildSpecFromIntent(intent, text);
  res.log.unshift(`Recognised: ${intent.matched.join(', ') || 'nothing specific'}.`);
  return { ...res, intent };
}

/** JSON schema-like description of Intent for LLM adapters. */
export const INTENT_SCHEMA_DOC = `{
  "name"?: string, "symbol"?: string, "assetClass"?: "forex"|"crypto"|"stocks"|"futures"|"indices"|"commodities"|"any",
  "timeframe"?: string (TradingView format: "15", "60", "240", "1D"),
  "output"?: "strategy"|"indicator",
  "templates": string[]  (template ids from the catalog; first = primary),
  "consensus"?: boolean, "consensusPreset"?: "trend_consensus"|"reversal_consensus"|"all_market",
  "add": [{ "type": componentType, "params"?: {...}, "conditions": [{ "id": conditionId, "role"?: "trigger"|"filter"|"confirmation"|"exit", "mandatory"?: boolean }] }],
  "risk": { "stopMode"?: "ATR"|"Structure"|"Percent"|"Ticks", "atrMult"?: number, "minRR"?: number, "tpCount"?: 1|2|3, "riskPct"?: number, "breakeven"?: boolean, "trailing"?: boolean },
  "direction"?: "both"|"long"|"short",
  "session"?: { "session": "HHMM-HHMM", "timezone": IANA tz },
  "matched": string[], "notes": string[]
}`;
