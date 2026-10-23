import { useEffect, useState } from 'react';
import { api, type WatchItem } from '../api';
import { Badge, Card, Field, Icon, NumberInput, useApp } from '../components/ui';

export function SettingsPage() {
  const { settings, reloadSettings, toast } = useApp();
  const [minutes, setMinutes] = useState(0);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [add, setAdd] = useState({ symbol: '', name: '', query: '', kind: 'yahoo', id: '' });
  useEffect(() => {
    if (settings) {
      setMinutes(settings.autoRefreshMinutes);
      setWatch(settings.watchlist);
    }
  }, [settings]);
  if (!settings) return null;
  const save = (patch: Parameters<typeof api.saveSettings>[0]) =>
    api
      .saveSettings(patch)
      .then(() => (toast('Settings saved.'), reloadSettings()))
      .catch((e) => toast(e.message, 'bad'));
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>AI provider status, market-research schedule and watchlist. API keys are read from the server's environment (.env) and never sent to the browser.</p>
        </div>
      </div>
      <div className="grid g2">
        <Card title="AI provider (optional)">
          <dl className="kv">
            <dt>Status</dt>
            <dd>{settings.llm.configured ? <Badge tone="good">Connected</Badge> : <Badge>Not configured</Badge>}</dd>
            <dt>Provider</dt>
            <dd>{settings.llm.provider}</dd>
            <dt>Model</dt>
            <dd>{settings.llm.model ?? '—'}</dd>
          </dl>
          <p className="small muted">{settings.llm.note}</p>
          <pre className="code-box">{`# .env (server side)
ANTHROPIC_API_KEY=...          # Claude (default model claude-opus-5-5)
# or any OpenAI-compatible endpoint (Ollama, LM Studio, …)
LLM_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=http://localhost:11434/v1
OPENAI_COMPAT_MODEL=llama3.1`}</pre>
          <p className="small muted">The AI only converts requests into a structured specification and writes research briefings from fetched sources. Pine code is always produced by the vetted generator, never free-written by the AI.</p>
        </Card>
        <Card title="Market research schedule">
          <Field label="Auto-refresh every (minutes, 0 = off, min 15)" hint="Runs a quick scan in the background while the server is running.">
            <NumberInput value={minutes} min={0} max={1440} onChange={setMinutes} />
          </Field>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => save({ autoRefreshMinutes: minutes })}>
              Save schedule
            </button>
          </div>
          <p className="small muted">Twelve Data fallback for indices/ETFs: {settings.twelveDataConfigured ? <Badge tone="good">key set</Badge> : <Badge>not set (TWELVEDATA_API_KEY)</Badge>}</p>
        </Card>
      </div>
      <Card title="Research watchlist" actions={<button className="btn sm" onClick={() => (setWatch(settings.defaultWatchlist), save({ watchlist: settings.defaultWatchlist }))}>Reset to default</button>} pad={false}>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>News query</th>
              <th>Price providers (in order)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {watch.map((w, i) => (
              <tr key={w.symbol + i}>
                <td>
                  <strong>{w.symbol}</strong>
                </td>
                <td>{w.name}</td>
                <td className="muted">{w.query}</td>
                <td className="small">{w.providers.map((p) => (p.kind === 'yahoo' ? `Yahoo ${p.ticker}` : p.kind === 'binance' ? `Binance ${p.pair}` : p.kind === 'twelvedata' ? `TwelveData ${p.symbol}` : `ECB ${p.base}/${p.quote}`)).join(' → ')}</td>
                <td className="right">
                  <button className="btn sm ghost danger" onClick={() => setWatch(watch.filter((_, k) => k !== i))}>
                    <Icon name="trash" size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-body">
          <div className="fields">
            <Field label="Symbol">
              <input value={add.symbol} onChange={(e) => setAdd({ ...add, symbol: e.target.value.toUpperCase() })} placeholder="AAPL" />
            </Field>
            <Field label="Name">
              <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Apple" />
            </Field>
            <Field label="News search query">
              <input value={add.query} onChange={(e) => setAdd({ ...add, query: e.target.value })} placeholder="Apple stock" />
            </Field>
            <Field label="Price provider">
              <select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}>
                <option value="yahoo">Yahoo Finance ticker</option>
                <option value="binance">Binance pair</option>
                <option value="twelvedata">Twelve Data symbol (key needed)</option>
              </select>
            </Field>
            <Field label="Ticker / pair">
              <input value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })} placeholder={add.kind === 'binance' ? 'SOLUSDT' : 'AAPL'} />
            </Field>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={!add.symbol || !add.id}
              onClick={() => {
                const provider = add.kind === 'binance' ? { kind: 'binance' as const, pair: add.id.toUpperCase() } : add.kind === 'twelvedata' ? { kind: 'twelvedata' as const, symbol: add.id.toUpperCase() } : { kind: 'yahoo' as const, ticker: add.id };
                setWatch([...watch, { symbol: add.symbol, name: add.name || add.symbol, query: add.query || add.name || add.symbol, providers: [provider], periodsPerYear: add.kind === 'binance' ? 365 : 252 }]);
                setAdd({ symbol: '', name: '', query: '', kind: add.kind, id: '' });
              }}
            >
              <Icon name="plus" size={15} /> Add to list
            </button>
            <button className="btn primary" onClick={() => save({ watchlist: watch })}>
              Save watchlist
            </button>
          </div>
        </div>
      </Card>
      <Card title="About & disclaimer" className="">
        <p style={{ marginTop: 0 }}>
          Pine Forge generates educational Pine Script v6 code from transparent, documented rules. Backtests are hypothetical and do not account for every real-world cost or execution effect. Nothing in this application is investment advice, and no strategy is guaranteed to be profitable. Validate out-of-sample and paper-trade before risking capital.
        </p>
      </Card>
    </div>
  );
}
