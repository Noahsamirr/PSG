import { useCallback, useEffect, useState } from 'react';
import { api, type BacktestAnalysis, type BacktestSummary, type Metrics, type ScriptRow } from '../api';
import { DivergingBars, LineChart } from '../components/charts';
import { ago, Badge, Card, Empty, Field, fmt, fmtPct, Icon, NumberInput, Spinner, useApp } from '../components/ui';

const KIND_LABEL: Record<string, string> = { backtest: 'Backtest (in-sample)', out_of_sample: 'Out-of-sample', paper: 'Paper trading', live: 'Live trading' };

export function Backtests({ selected }: { selected?: string }) {
  const { toast, go } = useApp();
  const [runs, setRuns] = useState<BacktestSummary[] | null>(null);
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compare, setCompare] = useState<Awaited<ReturnType<typeof api.compare>> | null>(null);
  const load = useCallback(() => api.backtests().then(setRuns), []);
  useEffect(() => {
    load();
    api.scripts().then(setScripts);
  }, [load]);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Backtest Analysis</h1>
          <p>Import trades exported from TradingView's Strategy Tester and stress-test them: out-of-sample decay, walk-forward stability, higher costs, Monte Carlo drawdowns and overfitting flags. Every number here is computed from your imported trades — nothing is simulated or invented.</p>
        </div>
      </div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Importer scripts={scripts} onSaved={(id) => (load(), go(`/backtests/${id}`))} />
        <Card title="How to export from TradingView">
          <ol className="steps">
            <li>
              <span>Add the generated strategy to a chart and open the <strong>Strategy Tester</strong>.</span>
            </li>
            <li>
              <span>Set realistic <strong>Properties</strong> (capital, commission, slippage) and the date range you want.</span>
            </li>
            <li>
              <span>Open <strong>List of trades</strong> and use the export button to download it as CSV (availability depends on your TradingView plan).</span>
            </li>
            <li>
              <span>Upload or paste the CSV here. Label each run as backtest, out-of-sample, paper or live — they are never mixed.</span>
            </li>
          </ol>
          <p className="muted small">
            No export option? Paste a simple CSV with columns <code>date,profit</code> (one row per closed trade) — that is the manual-entry format. Columns are matched by name: Trade #, Type, Date/Time, Price, Contracts/Qty, Profit or Net P&amp;L.
          </p>
        </Card>
      </div>
      <Card
        title="Imported runs"
        pad={false}
        actions={
          <button
            className="btn sm"
            disabled={compareIds.length < 2}
            onClick={() =>
              api
                .compare(compareIds)
                .then(setCompare)
                .catch((e) => toast(e.message, 'bad'))
            }
          >
            Compare selected ({compareIds.length})
          </button>
        }
      >
        {runs === null ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : runs.length === 0 ? (
          <Empty>No results imported yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Run</th>
                  <th>Type</th>
                  <th>Script</th>
                  <th className="num">Trades</th>
                  <th className="num">Net profit</th>
                  <th className="num">Profit factor</th>
                  <th className="num">Win rate</th>
                  <th className="num">Max DD</th>
                  <th>Imported</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => go(`/backtests/${r.id}`)} style={{ background: r.id === selected ? 'var(--accent-soft)' : undefined }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Select for comparison" checked={compareIds.includes(r.id)} onChange={(e) => setCompareIds(e.target.checked ? [...compareIds, r.id] : compareIds.filter((x) => x !== r.id))} />
                    </td>
                    <td>{r.label}</td>
                    <td>
                      <Badge tone={r.kind === 'live' ? 'good' : r.kind === 'backtest' ? 'neutral' : 'info'}>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                    </td>
                    <td className="muted">{scripts.find((s) => s.id === r.scriptId)?.name ?? '—'}</td>
                    <td className="num">{r.tradeCount}</td>
                    <td className="num">{fmt(r.metrics.netProfit)}</td>
                    <td className="num">{fmt(r.metrics.profitFactor)}</td>
                    <td className="num">{fmtPct(r.metrics.winRate, 1, false)}</td>
                    <td className="num">{fmt(r.metrics.maxDrawdown)}</td>
                    <td className="muted">{ago(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {compare && (
        <Card title="Parameter / run stability" actions={<button className="btn sm ghost" onClick={() => setCompare(null)}>Close</button>} className="" >
          <div className={`notice ${compare.stability.cvNetProfit !== null && compare.stability.cvNetProfit > 1 ? 'warn' : ''}`}>{compare.stability.message}</div>
          <MetricsTable rows={compare.runs.map((r) => ({ label: `${r.label} (${KIND_LABEL[r.kind] ?? r.kind})`, m: r.metrics }))} />
        </Card>
      )}
      {selected && <Analysis key={selected} id={selected} onDeleted={() => (load(), go('/backtests'))} />}
    </div>
  );
}

function Importer({ scripts, onSaved }: { scripts: ScriptRow[]; onSaved: (id: string) => void }) {
  const { toast } = useApp();
  const [csv, setCsv] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('backtest');
  const [scriptId, setScriptId] = useState('');
  const [capital, setCapital] = useState(10000);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.parseBacktest>> | null>(null);
  const readFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => {
      setCsv(String(r.result));
      if (!label) setLabel(f.name.replace(/\.[^.]+$/, ''));
    };
    r.readAsText(f);
  };
  return (
    <Card title="Import results">
      <div className="col">
        <div className="row">
          <input type="file" accept=".csv,.txt" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} aria-label="CSV file" style={{ height: 'auto', border: 0, padding: 0 }} />
        </div>
        <textarea rows={5} className="mono" placeholder="…or paste CSV here" value={csv} onChange={(e) => (setCsv(e.target.value), setPreview(null))} />
        <div className="fields">
          <Field label="Label">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. XAUUSD 15m 2022–2024" />
          </Field>
          <Field label="Result type">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Linked script">
            <select value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
              <option value="">— none —</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Initial capital">
            <NumberInput value={capital} min={1} onChange={setCapital} />
          </Field>
        </div>
        <div className="row">
          <button className="btn" disabled={!csv.trim()} onClick={() => api.parseBacktest(csv, capital).then(setPreview).catch((e) => toast(e.message, 'bad'))}>
            Preview
          </button>
          <button
            className="btn primary"
            disabled={!csv.trim() || !label.trim()}
            onClick={() =>
              api
                .saveBacktest({ csv, label, kind, scriptId: scriptId || null, initialCapital: capital })
                .then((r) => {
                  toast(`Imported.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`);
                  setCsv('');
                  setPreview(null);
                  onSaved(r.backtest.id);
                })
                .catch((e) => toast(e.message, 'bad'))
            }
          >
            <Icon name="download" size={16} /> Import
          </button>
        </div>
        {preview && (
          <div className="notice">
            <strong>{preview.trades.length}</strong> trades detected ({preview.format}). Net {fmt(preview.metrics.netProfit)} · PF {fmt(preview.metrics.profitFactor)}.
            <div className="small muted">
              Columns: {Object.entries(preview.columns)
                .map(([k, v]) => `${k} → ${v ?? 'not found'}`)
                .join(' · ')}
            </div>
            {preview.warnings.map((w) => (
              <div key={w} className="small">
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function MetricsTable({ rows }: { rows: { label: string; m: Metrics }[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th />
            <th className="num">Trades</th>
            <th className="num">Win %</th>
            <th className="num">Profit factor</th>
            <th className="num">Expectancy</th>
            <th className="num">Payoff</th>
            <th className="num">Net</th>
            <th className="num">Max DD</th>
            <th className="num">t-stat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, m }) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{m.trades}</td>
              <td className="num">{fmt(m.winRate, 1)}</td>
              <td className="num">{fmt(m.profitFactor)}</td>
              <td className="num">{fmt(m.expectancy)}</td>
              <td className="num">{fmt(m.payoffRatio)}</td>
              <td className="num">{fmt(m.netProfit)}</td>
              <td className="num">{fmt(m.maxDrawdown)}</td>
              <td className="num">{fmt(m.tStat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Analysis({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { toast } = useApp();
  const [q, setQ] = useState({ ratio: 0.7, folds: 5, costPct: 0.05, costCash: 0 });
  const [data, setData] = useState<{ backtest: BacktestSummary; analysis: BacktestAnalysis } | null>(null);
  useEffect(() => {
    api
      .analysis(id, q)
      .then((d) => setData({ backtest: d.backtest, analysis: d.analysis }))
      .catch((e) => toast(e.message, 'bad'));
  }, [id, q, toast]);
  if (!data) return <div className="empty"><Spinner /></div>;
  const { analysis: a, backtest: b } = data;
  const m = a.metrics;
  const tile = (label: string, value: string, sub?: string) => (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
  return (
    <div className="col" style={{ marginTop: 16 }}>
      <div className="row">
        <h2>{b.label}</h2>
        <Badge tone="info">{KIND_LABEL[b.kind] ?? b.kind}</Badge>
        <span className="spacer" />
        <button className="btn sm ghost danger" onClick={() => confirm('Delete this imported run?') && api.deleteBacktest(id).then(onDeleted)}>
          <Icon name="trash" size={15} /> Delete run
        </button>
      </div>
      <div className="grid g4">
        {tile('Net profit', fmt(m.netProfit), `${m.trades} trades`)}
        {tile('Profit factor', fmt(m.profitFactor), `win rate ${fmtPct(m.winRate, 1, false)}`)}
        {tile('Expectancy / trade', fmt(m.expectancy), `payoff ratio ${fmt(m.payoffRatio)}`)}
        {tile('Max drawdown', fmt(m.maxDrawdown), m.maxDrawdownPct !== null ? `${fmt(m.maxDrawdownPct, 1)}% of peak equity` : 'closed-trade equity')}
      </div>
      <div className="grid g2">
        <Card title="Robustness flags">
          {a.flags.map((f) => (
            <div key={f.code} className="diag">
              <span className={`sev ${f.level === 'warning' ? 'warning' : f.level === 'ok' ? 'info' : 'info'}`}>{f.level === 'warning' ? '!' : f.level === 'ok' ? '✓' : 'i'}</span>
              <span>{f.message}</span>
            </div>
          ))}
          <p className="muted small">Flags are statistical warnings, not proof. Results from a single market and period are weak evidence.</p>
        </Card>
        <Card title="Closed-trade equity">
          <LineChart values={a.equity} baseline={b.initialCapital ?? 0} ariaLabel={`Equity after each of ${m.trades} trades`} />
        </Card>
      </div>
      <Card
        title="Out-of-sample & walk-forward"
        actions={
          <div className="row">
            <Field label="In-sample share">
              <select value={q.ratio} onChange={(e) => setQ({ ...q, ratio: Number(e.target.value) })}>
                {[0.5, 0.6, 0.7, 0.8].map((r) => (
                  <option key={r} value={r}>
                    {r * 100}% / {100 - r * 100}%
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Segments">
              <select value={q.folds} onChange={(e) => setQ({ ...q, folds: Number(e.target.value) })}>
                {[3, 4, 5, 6, 8, 10].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          Chronological split: the first {Math.round(a.ratio * 100)}% of trades vs. the rest. This is an approximation — a true out-of-sample test re-runs the strategy on data that was never used to choose its parameters (import that run as “Out-of-sample”).
        </p>
        <MetricsTable
          rows={[
            { label: 'All trades', m },
            { label: 'In-sample (earlier)', m: a.inSample },
            { label: 'Out-of-sample (later)', m: a.outSample },
            { label: 'Longs only', m: a.long },
            { label: 'Shorts only', m: a.short },
          ]}
        />
        <h4 style={{ margin: '16px 0 8px' }}>Net profit per chronological segment</h4>
        <DivergingBars items={a.walkForward.map((f) => ({ label: `#${f.fold}`, value: f.metrics.netProfit, detail: `(${f.metrics.trades} trades, PF ${fmt(f.metrics.profitFactor)})` }))} ariaLabel="Net profit per segment" />
      </Card>
      <div className="grid g2">
        <Card
          title="Cost stress test"
          actions={
            <div className="row">
              <Field label="Extra cost % per side">
                <NumberInput value={q.costPct} min={0} step={0.01} onChange={(v) => setQ({ ...q, costPct: v })} />
              </Field>
              <Field label="+ cash per trade">
                <NumberInput value={q.costCash} min={0} onChange={(v) => setQ({ ...q, costCash: v })} />
              </Field>
            </div>
          }
        >
          <table>
            <thead>
              <tr>
                <th>Added cost</th>
                <th className="num">Net</th>
                <th className="num">PF</th>
                <th className="num">Expectancy</th>
              </tr>
            </thead>
            <tbody>
              {a.costStress.map((c) => (
                <tr key={c.multiplier}>
                  <td>{c.multiplier === 0 ? 'As exported' : `+${c.multiplier}× extra cost`}</td>
                  <td className="num">{fmt(c.metrics.netProfit)}</td>
                  <td className="num">{fmt(c.metrics.profitFactor)}</td>
                  <td className="num">{fmt(c.metrics.expectancy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Uses entry price × quantity from the export. Strategies whose edge disappears at 2× costs are fragile.</p>
        </Card>
        <Card title="Monte Carlo (trade resampling)">
          {a.monteCarlo ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th />
                    <th className="num">5th pct</th>
                    <th className="num">Median</th>
                    <th className="num">95th pct</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Max drawdown</td>
                    <td className="num">{fmt(a.monteCarlo.maxDrawdown.p5)}</td>
                    <td className="num">{fmt(a.monteCarlo.maxDrawdown.p50)}</td>
                    <td className="num">{fmt(a.monteCarlo.maxDrawdown.p95)}</td>
                  </tr>
                  <tr>
                    <td>Net profit</td>
                    <td className="num">{fmt(a.monteCarlo.netProfit.p5)}</td>
                    <td className="num">{fmt(a.monteCarlo.netProfit.p50)}</td>
                    <td className="num">{fmt(a.monteCarlo.netProfit.p95)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="small">Share of resampled paths ending with a loss: <strong>{fmtPct(a.monteCarlo.probLoss * 100, 1, false)}</strong></p>
              <p className="muted small">{a.monteCarlo.iterations} bootstrap paths of the same trades in random order (with replacement). Shows path risk; assumes trades are independent, which they may not be.</p>
            </>
          ) : (
            <Empty>Needs at least 5 trades.</Empty>
          )}
        </Card>
      </div>
      <Card title="Trade statistics">
        <dl className="kv">
          <dt>Wins / losses</dt>
          <dd>
            {m.wins} / {m.losses}
          </dd>
          <dt>Gross profit / loss</dt>
          <dd>
            {fmt(m.grossProfit)} / {fmt(m.grossLoss)}
          </dd>
          <dt>Average win / loss</dt>
          <dd>
            {fmt(m.avgWin)} / {fmt(m.avgLoss)}
          </dd>
          <dt>Max consecutive losses</dt>
          <dd>{m.maxConsecutiveLosses}</dd>
          <dt>Average duration</dt>
          <dd>{m.avgDurationHours !== null ? `${fmt(m.avgDurationHours, 1)} h` : '—'}</dd>
          <dt>Period</dt>
          <dd>{m.firstTime ? `${new Date(m.firstTime).toISOString().slice(0, 10)} → ${new Date(m.lastTime!).toISOString().slice(0, 10)}` : '—'}</dd>
        </dl>
      </Card>
    </div>
  );
}
