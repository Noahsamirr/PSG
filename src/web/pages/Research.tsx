import { useEffect, useMemo, useState } from 'react';
import { topicsOf, tone } from '../../core/research';
import { api, type ResearchReport, type Resource } from '../api';
import { HBars, Sparkline } from '../components/charts';
import { Markdown } from '../components/Markdown';
import { ago, Badge, Card, copyText, Empty, fmt, fmtPct, Icon, Spinner, Tabs, useApp } from '../components/ui';

type Tab = 'briefing' | 'markets' | 'news' | 'themes' | 'calendar' | 'sources' | 'resources';

export function Research() {
  const { toast, setDraft, draft, go, settings } = useApp();
  const [report, setReport] = useState<{ id?: string; createdAt: string; report: ResearchReport } | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<null | 'quick' | 'deep'>(null);
  const [tab, setTab] = useState<Tab>('briefing');
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.researchHistory>>>([]);
  useEffect(() => {
    api
      .latestResearch()
      .then((r) => setReport(r))
      .finally(() => setLoading(false));
    api.researchHistory().then(setHistory);
  }, []);
  const run = async (mode: 'quick' | 'deep') => {
    setRunning(mode);
    try {
      const r = await api.runResearch(mode);
      setReport({ createdAt: r.createdAt, report: r });
      api.researchHistory().then(setHistory);
      const failed = r.sources.filter((s) => !s.ok).length;
      toast(`Research complete: ${r.news.length} headlines from ${r.sources.length - failed}/${r.sources.length} sources in ${(r.durationMs / 1000).toFixed(1)} s.`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setRunning(null);
    }
  };
  const r = report?.report;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Market Research</h1>
          <p>Pulls the latest headlines, central-bank releases, the macro calendar, sentiment gauges and daily prices from public sources, then summarises themes, regimes and event risk — so strategy choices stay grounded in current conditions. Descriptive only: no price predictions, no advice.</p>
        </div>
        <div className="hero-cta">
          <button className="btn" onClick={() => run('quick')} disabled={!!running}>
            {running === 'quick' ? <Spinner /> : <Icon name="refresh" size={16} />} Quick scan
          </button>
          <button className="btn primary" onClick={() => run('deep')} disabled={!!running}>
            {running === 'deep' ? <Spinner /> : <Icon name="globe" size={16} />} Run deep market research
          </button>
        </div>
      </div>
      {running && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Spinner /> Researching {running === 'deep' ? '40+' : '30+'} sources (news feeds, central banks, Google News per asset, economic calendar, sentiment, price history)… this usually takes 10–40 seconds.
          {settings?.llm.configured && ' An AI briefing will be written from the collected sources.'}
        </div>
      )}
      {loading ? (
        <Spinner />
      ) : !r ? (
        <Card>
          <Empty>
            No research yet. Click <strong>Run deep market research</strong> to build the first report.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <Badge tone="info">{r.mode === 'deep' ? 'Deep research' : 'Quick scan'}</Badge>
            <span className="muted small">
              Updated {ago(r.createdAt)} ({new Date(r.createdAt).toLocaleString()}) · {r.news.length} headlines · {r.sources.filter((s) => s.ok).length}/{r.sources.length} sources OK
            </span>
            <span className="spacer" />
            {history.length > 1 && (
              <select
                style={{ width: 'auto' }}
                value=""
                onChange={(e) => e.target.value && api.researchById(e.target.value).then(setReport)}
                aria-label="Previous reports"
              >
                <option value="">Previous reports…</option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {new Date(h.createdAt).toLocaleString()} · {h.mode} · {h.news} headlines
                  </option>
                ))}
              </select>
            )}
          </div>
          <Tabs
            tabs={[
              { id: 'briefing', label: 'Briefing' },
              { id: 'markets', label: 'Markets & regimes', count: r.markets.filter((m) => m.ok).length },
              { id: 'news', label: 'News', count: r.news.length },
              { id: 'themes', label: 'Themes', count: r.topics.length },
              { id: 'calendar', label: 'Calendar & event risk', count: r.calendar?.events.length ?? 0 },
              { id: 'sources', label: 'Sources', count: r.sources.length },
              { id: 'resources', label: 'Resources & references' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'briefing' && <Briefing r={r} onUse={async (tpl, symbol) => {
            const res = await api.fromTemplate(tpl);
            res.spec.market.symbol = symbol;
            setDraft({ spec: res.spec, log: [`Started from market research: ${symbol} regime suggests "${tpl}". Heuristic only — validate before use.`], source: 'research' });
            go('/builder');
          }} />}
          {tab === 'markets' && <Markets r={r} />}
          {tab === 'news' && <News r={r} />}
          {tab === 'themes' && <Themes r={r} />}
          {tab === 'calendar' && (
            <Calendar
              r={r}
              canApply={!!draft}
              apply={(session, timezone) => {
                if (!draft) return;
                setDraft({ ...draft, spec: { ...draft.spec, filters: { ...draft.spec.filters, blackout: { enabled: true, session, timezone } } } });
                toast('News blackout applied to the current draft specification.');
              }}
            />
          )}
          {tab === 'sources' && <Sources r={r} />}
        </>
      )}
      {tab === 'resources' && <Resources />}
      {!r && tab !== 'resources' && (
        <div style={{ marginTop: 16 }}>
          <button className="btn ghost sm" onClick={() => setTab('resources')}>
            Browse the reference library →
          </button>
        </div>
      )}
    </div>
  );
}

