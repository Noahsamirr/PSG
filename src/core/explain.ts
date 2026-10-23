// Human-readable explanation of a specification (shown next to the generated code).
import { getComponent, hasComponent } from './components';
import { resolvedParams } from './spec';
import { plannedRR } from './validation/spec';
import type { StrategySpec } from './types';

export interface ExplainSection {
  title: string;
  items: string[];
}

export function explainSpec(spec: StrategySpec): ExplainSection[] {
  const r = spec.risk;
  const comp = (id: string) => spec.components.find((c) => c.id === id);
  const condLabel = (ref: string) => {
    const [id, cid] = ref.split('.');
    const c = comp(id);
    if (!c || !hasComponent(c.type)) return ref;
    const def = getComponent(c.type).conditions.find((x) => x.id === cid);
    return def ? `${def.label} — ${getComponent(c.type).name}` : ref;
  };
  const sections: ExplainSection[] = [];
  sections.push({
    title: 'What this script is',
    items: [
      `${spec.output === 'strategy' ? 'A TradingView strategy that places simulated orders in the Strategy Tester' : 'A TradingView indicator that draws signals and simulated trade levels (it never places orders)'}.`,
      spec.market.symbol ? `Designed for ${spec.market.symbol} on the ${spec.market.timeframe} timeframe; it runs on any chart, but parameters were chosen for this market.` : `Intended timeframe: ${spec.market.timeframe}.`,
      'All entry decisions are made when a bar closes. Higher-timeframe data comes from the last completed higher-timeframe bar.',
    ],
  });
  for (const v of spec.consensus.enabled ? spec.strategies : spec.strategies.slice(0, 1)) {
    const en = v.conditions.filter((c) => c.enabled);
    const trig = en.filter((c) => c.role === 'trigger');
    const req = en.filter((c) => (c.role === 'filter' || c.role === 'confirmation') && (v.confluence.mode === 'strict' || c.mandatory));
    const opt = en.filter((c) => (c.role === 'filter' || c.role === 'confirmation') && v.confluence.mode !== 'strict' && !c.mandatory);
    const ex = en.filter((c) => c.role === 'exit');
    const items = [
      `Entry trigger (any of): ${trig.map((c) => condLabel(c.ref)).join('; ') || '— none —'}.`,
      req.length ? `Must also be true: ${req.map((c) => condLabel(c.ref)).join('; ')}.` : 'No mandatory filters.',
    ];
    if (opt.length) items.push(`Scored confirmations (need ${v.confluence.minScore}% of weight): ${opt.map((c) => `${condLabel(c.ref)} (w${c.weight})`).join('; ')}.`);
    if (v.confluence.confirmWindowBars > 0) items.push(`Filters may confirm up to ${v.confluence.confirmWindowBars} bars after the trigger; otherwise the setup is marked invalidated.`);
    if (ex.length && !spec.consensus.enabled) items.push(`Rule-based exit: ${ex.map((c) => condLabel(c.ref)).join('; ')}.`);
    items.push('Short entries use the mirror-image rules.');
    sections.push({ title: spec.consensus.enabled ? `Voter: ${v.name} (${v.family})` : `Signal rules — ${v.name}`, items });
  }
  if (spec.consensus.enabled) {
    const cs = spec.consensus;
    sections.push({
      title: 'Consensus engine',
      items: [
        `Each strategy "votes" long or short for ${cs.voteWindowBars || 'an unlimited number of'} bars after its own confirmed signal (until it signals the opposite way).`,
        `Agreement is measured ${cs.perFamily ? 'per strategy family (trend, momentum, mean-reversion, volatility, volume, structure) so correlated systems are not counted twice' : 'per strategy'}.`,
        `STRONG BUY/SELL is marked on the FIRST bar where agreement reaches ${cs.strongThreshold}%${cs.vetoOnOpposite ? ' with no opposing vote' : ''}.`,
        `Partial agreement ≥ ${cs.threshold}% is shown as a potential setup${cs.tradeOn === 'strong' ? ' (not traded)' : ' and traded'}; it is marked invalidated if agreement fades first.`,
        'More agreement is not a probability of profit — it only means more independent rule sets point the same way.',
      ],
    });
  }
  sections.push({
    title: 'Risk & exits',
    items: [
      `Stop-loss: ${r.stopMode === 'ATR' ? `${r.atrMult} × ATR(${r.atrLength}) from the entry` : r.stopMode === 'Structure' ? `structural level (component swing/sweep level, else ${r.swingLookback}-bar extreme) with a ${r.structureBufferAtr} × ATR buffer` : r.stopMode === 'Percent' ? `${r.stopPercent}% from entry` : `${r.stopTicks} ticks from entry`}.`,
      `Targets: ${r.tpR.slice(0, r.tpCount).map((x, i) => `TP${i + 1} at ${x}R${i < r.tpCount - 1 ? ` (close ${r.tpQtyPct[i]}%)` : ' (rest)'}`).join(', ')}. Planned weighted R:R ${plannedRR(spec).toFixed(2)} (minimum ${r.minRR}).`,
      r.breakeven.enabled ? `Stop moves to breakeven once price reaches ${r.breakeven.triggerR}R.` : 'No breakeven move.',
      r.trailing.enabled ? `ATR trailing stop (${r.trailing.atrMult} × ATR) activates after ${r.trailing.activateR}R.` : 'No trailing stop.',
      `Position size: ${r.sizing.mode} = ${r.sizing.value}${r.sizing.mode.includes('Percent') ? '%' : ''}, capped at ${r.sizing.maxRiskPct}% equity risk and ${r.sizing.maxQty} units.`,
      r.dailyLoss.enabled && spec.output === 'strategy' ? `New entries stop for the day after a ${r.dailyLoss.percent}% equity drawdown from the day's start.` : 'No daily loss limit.',
      r.maxConsecutiveLosses > 0 ? `Trading pauses after ${r.maxConsecutiveLosses} consecutive losing trades.` : 'No loss-streak pause.',
    ],
  });
  const comps = spec.components.filter((c) => hasComponent(c.type)).map((c) => {
    const d = getComponent(c.type);
    const p = resolvedParams(c);
    const ps = d.params.filter((x) => x.type !== 'bool').map((x) => `${x.label} ${p[x.key]}`).join(', ');
    return `${d.name} [${c.id}] — ${ps}. ${d.doc.repainting}`;
  });
  sections.push({ title: 'Indicators calculated', items: comps });
  sections.push({ title: 'Known limitations', items: [...spec.notes.limitations, 'Backtests are hypothetical; validate out-of-sample with realistic costs.'] });
  return sections;
}

export function explainMarkdown(spec: StrategySpec): string {
  return explainSpec(spec)
    .map((s) => `### ${s.title}\n${s.items.map((i) => `- ${i}`).join('\n')}`)
    .join('\n\n');
}
