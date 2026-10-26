// Administrator view: usage, script reliability, data-provider health and strategy review status.
// Protected server-side by ADMIN_TOKEN; review decisions are logged and never alter measured performance.
import { useEffect, useState } from 'react';
import { api, type AdminOverview, type Rankings, type ReviewStatus, type StrategyInfo } from '../api';
import { ago, Badge, Card, Empty, fmt, Spinner, useApp } from '../components/ui';

const STATUSES: ReviewStatus[] = ['experimental', 'awaiting_validation', 'approved', 'deprecated'];

function Counts({ title, rows, label }: { title: string; rows: { key: string; count: number }[]; label?: (k: string) => string }) {
  return (
    <Card title={title}>
      {!rows.length ? (
        <Empty>No activity recorded yet.</Empty>
      ) : (
        <table className="table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{label ? label(r.key) : r.key || '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {r.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function Admin() {
  const { toast } = useApp();
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem('pf-admin-token') ?? '';
    } catch {
      return '';
    }
  });
  const [data, setData] = useState<AdminOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rank, setRank] = useState<Rankings | null>(null);
  const [thr, setThr] = useState({ minTrades: 30, minOos: 10 });

  const load = async (t = token) => {
    setBusy(true);
    setErr(null);
    try {
      const d = await api.admin(t);
      setData(d);
      setThr(d.ranking);
      try {
        sessionStorage.setItem('pf-admin-token', t);
      } catch {
        /* storage unavailable */
      }
    } catch (e) {
      setErr((e as Error).message);
      setData(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    api.strategies().then(setStrategies).catch(() => undefined);
    if (token) load(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nameOf = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;

  const review = async (id: string, status: ReviewStatus) => {
    try {
      await api.adminReview(token, id, status, notes[id] ?? '');
      toast(`${nameOf(id)} → ${status.replace('_', ' ')}`, 'ok');
      load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Administrator</h1>
          <p>Usage, script reliability, data-provider health and strategy review. Popularity and validated performance are shown separately; review decisions are logged and never change the measured results.</p>
        </div>
      </div>
      <div className="row mb" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 320 }}>
          Admin token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Value of ADMIN_TOKEN on the server" autoComplete="off" />
        </label>
        <button className="btn primary" onClick={() => load()} disabled={busy || !token}>
          {busy ? <Spinner /> : 'Open'}
        </button>
      </div>
      {err && (
        <div className="card card-pad mb bad-ink" role="alert">
          {err}
        </div>
      )}
      {data && (
        <>
          <div className="grid g4 mb">
            <Counts title="Most activated strategies" rows={data.usage.strategies} label={nameOf} />
            <Counts title="Most saved strategies" rows={data.usage.saved} label={nameOf} />
            <Counts title="Most used assets" rows={data.usage.assets} />
            <Counts title="Most used timeframes" rows={data.usage.timeframes} />
          </div>

          <div className="grid g2 mb">
            <Card title="Data providers (since server start)">
              {!Object.keys(data.providers).length ? (
                <Empty>No requests yet.</Empty>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>OK</th>
                      <th>Failed</th>
                      <th>Success</th>
                      <th>Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.providers).map(([k, p]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="mono">{p.ok}</td>
                        <td className="mono">{p.fail}</td>
                        <td className="mono">{fmt((100 * p.ok) / Math.max(1, p.ok + p.fail), 0)}%</td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {p.lastError ? `${p.lastError} (${ago(p.lastErrorAt!)})` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Scripts & integrations">
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>
                  Stored scripts: <b>{data.scripts.total}</b> · awaiting a recorded TradingView compile: <b>{data.scripts.awaitingCompile.length}</b> · with validation errors: <b>{data.scripts.withErrors.length}</b>
                </div>
                <div>Dashboard script generation failure rate: {data.scripts.generationFailRate === null ? '—' : `${fmt(100 * data.scripts.generationFailRate, 1)}%`}</div>
                <div>
                  AI provider: {data.llm.provider}
                  {data.llm.model ? ` (${data.llm.model})` : ''} — {data.llm.configured ? 'configured' : 'not configured (rule-based fallback)'}
                </div>
                {data.signalErrors.length > 0 && (
                  <details>
                    <summary className="sum">Recent market-data failures ({data.signalErrors.length})</summary>
                    <ul className="checks">
                      {data.signalErrors.map((e, i) => (
                        <li key={i}>
                          {ago(e.at)} · {e.symbol} {e.tf}: {e.detail}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </Card>
          </div>

          <Card
            title="Strategy review"
            className="mb"
            actions={
              <div className="row">
                <label className="row" style={{ fontSize: 12 }}>
                  Min trades <input className="input-sm" style={{ width: 70 }} type="number" value={thr.minTrades} onChange={(e) => setThr({ ...thr, minTrades: Number(e.target.value) })} />
                </label>
                <label className="row" style={{ fontSize: 12 }}>
                  Min out-of-sample <input className="input-sm" style={{ width: 70 }} type="number" value={thr.minOos} onChange={(e) => setThr({ ...thr, minOos: Number(e.target.value) })} />
                </label>
                <button
                  className="btn sm"
                  onClick={async () => {
                    try {
                      await api.adminRanking(token, thr.minTrades, thr.minOos);
                      toast('Minimum evidence for rankings updated.', 'ok');
                    } catch (e) {
                      toast((e as Error).message, 'bad');
                    }
                  }}
                >
                  Save thresholds
                </button>
                <button className="btn sm" onClick={() => api.rankings({ source: 'binancef', ticker: 'XAUUSDT', tf: '60' }).then(setRank).catch((e) => toast((e as Error).message, 'bad'))}>
                  Load gold 1H evidence
                </button>
              </div>
            }
            pad={false}
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Status</th>
                    {rank && <th>Gold 1H evidence (after costs)</th>}
                    <th>Note (evidence for approval)</th>
                    <th>Set status</th>
                  </tr>
                </thead>
                <tbody>
                  {strategies.map((s) => {
                    const rv = data.reviews[s.id];
                    const rr = rank?.rows.find((r) => r.strategyId === s.id);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.name}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {s.category}
                          </div>
                        </td>
                        <td>
                          <Badge tone={rv?.status === 'approved' ? 'good' : rv?.status === 'deprecated' ? 'bad' : rv?.status === 'awaiting_validation' ? 'warn' : 'neutral'}>{(rv?.status ?? 'experimental').replace('_', ' ')}</Badge>
                          {rv?.note && (
                            <div className="muted" style={{ fontSize: 12 }}>
                              {rv.note}
                            </div>
                          )}
                        </td>
                        {rank && (
                          <td style={{ fontSize: 12 }}>
                            {rr ? (
                              <>
                                {rr.evidence === 'high' ? 'sufficient' : 'insufficient'} · {rr.all.trades} trades · OOS {rr.outOfSample.trades} @ {fmt(rr.outOfSample.expectancyR, 2)}R
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        <td>
                          <input className="input-sm" style={{ width: '100%' }} value={notes[s.id] ?? ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} placeholder="e.g. XAUUSDT 1H, Aug–Oct 2026, 46 trades, OOS +0.2R" />
                        </td>
                        <td>
                          <select value="" onChange={(e) => e.target.value && review(s.id, e.target.value as ReviewStatus)} aria-label={`Set status for ${s.name}`}>
                            <option value="">Change…</option>
                            {STATUSES.map((x) => (
                              <option key={x} value={x}>
                                {x.replace('_', ' ')}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Review log">
            {!data.reviewLog.length ? (
              <Empty>No review decisions yet.</Empty>
            ) : (
              <ul className="checks">
                {data.reviewLog.map((r, i) => (
                  <li key={i}>
                    {ago(r.at)} · {nameOf(r.strategyId)} → <b>{r.status.replace('_', ' ')}</b>
                    {r.note && ` — ${r.note}`}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
