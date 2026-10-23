import { useEffect, useMemo, useState } from 'react';
import { addCondition, clone, mergeComponents, resolvedParams } from '../../core/spec';
import type { ComponentInstance, ConditionRole, ParamDef, ParamValue, StrategySpec, VoterSpec } from '../../core/types';
import { useApp, Field, NumberInput, Tabs, Badge, Icon } from './ui';
import { TF_LADDER, rangeLabel, tfInRange, tfLabel } from '../../core/timeframe';

type Tab = 'overview' | 'rules' | 'indicators' | 'consensus' | 'risk' | 'backtest' | 'filters' | 'json';

export function SpecEditor({ spec, onChange }: { spec: StrategySpec; onChange: (s: StrategySpec) => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const up = (fn: (s: StrategySpec) => void) => {
    const s = clone(spec);
    fn(s);
    onChange(s);
  };
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'rules', label: spec.consensus.enabled ? 'Voters & rules' : 'Entry & exit rules', count: spec.strategies.reduce((a, v) => a + v.conditions.length, 0) },
    { id: 'indicators', label: 'Indicators', count: spec.components.length },
    ...(spec.consensus.enabled ? [{ id: 'consensus' as Tab, label: 'Consensus' }] : []),
    { id: 'risk', label: 'Risk & targets' },
    { id: 'backtest', label: 'Backtest' },
    { id: 'filters', label: 'Filters, alerts & visuals' },
    { id: 'json', label: 'JSON' },
  ];
  return (
    <div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview spec={spec} up={up} />}
      {tab === 'rules' && <Rules spec={spec} up={up} />}
      {tab === 'indicators' && <Indicators spec={spec} up={up} />}
      {tab === 'consensus' && <Consensus spec={spec} up={up} />}
      {tab === 'risk' && <Risk spec={spec} up={up} />}
      {tab === 'backtest' && <Backtest spec={spec} up={up} />}
      {tab === 'filters' && <Filters spec={spec} up={up} />}
      {tab === 'json' && <JsonTab spec={spec} onChange={onChange} />}
    </div>
  );
}

type Up = (fn: (s: StrategySpec) => void) => void;

