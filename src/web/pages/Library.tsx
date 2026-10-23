import { useMemo, useState } from 'react';
import { api, type TemplateDef } from '../api';
import { Badge, Card, Drawer, Empty, Icon, Spinner, Tabs, useApp } from '../components/ui';
import { rangeLabel, tfLabel } from '../../core/timeframe';

type Tab = 'strategies' | 'indicators' | 'presets';

export function Library() {
  const { catalog, setDraft, go, toast } = useApp();
  const [tab, setTab] = useState<Tab>('strategies');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [open, setOpen] = useState<TemplateDef | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const cats = useMemo(() => [...new Set(catalog?.templates.map((t) => t.category) ?? [])], [catalog]);
  const list = (catalog?.templates ?? []).filter((t) => (!cat || t.category === cat) && (!q || `${t.name} ${t.summary} ${t.category} ${t.markets}`.toLowerCase().includes(q.toLowerCase())));

  const use = async (id: string, output: 'strategy' | 'indicator') => {
    setBusy(true);
    try {
      const r = await api.fromTemplate(id, output);
      setDraft({ spec: r.spec, log: [`Started from template "${catalog?.templates.find((t) => t.id === id)?.name}" (${output}).`], source: 'template' });
      go('/builder');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const buildConsensus = async (ids: string[], presetId?: string) => {
    setBusy(true);
    try {
      const r = await api.consensus(presetId ? { presetId } : { templateIds: ids, name: `Consensus: ${ids.length} strategies` });
      setDraft({ spec: r.spec, log: [`Consensus of ${r.spec.strategies.length} strategies. A STRONG entry is marked on the first bar where they agree.`], source: 'consensus' });
      go('/builder');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  if (!catalog) return <Spinner />;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Strategy Library</h1>
          <p>{catalog.templates.length} researched strategy templates built from {catalog.components.length} indicator modules. Every template documents its logic, evidence quality, weaknesses and testing requirements. Popularity is not evidence of profitability.</p>
        </div>
      </div>
      <Tabs
        tabs={[
          { id: 'strategies', label: 'Strategies', count: catalog.templates.length },
          { id: 'indicators', label: 'Indicator modules', count: catalog.components.length },
          { id: 'presets', label: 'Consensus presets', count: catalog.presets.length },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'strategies' && (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <input type="search" placeholder="Search strategies, markets…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
            <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat(null)}>
              All
            </button>
            {cats.map((c) => (
              <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? null : c)}>
                {c}
              </button>
            ))}
          </div>
          {picked.length > 0 && (
            <div className="notice" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon name="layers" />
              <span>
                <strong>{picked.length}</strong> selected for a consensus: {picked.map((id) => catalog.templates.find((t) => t.id === id)?.name).join(', ')}
              </span>
              <span className="spacer" />
              <button className="btn sm" onClick={() => setPicked([])}>
                Clear
              </button>
              <button className="btn sm primary" disabled={picked.length < 2 || busy} onClick={() => buildConsensus(picked)}>
                Build consensus (STRONG entry)
              </button>
            </div>
          )}
          <div className="grid g3">
            {list.map((t) => (
              <article key={t.id} className="card tpl-card" onClick={() => setOpen(t)}>
                <div className="row">
                  <Badge tone="info">{t.category}</Badge>
                  <Badge>{t.family}</Badge>
                  <span className="spacer" />
                  <label className="check small" onClick={(e) => e.stopPropagation()} title="Select for consensus">
                    <input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} />
                    vote
                  </label>
                </div>
                <h3>{t.name}</h3>
                <p>{t.summary}</p>
                <div className="row small">
                  {t.chartTimeframe && <Badge tone="info">Chart: {tfLabel(t.chartTimeframe)}</Badge>}
                  {t.tfRange && <span className="muted">designed {rangeLabel(t.tfRange)}</span>}
                </div>
                <div className="muted small">{t.markets}</div>
              </article>
            ))}
          </div>
          {!list.length && <Empty>No strategies match.</Empty>}
        </>
      )}
      {tab === 'indicators' && (
        <div className="grid g2">
          {catalog.components.map((c) => (
            <Card key={c.type} title={c.name} actions={<Badge tone="info">{c.family}</Badge>}>
              <p style={{ marginTop: 0 }}>{c.summary}</p>
              <dl className="kv">
                <dt>Calculation</dt>
                <dd>{c.doc.calculation}</dd>
                <dt>Role</dt>
                <dd>{c.doc.role}</dd>
                <dt>Interpretation</dt>
                <dd>{c.doc.interpretation}</dd>
                <dt>Limitations</dt>
                <dd>{c.doc.limitations}</dd>
                <dt>Repainting</dt>
                <dd>{c.doc.repainting}</dd>
                <dt>Source</dt>
                <dd>{c.doc.source}</dd>
                <dt>Parameters</dt>
                <dd>{c.params.map((p) => `${p.label} (${p.default})`).join(' · ')}</dd>
                <dt>Conditions</dt>
                <dd>
                  <ul className="clean" style={{ marginTop: 0 }}>
                    {c.conditions.map((k) => (
                      <li key={k.id}>
                        <strong>{k.label}</strong> <span className="muted">[{k.role}, {k.family}]</span> — {k.description}
                      </li>
                    ))}
                  </ul>
                </dd>
              </dl>
            </Card>
          ))}
        </div>
      )}
      {tab === 'presets' && (
        <div className="grid g3">
          {catalog.presets.map((p) => (
            <Card key={p.id} title={p.name}>
              <p style={{ marginTop: 0 }}>{p.description}</p>
              <p className="small muted">
                STRONG at {p.consensus.strongThreshold}% agreement · standard {p.consensus.threshold}% · vote window {p.consensus.voteWindowBars} bars · {p.consensus.perFamily ? 'per family' : 'per strategy'}
              </p>
              <ul className="clean small">
                {p.templates.map((id) => (
                  <li key={id}>{catalog.templates.find((t) => t.id === id)?.name}</li>
                ))}
              </ul>
              <button className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => buildConsensus(p.templates, p.id)}>
                Use this consensus
              </button>
            </Card>
          ))}
        </div>
      )}
      {open && (
        <Drawer
          title={open.name}
          subtitle={`${open.category} · family: ${open.family}`}
          onClose={() => setOpen(null)}
          actions={
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => use(open.id, 'indicator')}>
                Use as indicator
              </button>
              <button className="btn primary" disabled={busy} onClick={() => use(open.id, 'strategy')}>
                Use as strategy
              </button>
            </div>
          }
        >
          <p style={{ margin: 0 }}>{open.summary}</p>
          <dl className="kv">
            <dt>Entry</dt>
            <dd>{open.entryLogic}</dd>
            <dt>Exit</dt>
            <dd>{open.exitLogic}</dd>
            <dt>Regime</dt>
            <dd>{open.regime}</dd>
            <dt>Markets</dt>
            <dd>{open.markets}</dd>
            <dt>Timeframe</dt>
            <dd>
              Set your chart to <strong>{open.chartTimeframe ? tfLabel(open.chartTimeframe) : open.timeframes}</strong>
              {open.tfRange && <> · designed for {rangeLabel(open.tfRange)}</>} <span className="muted">({open.timeframes})</span>
            </dd>
          </dl>
          <div className="grid g2">
            <div>
              <h4>Strengths</h4>
              <ul className="clean">
                {open.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Weaknesses</h4>
              <ul className="clean">
                {open.weaknesses.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <div>
            <h4>Known failure conditions</h4>
            <ul className="clean">
              {open.failureModes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="notice warn">
            <strong>Evidence quality.</strong> {open.evidence}
          </div>
          <div>
            <h4>Recommended testing</h4>
            <p style={{ margin: '6px 0 0' }}>{open.testing}</p>
          </div>
          <div>
            <h4>Rules ({open.confluence?.mode ?? 'strict'} confluence)</h4>
            <ul className="clean">
              {open.conditions.map((c) => {
                const inst = open.components.find((x) => x.id === c.ref.split('.')[0]);
                const comp = catalog.components.find((x) => x.type === inst?.type);
                const def = comp?.conditions.find((x) => x.id === c.ref.split('.')[1]);
                return (
                  <li key={c.ref}>
                    <Badge>{c.role}</Badge> {def?.label} <span className="muted">({comp?.name}{c.mandatory && c.role !== 'trigger' && c.role !== 'exit' ? ', mandatory' : ''})</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h4>Sources & references</h4>
            <ul className="clean">
              {open.sources.map((s) => (
                <li key={s.title}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  {s.note && <span className="muted"> — {s.note}</span>}
                </li>
              ))}
            </ul>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Implementation: {open.implementationNotes}
          </p>
        </Drawer>
      )}
    </div>
  );
}
