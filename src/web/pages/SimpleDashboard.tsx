// Simple mode: one screen with the price, a BUY / SELL / WAIT answer per timeframe, one clear trade card,
// the next possible entry prices, a clean chart of that trade, and saved trades in plain words.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type MarketInfo, type Opportunity, type OutcomeEval, type OutlookFrame, type Quote, type SignalsResponse, type TradePlan } from '../api';
import { ago, Card, copyText, fmt, Icon, Spinner, useApp } from '../components/ui';
import { tfLabel } from '../../core/timeframe';
import { useMode } from '../mode';
import { AssetPicker, DEFAULT_STRATEGIES, GOLD, load, nextLimit, planText, save, SignalChart, type Inst } from './Analyze';
import { chanceText, pickAnswer } from '../../core/plans';
import { AnalystCard } from '../components/AnalystCard';

const TFS = ['5', '15', '30', '60'];
type Frame = { plans: TradePlan[]; market: MarketInfo } | { error: string };

const ago2 = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export function SimpleDashboard() {
  const { toast } = useApp();
  const { setMode } = useMode();
  const [inst, setInst] = useState<Inst>(() => load('pf-an-inst', GOLD));
  const [tf, setTf] = useState<string>(() => load('pf-simple-tf', '15'));
  const live = load('pf-an-live', false);
  const strategies = useMemo(() => {
    const slots = load<Record<string, number>>('pf-an-slots', Object.fromEntries(DEFAULT_STRATEGIES.map((id, k) => [id, k])));
    const ids = Object.keys(slots);
    return ids.length ? ids : DEFAULT_STRATEGIES;
  }, []);
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const [outlook, setOutlook] = useState<OutlookFrame[] | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [chart, setChart] = useState<SignalsResponse | null>(null);
  const [savedKey, setSavedKey] = useState(0);
  const [limit, setLimit] = useState(1500);
  const [chartBusy, setChartBusy] = useState(false);
  // A stable colour function, so the chart is not rebuilt on every price update.
  const chartColor = useCallback(() => '#2a78d6', []);
  useEffect(() => save('pf-an-inst', inst), [inst]);
  useEffect(() => save('pf-simple-tf', tf), [tf]);

  // Answers for all four timeframes (every strategy is checked on the server; results are cached per candle).
  useEffect(() => {
    let alive = true;
    const loadAll = () =>
      Promise.all(
        TFS.map((x) =>
          api
            .tradePlans({ source: inst.source, ticker: inst.ticker, tf: x, live })
            .then((r) => [x, { plans: r.plans, market: r.market }] as const)
            .catch((e) => [x, { error: (e as Error).message }] as const),
        ),
      ).then((rows) => alive && setFrames(Object.fromEntries(rows)));
    setFrames({});
    loadAll();
    const id = setInterval(loadAll, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [inst, live]);

  // Next possible entry prices for the active strategies on the four timeframes.
  useEffect(() => {
    let alive = true;
    const loadOutlook = () =>
      api
        .outlook({ source: inst.source, ticker: inst.ticker, strategies, live })
        .then((r) => alive && setOutlook(r.frames))
        .catch(() => alive && setOutlook([]));
    setOutlook(null);
    loadOutlook();
    const id = setInterval(loadOutlook, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [inst, live, strategies]);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .quote(inst.source, inst.ticker)
        .then((q) => alive && setQuote(q))
        .catch(() => undefined);
    setQuote(null);
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [inst]);

  const frame = frames[tf];
  const market = frame && 'market' in frame ? frame.market : (Object.values(frames).find((f) => 'market' in f) as { market: MarketInfo } | undefined)?.market;
  const answer = frame && 'plans' in frame ? pickAnswer(frame.plans) : null;
  const dp = useMemo(() => {
    const px = quote?.last ?? market?.quote?.last;
    return px ? Math.min(6, Math.max(2, String(Math.round(px * 100) / 100).split('.')[1]?.length ?? 2)) : 2;
  }, [quote, market]);
  const f = useCallback((x: number) => fmt(x, dp), [dp]);

  // Chart of the chosen trade only.
  const answerId = answer?.strategyId ?? null;
  useEffect(() => setLimit(1500), [inst, tf, answerId]);
  useEffect(() => {
    if (!answerId) {
      setChart(null);
      return;
    }
    let alive = true;
    const loadChart = () => {
      setChartBusy(true);
      api
        .signals({ source: inst.source, ticker: inst.ticker, tf, strategies: [answerId], live, limit })
        .then((r) => alive && setChart(r))
        .catch(() => undefined)
        .finally(() => alive && setChartBusy(false));
    };
    loadChart();
    const id = setInterval(loadChart, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [inst, tf, answerId, live, limit]);

  const saveTrade = async () => {
    const sig = chart?.signals[0];
    if (!sig || !chart || sig.state === 'NO TRADE') return toast('This trade cannot be saved right now — refresh and try again.', 'bad');
    try {
      await api.saveOpportunity({ signal: sig, market: chart.market, confluence: chart.confluence });
      toast('Saved. Find it under "My saved trades" below.', 'ok');
      setSavedKey((k) => k + 1);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const last = quote?.last ?? market?.quote?.last ?? null;
  const change = market?.change ?? null;
  const status = market?.data.status;
  const loading = !Object.keys(frames).length;
  const ofTf = outlook?.find((o) => o.tf === tf);
  const nextEntries = (ofTf?.strategies ?? [])
    .flatMap((s) => s.triggers.filter((x) => !x.blockedReason && (x.from !== null || x.to !== null)).map((x) => ({ s, x, edge: (x.action === 'BUY' ? x.from : x.to) ?? x.from ?? x.to ?? 0 })))
    .sort((a, b) => Math.abs(a.edge - (last ?? a.edge)) - Math.abs(b.edge - (last ?? b.edge)))
    .slice(0, 4);
  const minsLeft = ofTf?.formingCloseAt ? Math.max(0, Math.round((Date.parse(ofTf.formingCloseAt) - Date.now()) / 60000)) : null;

  return (
    <div className="simple">
      <div className="simple-top">
        <AssetPicker value={inst} onChange={setInst} />
        <div className="simple-price">
          <span className="simple-px mono">{last !== null ? f(last) : '—'}</span>
          {change && (
            <span className={change.pct >= 0 ? 'good-ink' : 'bad-ink'}>
              {change.pct >= 0 ? '▲' : '▼'} {fmt(Math.abs(change.pct), 2)}% today
            </span>
          )}
          {status && (
            <span className={`simple-status ${status}`} title={market?.instrument}>
              {status === 'live' ? '● Live price' : status === 'stale' ? '● Market closed / old price' : '● Price problem'}
            </span>
          )}
        </div>
      </div>

      <div className="tf-tiles" role="tablist" aria-label="Timeframe">
        {TFS.map((x) => {
          const fr = frames[x];
          const a = fr && 'plans' in fr ? pickAnswer(fr.plans) : null;
          const word = !fr ? '…' : 'error' in fr ? 'NO DATA' : a ? a.action : 'WAIT';
          return (
            <button key={x} role="tab" aria-selected={tf === x} className={`tf-tile ${tf === x ? 'on' : ''} ${word === 'BUY' ? 'buy' : word === 'SELL' ? 'sell' : ''}`} onClick={() => setTf(x)}>
              <span className="tf-name">{tfLabel(x)}</span>
              <span className="tf-word">{word}</span>
              <span className="tf-sub mono">{a ? `@ ${f(a.entry)}` : fr && 'plans' in fr ? 'no trade' : ' '}</span>
            </button>
          );
        })}
      </div>

      <AnalystCard source={inst.source} ticker={inst.ticker} focusTf={tf} strategies={strategies} live={live} dp={dp} />

      {loading ? (
        <div className="card card-pad mb">
          <Spinner /> Checking all strategies on 5m, 15m, 30m and 1H…
        </div>
      ) : frame && 'error' in frame ? (
        <div className="card card-pad mb bad-ink">Price data is not available right now: {frame.error}</div>
      ) : answer ? (
        <AnswerCard p={answer} tf={tf} f={f} price={last} onCopy={async () => toast((await copyText(planText(answer, dp, inst.ticker, tfLabel(tf)))) ? 'Copied.' : 'Copy failed.', 'ok')} onSave={saveTrade} canSave={!!chart?.signals[0] && chart.signals[0].state !== 'NO TRADE'} />
      ) : (
        <div className="answer wait mb">
          <div className="answer-action">WAIT</div>
          <div className="answer-why">No strategy designed for {tfLabel(tf)} has a trade right now. Look at the next possible entries below, or pick another timeframe.</div>
        </div>
      )}

      <Card title={`Next possible entries on ${tfLabel(tf)}${minsLeft !== null ? ` · this candle closes in ${minsLeft} min` : ''}`} className="mb">
        {!outlook ? (
          <div className="muted">
            <Spinner /> Working out the prices that would start a new trade…
          </div>
        ) : !nextEntries.length ? (
          <div className="muted">No new BUY or SELL would start on this candle at any nearby price.</div>
        ) : (
          <ul className="next-list">
            {nextEntries.map(({ s, x }, k) => (
              <li key={k}>
                <span className={`pill ${x.action === 'BUY' ? 'buy' : 'sell'}`}>{x.action}</span>
                <span>
                  if the {tfLabel(tf)} candle closes {x.to === null ? 'above' : x.from === null ? 'below' : 'between'} <b className="mono">{x.to === null ? f(x.from!) : x.from === null ? f(x.to!) : `${f(x.from!)} – ${f(x.to!)}`}</b>
                  {x.stop !== null && (
                    <span className="muted">
                      {' '}
                      → stop {f(x.stop)}
                      {x.targets.length > 0 && `, target ${f(x.targets[x.targets.length - 1])}`}
                    </span>
                  )}
                  <span className="muted"> · {s.strategyName}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {chart && answer && (
        <Card title={`${inst.ticker} · ${tfLabel(tf)} · ${answer.strategyName}`} className="mb" pad={false}>
          <SignalChart res={chart} colorOf={chartColor} focus={answer.strategyId} setFocus={() => undefined} simple loadingMore={chartBusy} onNeedMore={nextLimit(limit) ? () => setLimit(nextLimit(limit)!) : undefined} />
        </Card>
      )}

      <SimpleSaved refreshKey={savedKey} f={f} />

      <div className="simple-foot muted">
        Signals come from fixed trading rules applied to {live ? 'live candles (the newest candle can still change)' : 'closed candles'}. "Chance of profit" counts how often the same strategy’s past trades here made money; it is a guide, not a promise. Trading is risky — check before you act.{' '}
        <button className="linklike" onClick={() => setMode('advanced')}>
          Show the advanced view
        </button>
      </div>
    </div>
  );
}

function AnswerCard({ p, tf, f, price, onCopy, onSave, canSave }: { p: TradePlan; tf: string; f: (x: number) => string; price: number | null; onCopy: () => void; onSave: () => void; canSave: boolean }) {
  const buy = p.action === 'BUY';
  const dir = buy ? 1 : -1;
  const risk = Math.abs(p.entry - p.stop);
  // Where the trade stands at the current price, and what entering now (instead of at the signal) would mean.
  const nowR = price !== null && risk > 0 ? (dir * (price - p.entry)) / risk : null;
  const lateRisk = price !== null ? dir * (price - p.stop) : null;
  const lateReward = price !== null ? dir * (p.targets[p.targets.length - 1] - price) : null;
  const chance = chanceText(p.probability);
  const agree = p.agree.filter((a) => a.tfOk);
  const against = p.disagree.filter((a) => a.tfOk);
  const final = p.targets[p.targets.length - 1];
  return (
    <div className={`answer ${buy ? 'buy' : 'sell'} mb`}>
      <div className="answer-head">
        <span className="answer-action">{p.action}</span>
        <span className="muted">
          {tfLabel(tf)} · started {ago2(p.signalTime)} · {p.strategyName}
        </span>
      </div>
      <div className="answer-levels">
        <div>
          <span>Entry</span>
          <b className="mono">{f(p.entry)}</b>
        </div>
        <div className="good">
          <span>Take profit{p.targets.length > 1 ? 's' : ''}</span>
          <b className="mono">{p.targets.map(f).join(' · ')}</b>
        </div>
        <div className="bad">
          <span>Stop loss</span>
          <b className="mono">{f(p.stop)}</b>
        </div>
      </div>
      {nowR !== null && price !== null && (
        <div className={`answer-now ${Math.abs(nowR) < 0.1 ? '' : nowR > 0 ? 'good-ink' : 'bad-ink'}`}>
          <b>Right now:</b> price {f(price)} is {f(Math.abs(price - p.entry))} {Math.abs(nowR) < 0.1 ? 'from' : (price > p.entry) === buy ? 'in profit from' : 'against'} the entry
          {Math.abs(nowR) >= 0.1 && ` (${nowR > 0 ? '+' : '−'}${fmt(Math.abs(nowR), 1)}× the risk)`}.
          {lateRisk !== null && lateReward !== null && Date.now() - Date.parse(p.signalTime) > 60 * 60 * 1000 && (
            <span className="muted">
              {' '}
              {lateRisk <= 0 || lateReward <= 0
                ? 'Entering now makes no sense: the price is already past the stop or the target.'
                : `Entering now instead: ${f(lateRisk)} to the stop, ${f(lateReward)} to the last target (${fmt(lateReward / lateRisk, 1)}× reward).`}
            </span>
          )}
        </div>
      )}
      <div className="answer-why">
        <b>Why:</b> {p.why}
      </div>
      <div className="answer-facts">
        <div>
          <span className="muted">Chance of profit</span> <b className={(p.probability?.p ?? 0) >= 0.5 ? 'good-ink' : (p.probability?.p ?? 1) < 0.35 ? 'bad-ink' : ''}>{chance.headline}</b>
          <span className="muted"> — {chance.detail}</span>
          {chance.rough && <span className="warn-ink"> Few trades, so treat this as rough.</span>}
        </div>
        <div>
          <span className="muted">Possible reward</span> <b>{p.rewardRisk !== null ? `${fmt(p.rewardRisk, 1)}×` : '—'}</b>
          <span className="muted"> the risk — {f(Math.abs(final - p.entry))} to the last target vs {f(Math.abs(p.entry - p.stop))} to the stop.</span>
        </div>
        <div>
          {agree.length ? (
            <span className="good-ink">
              ✓ {agree.length} other strateg{agree.length === 1 ? 'y agrees' : 'ies agree'}: {agree.map((a) => a.strategyName).join(', ')}
            </span>
          ) : (
            <span className="muted">No other strategy confirms this trade.</span>
          )}
        </div>
        {against.length > 0 && (
          <div className="warn-ink">
            ⚠ {against.length} strateg{against.length === 1 ? 'y says' : 'ies say'} the opposite: {against.map((a) => `${a.strategyName} (${a.action})`).join(', ')}
          </div>
        )}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={onSave} disabled={!canSave}>
          Save this trade
        </button>
        <button className="btn" onClick={onCopy}>
          <Icon name="copy" size={15} /> Copy
        </button>
      </div>
    </div>
  );
}

/** Saved trades with their result in plain words; results are checked automatically. */
function SimpleSaved({ refreshKey, f }: { refreshKey: number; f: (x: number) => string }) {
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [res, setRes] = useState<Record<string, OutcomeEval | string>>({});
  useEffect(() => {
    let alive = true;
    api
      .opportunities()
      .then(async (list) => {
        if (!alive) return;
        setOpps(list);
        for (const o of list.slice(0, 10)) {
          const r = await api.evaluateOpportunity(o.id).catch((e) => (e as Error).message);
          if (!alive) return;
          setRes((x) => ({ ...x, [o.id]: r }));
        }
      })
      .catch(() => alive && setOpps([]));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  const say = (o: Opportunity, r: OutcomeEval | string | undefined) => {
    if (r === undefined) return { text: 'Checking…', tone: '' };
    if (typeof r === 'string') return { text: `Could not check: ${r}`, tone: 'bad-ink' };
    if (r.status === 'pending') return { text: 'Waiting — no full candle has closed since you saved it.', tone: 'muted' };
    if (r.status === 'target') return { text: `✓ Hit the first target (+${fmt(r.r, 1)}× the risk)`, tone: 'good-ink' };
    if (r.status === 'stopped') return { text: '✗ Hit the stop loss', tone: 'bad-ink' };
    if (r.status === 'open') return { text: `Still open — now ${r.r !== null && r.r >= 0 ? 'in profit' : 'in loss'} (${r.r !== null ? `${r.r >= 0 ? '+' : ''}${fmt(r.r, 1)}×` : '—'} the risk), price ${r.lastPrice !== null ? f(r.lastPrice) : '—'}`, tone: (r.r ?? 0) >= 0 ? 'good-ink' : 'bad-ink' };
    return { text: 'No data', tone: 'muted' };
  };
  return (
    <Card title={`My saved trades${opps ? ` (${opps.length})` : ''}`} className="mb">
      {!opps ? (
        <Spinner />
      ) : !opps.length ? (
        <div className="muted">Nothing saved yet. Press "Save this trade" to follow a signal and see how it turns out.</div>
      ) : (
        <ul className="saved-list">
          {opps.slice(0, 10).map((o) => {
            const s = say(o, res[o.id]);
            return (
              <li key={o.id}>
                <span className={`pill ${o.direction === 1 ? 'buy' : 'sell'}`}>{o.direction === 1 ? 'BUY' : 'SELL'}</span>
                <span>
                  <b>
                    {o.ticker} {tfLabel(o.tf)}
                  </b>{' '}
                  <span className="mono">@ {f(o.entry)}</span> <span className="muted">· stop {f(o.stop)} · target {f(o.targets[0])} · saved {ago(o.createdAt)}</span>
                  <div className={s.tone}>{s.text}</div>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