function Overview({ spec, up }: { spec: StrategySpec; up: Up }) {
  return (
    <div className="col">
      <div className="fields">
        <Field label="Strategy name">
          <input value={spec.meta.name} onChange={(e) => up((s) => (s.meta.name = e.target.value))} />
        </Field>
        <Field label="Version">
          <input value={spec.meta.version} onChange={(e) => up((s) => (s.meta.version = e.target.value))} />
        </Field>
        <Field label="Output type" hint="Strategy = Strategy Tester orders. Indicator = signals & alerts only.">
          <select value={spec.output} onChange={(e) => up((s) => (s.output = e.target.value as StrategySpec['output']))}>
            <option value="strategy">Strategy (backtestable orders)</option>
            <option value="indicator">Indicator (signals only)</option>
          </select>
        </Field>
        <Field label="Instrument" hint="e.g. XAUUSD, BTCUSDT, AAPL, ES1!">
          <input value={spec.market.symbol} onChange={(e) => up((s) => (s.market.symbol = e.target.value.toUpperCase()))} />
        </Field>
        <Field label="Asset class" hint="Sets margin assumptions and data warnings.">
          <select value={spec.market.assetClass} onChange={(e) => up((s) => (s.market.assetClass = e.target.value as StrategySpec['market']['assetClass']))}>
            {['any', 'forex', 'crypto', 'stocks', 'futures', 'indices', 'commodities'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
        <Field label="Chart timeframe" hint={spec.market.timeframeRange ? `Designed for ${rangeLabel(spec.market.timeframeRange)}` : 'TradingView format: 1, 5, 15, 60, 240, 1D'}>
          <select value={spec.market.timeframe} onChange={(e) => up((s) => (s.market.timeframe = e.target.value))}>
            {[...new Set([...TF_LADDER, spec.market.timeframe])].map((t) => (
              <option key={t} value={t}>
                {tfLabel(t)}
                {spec.market.timeframeRange ? (tfInRange(t, spec.market.timeframeRange) ? ' ✓' : ' — outside design range') : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Designed range" hint="Timeframes the parameters were chosen for">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {[0, 1].map((k) => (
              <select
                key={k}
                value={(spec.market.timeframeRange ?? [spec.market.timeframe, spec.market.timeframe])[k]}
                onChange={(e) =>
                  up((s) => {
                    const r = [...(s.market.timeframeRange ?? [s.market.timeframe, s.market.timeframe])] as [string, string];
                    r[k] = e.target.value;
                    s.market.timeframeRange = r;
                  })
                }
              >
                {TF_LADDER.map((t) => (
                  <option key={t} value={t}>
                    {tfLabel(t)}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </Field>
        <Field label="Wrong-timeframe guard" hint="What the script does on other chart timeframes">
          <select value={spec.market.timeframeGuard ?? 'warn'} onChange={(e) => up((s) => (s.market.timeframeGuard = e.target.value as 'off' | 'warn' | 'block'))}>
            <option value="warn">Warn (banner on chart)</option>
            <option value="block">Block entries</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Field label="Category">
          <input value={spec.meta.category} onChange={(e) => up((s) => (s.meta.category = e.target.value))} />
        </Field>
      </div>
      {spec.market.timeframeNote && (
        <div className={`notice ${spec.market.timeframeRange && tfInRange(spec.market.timeframe, spec.market.timeframeRange) === false ? 'warn' : ''}`}>
          <strong>Timeframe:</strong> set your TradingView chart to <strong>{tfLabel(spec.market.timeframe)}</strong>. {spec.market.timeframeNote}
        </div>
      )}
      <Field label="Description">
        <textarea rows={4} value={spec.meta.description} onChange={(e) => up((s) => (s.meta.description = e.target.value))} />
      </Field>
      <Field label="Known limitations (one per line)">
        <textarea rows={3} value={spec.notes.limitations.join('\n')} onChange={(e) => up((s) => (s.notes.limitations = e.target.value.split('\n').filter((x) => x.trim())))} />
      </Field>
    </div>
  );
}

function condInfo(spec: StrategySpec, ref: string, catalog: ReturnType<typeof useApp>['catalog']) {
  const [id, cid] = ref.split('.');
  const inst = spec.components.find((c) => c.id === id);
  const comp = catalog?.components.find((c) => c.type === inst?.type);
  const def = comp?.conditions.find((c) => c.id === cid);
  return { inst, comp, def };
}

function VoterRules({ spec, voter, up, compact }: { spec: StrategySpec; voter: VoterSpec; up: Up; compact?: boolean }) {
  const { catalog } = useApp();
  const vi = spec.strategies.findIndex((v) => v.id === voter.id);
  const [addType, setAddType] = useState('');
  const [addCond, setAddCond] = useState('');
  const addOptions = useMemo(() => {
    const existing = spec.components.map((c) => ({ key: `inst:${c.id}`, label: `${catalog?.components.find((x) => x.type === c.type)?.name ?? c.type} [${c.id}]`, type: c.type }));
    const fresh = (catalog?.components ?? []).map((c) => ({ key: `new:${c.type}`, label: `New: ${c.name}`, type: c.type }));
    return [...existing, ...fresh];
  }, [spec.components, catalog]);
  const sel = addOptions.find((o) => o.key === addType);
  const condOptions = catalog?.components.find((c) => c.type === sel?.type)?.conditions ?? [];
  const add = () => {
    if (!sel || !addCond) return;
    up((s) => {
      const inst: ComponentInstance = sel.key.startsWith('inst:') ? s.components.find((c) => c.id === sel.key.slice(5))! : { id: sel.type, type: sel.type, params: {} };
      addCondition(s, voter.id, inst, addCond);
    });
    setAddCond('');
  };
  const set = (i: number, fn: (c: VoterSpec['conditions'][number]) => void) => up((s) => fn(s.strategies[vi].conditions[i]));
  return (
    <div className="col">
      <div className="fields">
        <Field label="Confluence mode" hint="Strict: all rules. Weighted: score ≥ min. Hybrid: mandatory + score.">
          <select value={voter.confluence.mode} onChange={(e) => up((s) => (s.strategies[vi].confluence.mode = e.target.value as VoterSpec['confluence']['mode']))}>
            <option value="strict">Strict</option>
            <option value="weighted">Weighted score</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </Field>
        <Field label="Minimum score %">
          <NumberInput value={voter.confluence.minScore} min={0} max={100} onChange={(v) => up((s) => (s.strategies[vi].confluence.minScore = v))} />
        </Field>
        <Field label="Confirmation window (bars)" hint="0 = trigger and filters on the same bar.">
          <NumberInput value={voter.confluence.confirmWindowBars} min={0} onChange={(v) => up((s) => (s.strategies[vi].confluence.confirmWindowBars = Math.max(0, Math.round(v))))} />
        </Field>
        <Field label="Correlation control">
          <label className="check">
            <input type="checkbox" checked={voter.confluence.dedupeFamilies} onChange={(e) => up((s) => (s.strategies[vi].confluence.dedupeFamilies = e.target.checked))} />
            Count each family once in the score
          </label>
        </Field>
      </div>
      <div className="table-wrap card" style={{ boxShadow: 'none' }}>
        <table>
          <thead>
            <tr>
              <th>On</th>
              <th>Rule</th>
              <th>Role</th>
              <th>Mandatory</th>
              <th className="num">Weight</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {voter.conditions.map((c, i) => {
              const { inst, comp, def } = condInfo(spec, c.ref, catalog);
              return (
                <tr key={c.ref + i} className="cond-row">
                  <td>
                    <input type="checkbox" aria-label="Enabled" checked={c.enabled} onChange={(e) => set(i, (x) => (x.enabled = e.target.checked))} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 550 }}>{def?.label ?? c.ref}</div>
                    {!compact && (
                      <div className="muted small">
                        {comp?.name ?? '?'} [{inst?.id}] · {def?.family} · {def?.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <select value={c.role} onChange={(e) => set(i, (x) => (x.role = e.target.value as ConditionRole))} style={{ width: 130 }}>
                      <option value="trigger">Trigger</option>
                      <option value="filter">Filter</option>
                      <option value="confirmation">Confirmation</option>
                      <option value="exit">Exit</option>
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" aria-label="Mandatory" disabled={c.role === 'trigger' || c.role === 'exit'} checked={c.mandatory} onChange={(e) => set(i, (x) => (x.mandatory = e.target.checked))} />
                  </td>
                  <td className="num" style={{ width: 90 }}>
                    <NumberInput value={c.weight} min={0} onChange={(v) => set(i, (x) => (x.weight = v))} />
                  </td>
                  <td>
                    <button className="btn icon ghost sm" aria-label="Remove rule" onClick={() => up((s) => s.strategies[vi].conditions.splice(i, 1))}>
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row">
        <select value={addType} onChange={(e) => (setAddType(e.target.value), setAddCond(''))} style={{ maxWidth: 300 }}>
          <option value="">Add a rule from…</option>
          {addOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={addCond} onChange={(e) => setAddCond(e.target.value)} disabled={!sel} style={{ maxWidth: 360 }}>
          <option value="">Choose condition…</option>
          {condOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.role})
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={add} disabled={!addCond}>
          <Icon name="plus" size={15} /> Add rule
        </button>
      </div>
    </div>
  );
}

function Rules({ spec, up }: { spec: StrategySpec; up: Up }) {
  if (!spec.consensus.enabled) return <VoterRules spec={spec} voter={spec.strategies[0]} up={up} />;
  return (
    <div className="col">
      <div className="notice">Each voter is evaluated independently with its own rules; the consensus engine counts their recent confirmed signals. Rule-based exits of individual voters are not used in consensus mode.</div>
      {spec.strategies.map((v) => (
        <details key={v.id} className="stage">
          <summary>
            <strong>{v.name}</strong>
            <Badge>{v.family}</Badge>
            <span className="muted small">{v.conditions.filter((c) => c.enabled).length} rules · {v.confluence.mode}</span>
          </summary>
          <div className="stage-body">
            <VoterRules spec={spec} voter={v} up={up} compact />
          </div>
        </details>
      ))}
    </div>
  );
}

function ParamInput({ p, value, onChange }: { p: ParamDef; value: ParamValue; onChange: (v: ParamValue) => void }) {
  if (p.type === 'bool') return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  if (p.type === 'int' || p.type === 'float') return <NumberInput value={Number(value)} min={p.min} max={p.max} step={p.step ?? (p.type === 'int' ? 1 : undefined)} onChange={(v) => onChange(p.type === 'int' ? Math.round(v) : v)} />;
  if (p.options)
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {p.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  if (p.type === 'source')
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'].map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  return <input value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}

function Indicators({ spec, up }: { spec: StrategySpec; up: Up }) {
  const { catalog } = useApp();
  const [newType, setNewType] = useState('');
  return (
    <div className="col">
      {spec.components.map((inst, idx) => {
        const comp = catalog?.components.find((c) => c.type === inst.type);
        if (!comp) return null;
        const params = resolvedParams(inst);
        const used = spec.strategies.some((v) => v.conditions.some((c) => c.ref.startsWith(inst.id + '.')));
        return (
          <div key={inst.id} className="card card-pad" style={{ boxShadow: 'none' }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <strong>{comp.name}</strong>
              <Badge>{inst.id}</Badge>
              <Badge tone="info">{comp.family}</Badge>
              {!used && <Badge tone="warn">not used by any rule</Badge>}
              <span className="spacer" />
              <button
                className="btn sm ghost danger"
                onClick={() => {
                  if (used && !confirm(`Remove ${comp.name} and every rule that uses it?`)) return;
                  up((s) => {
                    s.components.splice(idx, 1);
                    s.strategies.forEach((v) => (v.conditions = v.conditions.filter((c) => !c.ref.startsWith(inst.id + '.'))));
                  });
                }}
              >
                <Icon name="trash" size={15} /> Remove
              </button>
            </div>
            <p className="muted small" style={{ margin: '0 0 10px' }}>
              {comp.doc.calculation} <em>Repainting:</em> {comp.doc.repainting}
            </p>
            <div className="fields">
              {comp.params.map((p) => (
                <Field key={p.key} label={p.label} hint={p.tooltip}>
                  <ParamInput p={p} value={params[p.key]} onChange={(v) => up((s) => (s.components[idx].params[p.key] = v))} />
                </Field>
              ))}
            </div>
          </div>
        );
      })}
      <div className="row">
        <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">Add an indicator…</option>
          {catalog?.components.map((c) => (
            <option key={c.type} value={c.type}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="btn sm" disabled={!newType} onClick={() => up((s) => void mergeComponents(s.components, [{ id: newType, type: newType, params: {} }]))}>
          <Icon name="plus" size={15} /> Add indicator
        </button>
        <span className="hint">New indicators are calculated and plotted; add rules that use them in the Rules tab.</span>
      </div>
    </div>
  );
}

function Consensus({ spec, up }: { spec: StrategySpec; up: Up }) {
  const { catalog } = useApp();
  const cs = spec.consensus;
  const [addTpl, setAddTpl] = useState('');
  return (
    <div className="col">
      <div className="fields">
        <Field label="Enter on">
          <select value={cs.tradeOn} onChange={(e) => up((s) => (s.consensus.tradeOn = e.target.value as 'strong' | 'standard'))}>
            <option value="strong">STRONG agreement only</option>
            <option value="standard">Standard and strong agreement</option>
          </select>
        </Field>
        <Field label="STRONG agreement %" hint="100 = every active strategy agrees.">
          <NumberInput value={cs.strongThreshold} min={1} max={100} onChange={(v) => up((s) => (s.consensus.strongThreshold = v))} />
        </Field>
        <Field label="Standard agreement %">
          <NumberInput value={cs.threshold} min={1} max={100} onChange={(v) => up((s) => (s.consensus.threshold = v))} />
        </Field>
        <Field label="Vote window (bars)" hint="How long a strategy's signal counts as a vote. 0 = until it signals the other way.">
          <NumberInput value={cs.voteWindowBars} min={0} onChange={(v) => up((s) => (s.consensus.voteWindowBars = Math.max(0, Math.round(v))))} />
        </Field>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={cs.perFamily} onChange={(e) => up((s) => (s.consensus.perFamily = e.target.checked))} /> Count agreement per family (limits double counting)
        </label>
        <label className="check">
          <input type="checkbox" checked={cs.vetoOnOpposite} onChange={(e) => up((s) => (s.consensus.vetoOnOpposite = e.target.checked))} /> STRONG requires no opposing vote
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Voter</th>
            <th>Family</th>
            <th>Rules</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {spec.strategies.map((v, i) => (
            <tr key={v.id}>
              <td>{v.name}</td>
              <td>
                <Badge>{v.family}</Badge>
              </td>
              <td>{v.conditions.filter((c) => c.enabled && c.role !== 'exit').length}</td>
              <td className="right">
                <button className="btn sm ghost danger" disabled={spec.strategies.length <= 2} onClick={() => up((s) => s.strategies.splice(i, 1))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <select value={addTpl} onChange={(e) => setAddTpl(e.target.value)} style={{ maxWidth: 360 }}>
          <option value="">Add a voter from the library…</option>
          {catalog?.templates
            .filter((t) => !spec.strategies.some((v) => v.templateId === t.id))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.family})
              </option>
            ))}
        </select>
        <button
          className="btn sm"
          disabled={!addTpl}
          onClick={() =>
            up((s) => {
              const t = catalog!.templates.find((x) => x.id === addTpl)!;
              const map = mergeComponents(s.components, t.components);
              const n = Math.max(...s.strategies.map((v) => Number(v.id.slice(1)) || 0)) + 1;
              s.strategies.push({
                id: `s${n}`,
                templateId: t.id,
                name: t.name,
                family: t.family,
                conditions: t.conditions.map((c) => ({ ...c, ref: `${map[c.ref.split('.')[0]]}.${c.ref.split('.')[1]}`, enabled: true })),
                confluence: { mode: t.confluence?.mode ?? 'strict', minScore: t.confluence?.minScore ?? 60, confirmWindowBars: 0, dedupeFamilies: true },
              });
              s.meta.templateIds.push(t.id);
            })
          }
        >
          <Icon name="plus" size={15} /> Add voter
        </button>
      </div>
    </div>
  );
}

function Risk({ spec, up }: { spec: StrategySpec; up: Up }) {
  const r = spec.risk;
  const tp = (i: number) => (
    <Field key={i} label={`TP${i + 1} (R)${i < r.tpCount - 1 ? ' · close %' : ' · closes rest'}`}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <NumberInput value={r.tpR[i]} min={0.1} step={0.1} onChange={(v) => up((s) => (s.risk.tpR[i] = v))} />
        {i < r.tpCount - 1 && <NumberInput value={r.tpQtyPct[i]} min={1} max={99} onChange={(v) => up((s) => (s.risk.tpQtyPct[i] = v))} />}
      </div>
    </Field>
  );
  return (
    <div className="col">
      <h4>Stop-loss</h4>
      <div className="fields">
        <Field label="Method">
          <select value={r.stopMode} onChange={(e) => up((s) => (s.risk.stopMode = e.target.value as typeof r.stopMode))}>
            <option value="ATR">ATR multiple</option>
            <option value="Structure">Structure (swing / sweep level)</option>
            <option value="Percent">Percent</option>
            <option value="Ticks">Ticks</option>
          </select>
        </Field>
        <Field label="ATR length">
          <NumberInput value={r.atrLength} min={1} onChange={(v) => up((s) => (s.risk.atrLength = Math.round(v)))} />
        </Field>
        <Field label="ATR multiple">
          <NumberInput value={r.atrMult} min={0.1} step={0.1} onChange={(v) => up((s) => (s.risk.atrMult = v))} />
        </Field>
        <Field label="Percent stop %">
          <NumberInput value={r.stopPercent} min={0.01} step={0.05} onChange={(v) => up((s) => (s.risk.stopPercent = v))} />
        </Field>
        <Field label="Tick stop">
          <NumberInput value={r.stopTicks} min={1} onChange={(v) => up((s) => (s.risk.stopTicks = Math.round(v)))} />
        </Field>
        <Field label="Swing lookback (fallback)">
          <NumberInput value={r.swingLookback} min={2} onChange={(v) => up((s) => (s.risk.swingLookback = Math.round(v)))} />
        </Field>
        <Field label="Structure buffer (× ATR)">
          <NumberInput value={r.structureBufferAtr} min={0} step={0.05} onChange={(v) => up((s) => (s.risk.structureBufferAtr = v))} />
        </Field>
        <Field label="Skip if stop > × ATR (0 = off)">
          <NumberInput value={r.maxStopAtr} min={0} step={0.5} onChange={(v) => up((s) => (s.risk.maxStopAtr = v))} />
        </Field>
      </div>
      <h4>Targets</h4>
      <div className="fields">
        <Field label="Number of targets">
          <select
            value={r.tpCount}
            onChange={(e) =>
              up((s) => {
                const n = Number(e.target.value) as 1 | 2 | 3;
                s.risk.tpCount = n;
                s.risk.tpQtyPct = n === 1 ? [100, 0, 0] : n === 2 ? [50, 50, 0] : [33, 33, 34];
              })
            }
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </Field>
        {[0, 1, 2].slice(0, r.tpCount).map(tp)}
        <Field label="Minimum planned R:R" hint="Weighted average of the target plan.">
          <NumberInput value={r.minRR} min={0} step={0.1} onChange={(v) => up((s) => (s.risk.minRR = v))} />
        </Field>
      </div>
      <h4>Trade management</h4>
      <div className="fields">
        <Field label="Breakeven">
          <label className="check">
            <input type="checkbox" checked={r.breakeven.enabled} onChange={(e) => up((s) => (s.risk.breakeven.enabled = e.target.checked))} /> Move stop to entry
          </label>
        </Field>
        <Field label="…after (R)">
          <NumberInput value={r.breakeven.triggerR} min={0.1} step={0.1} onChange={(v) => up((s) => (s.risk.breakeven.triggerR = v))} />
        </Field>
        <Field label="Trailing stop">
          <label className="check">
            <input type="checkbox" checked={r.trailing.enabled} onChange={(e) => up((s) => (s.risk.trailing.enabled = e.target.checked))} /> ATR trailing
          </label>
        </Field>
        <Field label="Trail × ATR">
          <NumberInput value={r.trailing.atrMult} min={0.1} step={0.1} onChange={(v) => up((s) => (s.risk.trailing.atrMult = v))} />
        </Field>
        <Field label="Activate after (R)">
          <NumberInput value={r.trailing.activateR} min={0} step={0.1} onChange={(v) => up((s) => (s.risk.trailing.activateR = v))} />
        </Field>
        <Field label="Time exit (bars, 0 = off)">
          <NumberInput value={r.timeExitBars} min={0} onChange={(v) => up((s) => (s.risk.timeExitBars = Math.round(v)))} />
        </Field>
        <Field label="Cooldown after exit (bars)">
          <NumberInput value={r.cooldownBars} min={0} onChange={(v) => up((s) => (s.risk.cooldownBars = Math.round(v)))} />
        </Field>
        <Field label="Opposite signal">
          <label className="check">
            <input type="checkbox" checked={r.closeOnOpposite} onChange={(e) => up((s) => (s.risk.closeOnOpposite = e.target.checked))} /> Close position
          </label>
        </Field>
      </div>
      <h4>Position sizing & limits</h4>
      <div className="fields">
        <Field label="Sizing mode">
          <select value={r.sizing.mode} onChange={(e) => up((s) => (s.risk.sizing.mode = e.target.value as typeof r.sizing.mode))}>
            {['Percent of equity risk', 'Fixed cash risk', 'Fixed quantity', 'Percent of equity notional'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Sizing value" hint="% of equity, cash amount or quantity">
          <NumberInput value={r.sizing.value} min={0} step={0.1} onChange={(v) => up((s) => (s.risk.sizing.value = v))} />
        </Field>
        <Field label="Max risk per trade % (0 = off)">
          <NumberInput value={r.sizing.maxRiskPct} min={0} step={0.1} onChange={(v) => up((s) => (s.risk.sizing.maxRiskPct = v))} />
        </Field>
        <Field label="Max position size">
          <NumberInput value={r.sizing.maxQty} min={0} onChange={(v) => up((s) => (s.risk.sizing.maxQty = v))} />
        </Field>
        <Field label="Quantity step (0 = auto)" hint="Contracts 1, crypto 0.0001…">
          <NumberInput value={r.sizing.qtyStep} min={0} onChange={(v) => up((s) => (s.risk.sizing.qtyStep = v))} />
        </Field>
        <Field label="Daily loss limit">
          <label className="check">
            <input type="checkbox" checked={r.dailyLoss.enabled} onChange={(e) => up((s) => (s.risk.dailyLoss.enabled = e.target.checked))} /> Enabled (strategy mode)
          </label>
        </Field>
        <Field label="Daily loss %">
          <NumberInput value={r.dailyLoss.percent} min={0.1} step={0.1} onChange={(v) => up((s) => (s.risk.dailyLoss.percent = v))} />
        </Field>
        <Field label="Pause after N losses (0 = off)">
          <NumberInput value={r.maxConsecutiveLosses} min={0} onChange={(v) => up((s) => (s.risk.maxConsecutiveLosses = Math.round(v)))} />
        </Field>
      </div>
    </div>
  );
}

function Backtest({ spec, up }: { spec: StrategySpec; up: Up }) {
  const b = spec.backtest;
  return (
    <div className="col">
      <div className="notice">These become the defaults in the strategy() declaration. TradingView's Strategy Tester "Properties" tab can override them.</div>
      <div className="fields">
        <Field label="Initial capital">
          <NumberInput value={b.initialCapital} min={1} onChange={(v) => up((s) => (s.backtest.initialCapital = v))} />
        </Field>
        <Field label="Account currency" hint="NONE = the symbol's currency">
          <select value={b.currency} onChange={(e) => up((s) => (s.backtest.currency = e.target.value))}>
            {['NONE', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'USDT', 'BTC'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Commission type">
          <select value={b.commissionType} onChange={(e) => up((s) => (s.backtest.commissionType = e.target.value as typeof b.commissionType))}>
            <option value="percent">% of order value</option>
            <option value="cash_per_contract">Cash per contract</option>
            <option value="cash_per_order">Cash per order</option>
          </select>
        </Field>
        <Field label="Commission value">
          <NumberInput value={b.commissionValue} min={0} step={0.01} onChange={(v) => up((s) => (s.backtest.commissionValue = v))} />
        </Field>
        <Field label="Slippage (ticks)">
          <NumberInput value={b.slippageTicks} min={0} onChange={(v) => up((s) => (s.backtest.slippageTicks = Math.round(v)))} />
        </Field>
        <Field label="Fill model" hint="Next bar open is realistic; on-close is optimistic.">
          <select value={b.fillMode} onChange={(e) => up((s) => (s.backtest.fillMode = e.target.value as typeof b.fillMode))}>
            <option value="next_open">Market order fills next bar open</option>
            <option value="on_close">Fill on signal bar close</option>
          </select>
        </Field>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={b.anchorToFill} onChange={(e) => up((s) => (s.backtest.anchorToFill = e.target.checked))} /> Re-anchor targets to the actual fill price
        </label>
        <label className="check">
          <input type="checkbox" checked={b.barMagnifier} onChange={(e) => up((s) => (s.backtest.barMagnifier = e.target.checked))} /> Bar magnifier (intrabar fills; plan-dependent)
        </label>
        <label className="check">
          <input type="checkbox" checked={b.dateRange.enabled} onChange={(e) => up((s) => (s.backtest.dateRange.enabled = e.target.checked))} /> Limit date range
        </label>
      </div>
      {b.dateRange.enabled && (
        <div className="fields">
          <Field label="Start">
            <input type="date" value={b.dateRange.start} onChange={(e) => up((s) => (s.backtest.dateRange.start = e.target.value))} />
          </Field>
          <Field label="End">
            <input type="date" value={b.dateRange.end} onChange={(e) => up((s) => (s.backtest.dateRange.end = e.target.value))} />
          </Field>
        </div>
      )}
    </div>
  );
}

function Filters({ spec, up }: { spec: StrategySpec; up: Up }) {
  const f = spec.filters;
  const tz = ['Exchange', 'UTC', 'America/New_York', 'America/Chicago', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Singapore', 'Australia/Sydney'];
  return (
    <div className="col">
      <h4>Filters</h4>
      <div className="fields">
        <Field label="Direction">
          <select value={f.direction} onChange={(e) => up((s) => (s.filters.direction = e.target.value as typeof f.direction))}>
            <option value="both">Long & short</option>
            <option value="long">Long only</option>
            <option value="short">Short only</option>
          </select>
        </Field>
        <Field label="Session filter">
          <label className="check">
            <input type="checkbox" checked={f.session.enabled} onChange={(e) => up((s) => (s.filters.session.enabled = e.target.checked))} /> Trade only in session
          </label>
        </Field>
        <Field label="Session (HHMM-HHMM)">
          <input value={f.session.session} onChange={(e) => up((s) => (s.filters.session.session = e.target.value))} />
        </Field>
        <Field label="Session timezone">
          <select value={f.session.timezone} onChange={(e) => up((s) => (s.filters.session.timezone = e.target.value))}>
            {tz.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="News blackout" hint="See Market Research → Calendar for suggested windows.">
          <label className="check">
            <input type="checkbox" checked={f.blackout.enabled} onChange={(e) => up((s) => (s.filters.blackout.enabled = e.target.checked))} /> No entries in window
          </label>
        </Field>
        <Field label="Blackout window">
          <input value={f.blackout.session} onChange={(e) => up((s) => (s.filters.blackout.session = e.target.value))} />
        </Field>
        <Field label="Blackout timezone">
          <select value={f.blackout.timezone} onChange={(e) => up((s) => (s.filters.blackout.timezone = e.target.value))}>
            {tz.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>
      <h4>Alerts</h4>
      <div className="row">
        {(
          [
            ['setup', 'Potential setups'],
            ['entry', 'Confirmed entries'],
            ['exit', 'Targets, stops & exits'],
            ['invalidation', 'Invalidated setups'],
            ['json', 'JSON messages (webhooks)'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={spec.alerts[k]} onChange={(e) => up((s) => (s.alerts[k] = e.target.checked))} /> {label}
          </label>
        ))}
      </div>
      <h4>Visuals</h4>
      <div className="fields">
        <Field label="Bullish colour">
          <input type="color" value={spec.visuals.bullColor} onChange={(e) => up((s) => (s.visuals.bullColor = e.target.value.toUpperCase()))} style={{ padding: 2 }} />
        </Field>
        <Field label="Bearish colour">
          <input type="color" value={spec.visuals.bearColor} onChange={(e) => up((s) => (s.visuals.bearColor = e.target.value.toUpperCase()))} style={{ padding: 2 }} />
        </Field>
        <Field label="Dashboard position">
          <select value={spec.visuals.dashboardPosition} onChange={(e) => up((s) => (s.visuals.dashboardPosition = e.target.value as typeof s.visuals.dashboardPosition))}>
            {['Top right', 'Top left', 'Bottom right', 'Bottom left'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        {(
          [
            ['showLabels', 'Entry/exit labels'],
            ['showSetups', 'Setups & invalidations'],
            ['showLevels', 'SL/TP levels'],
            ['showComponentVisuals', 'Indicator & structure overlays'],
            ['showDashboard', 'Dashboard table'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={spec.visuals[k]} onChange={(e) => up((s) => (s.visuals[k] = e.target.checked))} /> {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function JsonTab({ spec, onChange }: { spec: StrategySpec; onChange: (s: StrategySpec) => void }) {
  const [text, setText] = useState(() => JSON.stringify(spec, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(spec, null, 2)), [spec]);
  return (
    <div className="col">
      <textarea className="mono" rows={24} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {err && <div className="notice bad">{err}</div>}
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            try {
              const s = JSON.parse(text) as StrategySpec;
              if (s.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
              onChange(s);
              setErr(null);
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Apply JSON
        </button>
        <span className="hint">The specification is the source of truth; the Pine code is regenerated from it.</span>
      </div>
    </div>
  );
}
