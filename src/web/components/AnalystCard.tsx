// The trade analyst panel: one button; the rule-based analyst and every AI configured on the server (Gemini ×2, Groq,
// Mistral, …) weigh every strategy on 5m–1H, the next triggers, news and the daily picture, then vote on one plan.
import { useState } from 'react';
import { api, type AnalystResponse, type AnalystRun } from '../api';
import type { AnalystDecision } from '../../core/analyst';
import { tfLabel } from '../../core/timeframe';
import { Badge, fmt, Spinner } from './ui';

const actionClass = (a: string) => (a === 'BUY' ? 'good-ink' : a === 'SELL' ? 'bad-ink' : 'muted');

export function AnalystCard({ source, ticker, focusTf, strategies, live, dp }: { source: string; ticker: string; focusTf: string; strategies: string[]; live: boolean; dp: number }) {
  const [res, setRes] = useState<AnalystResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = (x: number) => fmt(x, dp);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.analyst({ source, ticker, focusTf, strategies, live }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const d = res?.decision;
  const buy = d?.action === 'BUY';
  const how =
    !d || d.action === 'WAIT' || d.entry === null
      ? ''
      : d.entryType === 'market'
        ? `${buy ? 'Buy' : 'Sell'} now at the market, around ${f(d.entry)}`
        : d.entryType === 'limit'
          ? `Place a limit order to ${buy ? 'buy' : 'sell'} at ${f(d.entry)} (wait for the price to come back)`
          : `${buy ? 'Buy' : 'Sell'} only if a ${tfLabel(d.timeframe)} candle closes ${buy ? 'above' : 'below'} ${f(d.entry)}`;
  const ai = res?.analysts.filter((a) => a.kind === 'ai') ?? [];
  const chosen = res?.analysts.find((a) => a.id === res.verdict.chosenFrom);
  return (
    <div className={`analyst mb ${d ? (d.action === 'BUY' ? 'buy' : d.action === 'SELL' ? 'sell' : 'wait') : ''}`}>
      <div className="analyst-head">
        <div>
          <b>Trade analyst panel</b>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Several analysts study all 15 strategies on 5m, 15m, 30m and 1H, their track records, the next trigger prices, news and the daily picture. Each answers on its own; a trade is shown only when most of them agree.
          </div>
        </div>
        <button className="btn primary" onClick={run} disabled={busy}>
          {busy ? (
            <>
              <Spinner /> Analysts thinking…
            </>
          ) : res ? (
            'Analyse again'
          ) : (
            'Analyse now'
          )}
        </button>
      </div>
      {busy && <div className="muted" style={{ fontSize: 13 }}>Asking every analyst at the same time (free AI services can take up to a minute)…</div>}
      {err && <div className="bad-ink">{err}</div>}
      {res && d && (
        <>
          <div className="analyst-action">
            <span>{d.action}</span>
            <span className="analyst-headline">{res.verdict.summary}</span>
            <Badge tone={d.confidence === 'high' ? 'good' : d.confidence === 'medium' ? 'warn' : 'neutral'}>{d.confidence} confidence</Badge>
          </div>

          <div className="simple-words">
            <b>In simple words: </b>
            {simpleWords(d, res, f)}
          </div>

          {d.action !== 'WAIT' && d.entry !== null && d.stopLoss !== null && (
            <>
              <div className="analyst-how">{how}</div>
              <div className="answer-levels">
                <div>
                  <span>Entry</span>
                  <b className="mono">{f(d.entry)}</b>
                </div>
                <div className="good">
                  <span>Take profit{d.takeProfits.length > 1 ? 's' : ''}</span>
                  <b className="mono">{d.takeProfits.map(f).join(' · ')}</b>
                </div>
                <div className="bad">
                  <span>Stop loss</span>
                  <b className="mono">{f(d.stopLoss)}</b>
                </div>
              </div>
              <div style={{ fontSize: 13.5 }}>
                <span className="muted">Reward</span> <b>{d.rewardRisk !== null ? `${fmt(d.rewardRisk, 1)}×` : '—'}</b> <span className="muted">the risk</span>
                {d.measuredChance && (
                  <>
                    {' · '}
                    <span className="muted">measured chance of profit</span> <b>{Math.round(d.measuredChance.p * 100)}%</b> <span className="muted">({Math.round(d.measuredChance.p * d.measuredChance.n)} of {d.measuredChance.n} past trades)</span>
                  </>
                )}
                {' · '}
                <span className="muted">{tfLabel(d.timeframe)} chart{chosen ? ` · levels from ${chosen.name}` : ''}</span>
              </div>
            </>
          )}
          {res.verdict.waitFor.length > 0 && (
            <div className="analyst-wait">
              <b>{d.action === 'WAIT' ? 'What to wait for:' : 'Conditions:'}</b>
              {res.verdict.waitFor.length === 1 ? (
                <> {res.verdict.waitFor[0]}</>
              ) : (
                <ul className="checks" style={{ margin: '4px 0 0' }}>
                  {res.verdict.waitFor.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="panel-votes">
            {res.analysts.map((a) => (
              <span key={a.id} className={`vote ${a.decision ? a.decision.action.toLowerCase() : 'none'}`} title={a.error ?? a.problems.join(' ') ?? ''}>
                {a.name}: <b>{a.decision ? a.decision.action : a.status === 'duplicate' ? 'not counted' : 'no answer'}</b>
              </span>
            ))}
          </div>

          {res.context && <BigPicture ctx={res.context} />}

          <div className="analyst-cols">
            <div>
              <b>Why</b>
              <ul className="checks">
                {d.reasoning.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <b>Risks</b>
              <ul className="checks">
                {d.risks.length ? d.risks.map((x, i) => <li key={i}>{x}</li>) : <li className="muted">None flagged beyond normal market risk.</li>}
              </ul>
              {d.invalidation && (
                <div style={{ fontSize: 13 }}>
                  <b>Cancelled if:</b> {d.invalidation}
                </div>
              )}
            </div>
          </div>

          <details className="analyst-details">
            <summary>What each analyst said ({res.analysts.length})</summary>
            <div className="table-wrap">
              <table className="analyst-table">
                <thead>
                  <tr>
                    <th>Analyst</th>
                    <th>Says</th>
                    <th>Entry · SL · TP</th>
                    <th>Main reason</th>
                  </tr>
                </thead>
                <tbody>
                  {res.analysts.map((a) => (
                    <MemberRow key={a.id} a={a} f={f} />
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="row" style={{ fontSize: 12, gap: 6, marginTop: 6 }}>
            {res.evidence.map((e) => (
              <span key={e.tf} className="muted">
                {tfLabel(e.tf)}: <b className="good-ink">{e.buy} BUY</b> / <b className="bad-ink">{e.sell} SELL</b>
                {e.dataStatus !== 'live' ? ` (${e.dataStatus})` : ''}
              </span>
            ))}
            {res.news.length > 0 && <span className="muted">· high-impact news soon: {res.news.slice(0, 3).map((n) => `${n.country} ${n.title}`).join(', ')}</span>}
            <span className="muted">
              · {new Date(res.generatedAt).toLocaleTimeString()} · price {f(res.price)} · {res.levelsConsidered} real price levels
            </span>
          </div>

          <AddAnalysts res={res} aiCount={ai.length} />

          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Every price comes from a strategy’s real levels and is checked before it is shown. Analysts can be wrong, and agreeing analysts can be wrong together; confidence describes how strongly the evidence agrees, not a chance of winning.
          </div>
        </>
      )}
    </div>
  );
}

function simpleWords(d: AnalystDecision, res: AnalystResponse, f: (x: number) => string): string {
  if (d.action === 'WAIT' || d.entry === null || d.stopLoss === null) {
    const watch = res.verdict.waitFor[0];
    return `${d.headline} Do not open a trade yet.${watch ? ` Next thing to watch: ${watch}` : ''}`;
  }
  const verb = d.action === 'BUY' ? 'Buy' : 'Sell';
  const tp = d.takeProfits[0];
  const risk = Math.abs(d.entry - d.stopLoss);
  const reward = tp !== undefined ? Math.abs(tp - d.entry) : null;
  return `${verb} ${d.entryType === 'market' ? 'now around' : 'at'} ${f(d.entry)}. Take profit at ${d.takeProfits.map(f).join(', then ')}. If the price goes to ${f(d.stopLoss)} instead, close the trade (stop loss). You risk ${f(risk)} per unit${reward !== null ? ` to make ${f(reward)} at the first target` : ''}.`;
}

function MemberRow({ a, f }: { a: AnalystRun; f: (x: number) => string }) {
  const d = a.decision;
  return (
    <tr>
      <td>
        <b>{a.name}</b>
        <div className="muted mono" style={{ fontSize: 11.5 }}>
          {a.kind === 'rules' ? 'built-in rules' : a.model ?? ''}
          {a.status === 'cached' ? ' · saved answer' : a.ms ? ` · ${Math.round(a.ms / 1000)}s` : ''}
        </div>
      </td>
      <td>
        {d ? (
          <>
            <b className={actionClass(d.action)}>{d.action}</b>
            <div className="muted" style={{ fontSize: 11.5 }}>{d.confidence}</div>
          </>
        ) : (
          <span className="muted">{a.status === 'duplicate' ? 'not counted' : 'no answer'}</span>
        )}
      </td>
      <td className="mono" style={{ fontSize: 12.5 }}>
        {d && d.entry !== null && d.stopLoss !== null ? `${f(d.entry)} · ${f(d.stopLoss)} · ${d.takeProfits.map(f).join('/')}` : '—'}
      </td>
      <td style={{ fontSize: 12.5 }}>
        {d ? d.headline : a.status === 'duplicate' ? 'Answered with the same model as another analyst, so it was counted once.' : a.status === 'rejected' ? `Its plan failed the safety checks: ${a.problems.join(' ')}` : <span className="warn-ink">{a.error}</span>}
      </td>
    </tr>
  );
}

function BigPicture({ ctx }: { ctx: NonNullable<AnalystResponse['context']> }) {
  const pct = (x: number | null) => (x === null ? '' : ` ${x > 0 ? '+' : ''}${fmt(x, 2)}% today`);
  return (
    <div className="big-picture">
      <b>Big picture (daily):</b>{' '}
      {ctx.daily.map((m, i) => (
        <span key={m.symbol}>
          {i > 0 && ' · '}
          {m.name} <b className={m.regime === 'Uptrend' ? 'good-ink' : m.regime === 'Downtrend' ? 'bad-ink' : ''}>{m.regime.toLowerCase()}</b>
          <span className="muted">{pct(m.change1dPct)}</span>
        </span>
      ))}
      {ctx.headlines.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          Headlines: {ctx.headlines.slice(0, 3).map((h) => h.title).join(' · ')}
        </div>
      )}
    </div>
  );
}

function AddAnalysts({ res, aiCount }: { res: AnalystResponse; aiCount: number }) {
  const missing = res.providers.filter((p) => !p.configured);
  return (
    <details className="analyst-details" open={aiCount === 0}>
      <summary>
        {aiCount === 0 ? 'Only the rule-based analyst is active — add free AI analysts' : `Add more free AI analysts (${aiCount} AI${aiCount === 1 ? '' : 's'} active)`}
      </summary>
      <p className="muted" style={{ fontSize: 12.5, margin: '6px 0' }}>
        Each key below adds one more analyst to the vote. Get a free key from the link, open the <code>.env</code> file in the project folder, add a line like <code>GROQ_API_KEY=your-key</code>, then restart the app. Keys stay on your computer and are never shown in the browser.
      </p>
      <ul className="checks" style={{ fontSize: 13 }}>
        {res.providers
          .filter((p) => p.configured)
          .map((p) => (
            <li key={p.id}>
              <b className="good-ink">✓ {p.name}</b> <span className="muted">— active</span>
            </li>
          ))}
        {missing.map((p) => (
          <li key={p.id}>
            <b>{p.name}</b> — {p.free}{' '}
            {p.signupUrl && (
              <a href={p.signupUrl} target="_blank" rel="noreferrer">
                get a key
              </a>
            )}{' '}
            → <code>{p.envKey}=…</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