function Briefing({ r, onUse }: { r: ResearchReport; onUse: (tpl: string, symbol: string) => void }) {
  return (
    <div className="split">
      <Card title={r.briefing.source === 'llm' ? `AI briefing (${r.briefing.model})` : 'Briefing (rule-based)'} actions={<Badge tone={r.briefing.source === 'llm' ? 'info' : 'neutral'}>{r.briefing.source === 'llm' ? 'cites headlines [n]' : 'computed from data'}</Badge>}>
        {r.briefing.error && <div className="notice warn" style={{ marginBottom: 10 }}>{r.briefing.error}</div>}
        <Markdown text={r.briefing.markdown} />
        {r.briefing.source === 'llm' && (
          <p className="muted small">
            Citations [n] refer to the numbered headlines in the News tab order. AI text can be wrong — check the sources.
          </p>
        )}
      </Card>
      <div className="col">
        <Card title="Strategy fit by regime">
          {r.strategyIdeas.length === 0 && <p className="muted small">No price data available for regime analysis.</p>}
          {r.strategyIdeas.map((s) => (
            <div key={s.symbol} style={{ marginBottom: 10 }}>
              <div className="row">
                <strong>{s.symbol}</strong>
                <span className="muted small">{s.regime}</span>
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                {s.templates.map((t) => (
                  <button key={t.id} className="chip" onClick={() => onUse(t.id, s.symbol)} title="Open in the Strategy Builder">
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="muted small">Heuristic mapping of recent behaviour to strategy families (trend vs. range vs. compression). Not a forecast.</p>
        </Card>
        <Card title="Sentiment gauges">
          <dl className="kv">
            <dt>Headline tone (proxy)</dt>
            <dd>{r.overallTone === null ? '—' : `${r.overallTone >= 0 ? '+' : ''}${r.overallTone.toFixed(2)} (${r.overallTone > 0.1 ? 'positive' : r.overallTone < -0.1 ? 'negative' : 'mixed'})`}</dd>
            <dt>Crypto Fear & Greed</dt>
            <dd>{r.cryptoFearGreed ? `${r.cryptoFearGreed.value} — ${r.cryptoFearGreed.label}` : 'unavailable'}</dd>
          </dl>
          {r.cryptoFearGreed && <Sparkline values={r.cryptoFearGreed.history} width={260} height={40} label="Crypto Fear & Greed, last 30 days" />}
        </Card>
        <div className="notice small">
          {r.disclaimers.map((d) => (
            <div key={d}>• {d}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Markets({ r }: { r: ResearchReport }) {
  return (
    <Card pad={false}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th className="num">Last</th>
              <th className="num">1D</th>
              <th className="num">1W</th>
              <th className="num">1M</th>
              <th className="num">3M</th>
              <th>90 days</th>
              <th>Regime</th>
              <th>Volatility</th>
              <th className="num">RSI</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {r.markets.map((m) => (
              <tr key={m.symbol}>
                <td>
                  <strong>{m.symbol}</strong>
                  <div className="muted small">{m.name}</div>
                </td>
                {m.ok && m.regime ? (
                  <>
                    <td className="num">{m.regime.last.toPrecision(6)}</td>
                    <td className="num">{fmtPct(m.regime.change.d1)}</td>
                    <td className="num">{fmtPct(m.regime.change.w1)}</td>
                    <td className="num">{fmtPct(m.regime.change.m1)}</td>
                    <td className="num">{fmtPct(m.regime.change.m3)}</td>
                    <td>{m.closes && <Sparkline values={m.closes} label={`${m.name} daily closes`} />}</td>
                    <td title={m.regime.rationale}>
                      <Badge tone={m.regime.regime === 'Uptrend' ? 'good' : m.regime.regime === 'Downtrend' ? 'bad' : 'neutral'}>{m.regime.regime}</Badge>
                    </td>
                    <td>
                      {m.regime.volatility}
                      {m.regime.volPercentile !== null && <span className="muted small"> ({fmt(m.regime.volPercentile, 0)}th pct)</span>}
                    </td>
                    <td className="num">{fmt(m.regime.rsi14, 0)}</td>
                    <td className="small muted">
                      {m.provider}
                      {m.providerNote && <div>{m.providerNote}</div>}
                    </td>
                  </>
                ) : (
                  <td colSpan={10} className="small muted">
                    Unavailable — {m.error}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ padding: '0 16px 12px' }}>
        Regime = efficiency ratio + 50/200-bar averages; volatility percentile vs. the past year. Hover a regime for its rationale. Unavailable rows show which providers failed (Yahoo Finance rate-limits heavy use; add a Twelve Data key for fallbacks).
      </p>
    </Card>
  );
}

function News({ r }: { r: ResearchReport }) {
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState('');
  const [asset, setAsset] = useState('');
  const items = useMemo(() => {
    const base = asset ? r.newsByAsset[asset] ?? [] : r.news;
    return base
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => (!q || `${n.title} ${n.summary ?? ''} ${n.source}`.toLowerCase().includes(q.toLowerCase())) && (!topic || topicsOf(`${n.title} ${n.summary ?? ''}`).includes(topic)));
  }, [r, q, topic, asset]);
  return (
    <Card pad={false}>
      <div className="row" style={{ padding: 12 }}>
        <input type="search" placeholder="Search headlines…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select value={topic} onChange={(e) => setTopic(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">All themes</option>
          {r.topics.map((t) => (
            <option key={t.topic}>{t.topic}</option>
          ))}
        </select>
        <select value={asset} onChange={(e) => setAsset(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All assets</option>
          {Object.keys(r.newsByAsset).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <span className="muted small">{items.length} shown</span>
      </div>
      <div className="list">
        {items.slice(0, 200).map(({ n, i }) => {
          const tn = tone(`${n.title} ${n.summary ?? ''}`);
          return (
            <div key={n.link + i} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className="muted small num" style={{ width: 34 }}>
                {asset ? '' : `[${i + 1}]`}
              </span>
              <div className="grow">
                <a href={n.link} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 550, color: 'var(--ink)' }}>
                  {n.title}
                </a>
                {n.summary && <div className="small muted" style={{ marginTop: 2 }}>{n.summary}</div>}
                <div className="row small" style={{ marginTop: 4 }}>
                  <span className="muted">{n.source}</span>
                  {n.published && <span className="muted">· {ago(n.published)}</span>}
                  {topicsOf(n.title).slice(0, 3).map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                  {tn !== 0 && <span className="muted">· tone {tn > 0 ? '▲' : '▼'}</span>}
                </div>
              </div>
            </div>
          );
        })}
        {!items.length && <Empty>No headlines match.</Empty>}
      </div>
    </Card>
  );
}

function Themes({ r }: { r: ResearchReport }) {
  return (
    <div className="grid g2">
      <Card title="Most-covered themes (headline count)">
        <HBars
          items={r.topics.map((t) => ({
            label: t.topic,
            value: t.count,
            note: t.delta === null ? undefined : <span className="muted">({t.delta >= 0 ? '+' : ''}{t.delta})</span>,
          }))}
        />
        <p className="muted small">Bracketed numbers compare with the previous report. Counts depend on which feeds responded.</p>
      </Card>
      <Card title="Theme tone (keyword proxy)">
        <table>
          <thead>
            <tr>
              <th>Theme</th>
              <th className="num">Headlines</th>
              <th className="num">Tone</th>
              <th>Reading</th>
            </tr>
          </thead>
          <tbody>
            {r.topics.map((t) => (
              <tr key={t.topic}>
                <td>{t.topic}</td>
                <td className="num">{t.count}</td>
                <td className="num">{t.tone >= 0 ? '+' : ''}{t.tone.toFixed(2)}</td>
                <td>{t.tone >= 0.15 ? <Badge tone="good">▲ positive</Badge> : t.tone <= -0.15 ? <Badge tone="bad">▼ negative</Badge> : <Badge>mixed</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Tone counts positive vs. negative market words in headlines. It is a rough proxy, not a validated sentiment model.</p>
      </Card>
    </div>
  );
}

function Calendar({ r, canApply, apply }: { r: ResearchReport; canApply: boolean; apply: (session: string, tz: string) => void }) {
  if (!r.calendar) return <Card><Empty>The economic calendar was unavailable for this report.</Empty></Card>;
  return (
    <div className="split">
      <Card title="Upcoming high & medium impact events (this week)" pad={false}>
        {r.calendar.events.length === 0 ? (
          <Empty>No remaining high/medium-impact events in this week's calendar feed.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time (your local)</th>
                <th>Country</th>
                <th>Event</th>
                <th>Impact</th>
                <th className="num">Forecast</th>
                <th className="num">Previous</th>
              </tr>
            </thead>
            <tbody>
              {r.calendar.events.map((e, i) => (
                <tr key={i}>
                  <td className="nowrap">{new Date(e.time).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</td>
                  <td>{e.country}</td>
                  <td>{e.title}</td>
                  <td>
                    <Badge tone={e.impact === 'High' ? 'bad' : 'warn'}>{e.impact === 'High' ? '● High' : '◐ Medium'}</Badge>
                  </td>
                  <td className="num">{e.forecast ?? '—'}</td>
                  <td className="num">{e.previous ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Suggested news blackout windows">
        <p className="muted small" style={{ marginTop: 0 }}>
          ±15 minutes around high-impact releases (New York time). Use them in a script's “News blackout window” filter so no new entries open into scheduled volatility. Pine sessions repeat daily — apply the window on event days.
        </p>
        {r.calendar.blackouts.length === 0 && <p className="small">No high-impact events remaining.</p>}
        {r.calendar.blackouts.map((b, i) => (
          <div key={i} className="row" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
            <code>{b.session}</code>
            <span className="small grow">{b.label}</span>
            <button className="btn sm" onClick={() => copyText(b.session)}>
              Copy
            </button>
            {canApply && (
              <button className="btn sm" onClick={() => apply(b.session, b.timezone)}>
                Apply to draft
              </button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

function Sources({ r }: { r: ResearchReport }) {
  return (
    <Card pad={false}>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Source</th>
            <th>Category</th>
            <th className="num">Items</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {r.sources.map((s) => (
            <tr key={s.id}>
              <td>{s.ok ? <Badge tone="good">✓ OK</Badge> : <Badge tone="bad">✕ failed</Badge>}</td>
              <td>{s.url ? <a href={s.url.includes('news.google.com/rss') ? s.url.replace('/rss/search', '/search') : s.url} target="_blank" rel="noopener noreferrer">{s.name}</a> : s.name}</td>
              <td className="muted">{s.category}</td>
              <td className="num">{s.count}</td>
              <td className="small muted">{s.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Resources() {
  const [all, setAll] = useState<Resource[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  useEffect(() => {
    api.resources().then(setAll);
  }, []);
  const cats = [...new Set(all.map((x) => x.category))];
  const list = all.filter((x) => (!cat || x.category === cat) && (!q || `${x.title} ${x.description}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="col">
      <div className="row">
        <input type="search" placeholder="Search references…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>
          All ({all.length})
        </button>
        {cats.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? '' : c)}>
            {c}
          </button>
        ))}
      </div>
      {cats
        .filter((c) => !cat || c === cat)
        .map((c) => {
          const items = list.filter((x) => x.category === c);
          if (!items.length) return null;
          return (
            <Card key={c} title={c} pad={false}>
              <div className="list">
                {items.map((x) => (
                  <div key={x.title} className="list-item">
                    <div className="grow">
                      {x.url ? (
                        <a href={x.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 550 }}>
                          {x.title} ↗
                        </a>
                      ) : (
                        <strong>{x.title}</strong>
                      )}
                      <div className="small muted">{x.description}</div>
                    </div>
                    <Badge tone={x.cost === 'free' ? 'good' : x.cost === 'freemium' ? 'info' : 'neutral'}>{x.cost}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
    </div>
  );
}
