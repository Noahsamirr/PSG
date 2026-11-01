// Primary workflow: pick an asset (GOLD by default) → activate strategies → read BUY / SELL / NO TRADE with levels,
// reasons and invalidation → compare agreement → save the opportunity → evaluate it later.
// Signals are computed on the server from closed bars with the app's deterministic strategy engine.
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, LineSeries, LineStyle, LineType, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type LogicalRange, type MouseEventParams, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Instrument, type MarketInfo, type Opportunity, type OutcomeEval, type OutlookFrame, type Quote, type Rankings, type SignalsResponse, type StrategyInfo, type StrategySignal, type TradePlan, type Trigger } from '../api';
import { ago, Badge, Card, copyText, Empty, fmt, Icon, Spinner, useApp, validationTone } from '../components/ui';
import { TF_LADDER, tfInRange, tfLabel } from '../../core/timeframe';
import { useI18n, type Lang } from '../i18n';
import { WHY_AR } from '../i18n/ar';
import { useMode } from '../mode';
import { SimpleDashboard } from './SimpleDashboard';
import { AnalystCard } from '../components/AnalystCard';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
export const DEFAULT_STRATEGIES = ['ema_trend', 'bb_meanrev', 'macd_trend', 'squeeze_breakout'];
const MAX = SERIES.length;
export type Inst = Pick<Instrument, 'source' | 'ticker' | 'name'>;
export const GOLD: Inst = { source: 'binancef', ticker: 'XAUUSDT', name: 'Gold perpetual (USDT-margined)' };

const css = (v: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
const stateTone = (s: string) => (s === 'BUY' ? 'good' : s === 'SELL' ? 'bad' : 'neutral') as 'good' | 'bad' | 'neutral';
/** Older history steps: 1,500 → 3,000 → 5,000 candles (the server's maximum). */
export const nextLimit = (n: number) => (n < 3000 ? 3000 : n < 5000 ? 5000 : null);

export const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
export const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

type Tz = 'utc' | 'local';
const fmtTime = (iso: string | null | undefined, tz: Tz) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (tz === 'utc') return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function Analyze() {
  const { mode } = useMode();
  return mode === 'simple' ? <SimpleDashboard /> : <AdvancedDashboard />;
}

function AdvancedDashboard() {
  const { toast, go } = useApp();
  const { t } = useI18n();
  const [inst, setInst] = useState<Inst>(() => load('pf-an-inst', GOLD));
  const [tf, setTf] = useState(() => load('pf-an-tf', '60'));
  const [tz, setTz] = useState<Tz>(() => load('pf-an-tz', 'utc'));
  // Closed = confirmed candles only (signals never change). Live = include the forming candle (earlier, but can change).
  const [live, setLive] = useState<boolean>(() => load('pf-an-live', false));
  // Candles loaded for the chart; grows when the user scrolls back to the oldest candle.
  const [limit, setLimit] = useState(1500);
  useEffect(() => setLimit(1500), [inst, tf]);
  // Each strategy keeps its colour slot while active, so activating one never repaints the others.
  const [slots, setSlots] = useState<Record<string, number>>(() => load('pf-an-slots', Object.fromEntries(DEFAULT_STRATEGIES.map((id, k) => [id, k]))));
  const selected = useMemo(() => Object.keys(slots).sort((a, b) => slots[a] - slots[b]), [slots]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [res, setRes] = useState<SignalsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{ q: Quote | null; error: string | null } | null>(null);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const justActivated = useRef<string[]>([]);

  useEffect(() => {
    api.strategies().then(setStrategies).catch(() => undefined);
    api.opportunities().then(setOpps).catch(() => undefined);
  }, []);
  useEffect(() => save('pf-an-inst', inst), [inst]);
  useEffect(() => save('pf-an-tf', tf), [tf]);
  useEffect(() => save('pf-an-tz', tz), [tz]);
  useEffect(() => save('pf-an-live', live), [live]);
  useEffect(() => save('pf-an-slots', slots), [slots]);

  const run = useCallback(async () => {
    if (!selected.length) {
      setRes(null);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const activated = justActivated.current;
      justActivated.current = [];
      setRes(await api.signals({ source: inst.source, ticker: inst.ticker, tf, strategies: selected, activated, live, limit }));
    } catch (e) {
      setErr((e as Error).message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  }, [inst, tf, selected, live, limit]);
  useEffect(() => {
    run();
    const id = setInterval(run, 60_000);
    return () => clearInterval(id);
  }, [run]);

  // Live quote polling, separate from the heavier signal refresh.
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .quote(inst.source, inst.ticker)
        .then((q) => alive && setQuote({ q, error: null }))
        .catch((e) => alive && setQuote((p) => ({ q: p?.q ?? null, error: (e as Error).message })));
    setQuote(null);
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [inst]);

  const toggle = (id: string) =>
    setSlots((s) => {
      if (id in s) {
        const { [id]: _, ...rest } = s;
        return rest;
      }
      const used = new Set(Object.values(s));
      const free = [...Array(MAX).keys()].find((k) => !used.has(k));
      if (free === undefined) {
        toast(t('Up to {n} strategies at once — deactivate one first.', { n: MAX }), 'bad');
        return s;
      }
      justActivated.current.push(id);
      return { ...s, [id]: free };
    });

  const saveOpp = async (sig: StrategySignal) => {
    if (!res) return;
    try {
      const o = await api.saveOpportunity({ signal: sig, market: res.market, confluence: res.confluence });
      setOpps((x) => [o, ...x]);
      toast(t('Opportunity saved with its strategy version and market snapshot.'), 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const openScript = async (sig: StrategySignal) => {
    try {
      const r = await api.strategyScript({ strategyId: sig.strategyId, tf, symbol: res?.market.ticker ?? inst.ticker });
      const v = validationTone(r.validation);
      toast(t('{how} Pine v6 script (v{v}) — static checks: {label}. TradingView compile not yet recorded.', { how: t(r.reused ? 'Reused stored' : 'Generated new'), v: r.version, label: v.label }), v.tone === 'bad' ? 'bad' : 'ok');
      go(`/scripts/${r.scriptId}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const dp = useMemo(() => {
    const c = res?.bars[res.bars.length - 1]?.c;
    return c === undefined ? 2 : Math.min(6, Math.max(2, String(c).split('.')[1]?.length ?? 2));
  }, [res]);
  const colorOf = useCallback((id: string) => SERIES[slots[id] ?? 0], [slots]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('Market dashboard')}</h1>
          <p>
            {t('Choose an asset and activate strategies.')} {live ? t('Signals use live candles: the newest candle is included before it closes, so a signal can still change.') : t('Signals use closed candles only, so a signal never changes after it appears.')}{' '}
            {t('Probability of profit = how often that strategy’s past trades on this market and timeframe made money after costs.')} {t('Trading is risky: check every signal yourself before acting.')}
          </p>
        </div>
        <label className="field" style={{ width: 200 }}>
          {t('Candles')}
          <select value={live ? 'live' : 'closed'} onChange={(e) => setLive(e.target.value === 'live')}>
            <option value="closed">{t('Closed (confirmed)')}</option>
            <option value="live">{t('Live (forming candle)')}</option>
          </select>
        </label>
        <label className="field" style={{ width: 120 }}>
          {t('Times in')}
          <select value={tz} onChange={(e) => setTz(e.target.value as Tz)}>
            <option value="utc">UTC</option>
            <option value="local">{t('Local time')}</option>
          </select>
        </label>
      </div>

      <div className="row mb" style={{ alignItems: 'flex-end' }}>
        <AssetPicker value={inst} onChange={setInst} />
        <label className="field" style={{ width: 110 }}>
          {t('Timeframe')}
          <select value={tf} onChange={(e) => setTf(e.target.value)}>
            {TF_LADDER.map((t) => (
              <option key={t} value={t}>
                {tfLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="refresh" size={15} />} {t('Refresh')}
        </button>
        {inst.ticker !== GOLD.ticker && (
          <button className="btn ghost" onClick={() => setInst(GOLD)}>
            {t('Back to gold')}
          </button>
        )}
      </div>

      <MarketHeader market={res?.market ?? null} err={err} busy={busy} dp={dp} quote={quote} tz={tz} bars={res?.bars ?? []} />

      <TradePlans inst={inst} tf={tf} dp={dp} live={live} active={selected} onShow={(id) => (!(id in slots) && toggle(id), setFocus(id))} />

      <AnalystCard source={inst.source} ticker={inst.ticker} focusTf={['5', '15', '30', '60'].includes(tf) ? tf : '15'} strategies={selected} live={live} dp={dp} />

      <OutlookPanel inst={inst} live={live} active={selected} dp={dp} colorOf={colorOf} onShow={(id, frameTf) => (setTf(frameTf), !(id in slots) && toggle(id), setFocus(id))} />

      <StrategyPicker strategies={strategies} slots={slots} tf={tf} colorOf={colorOf} onToggle={toggle} />

      {res && <ConfluenceBanner res={res} />}

      <Card title={res ? `${res.market.ticker} · ${tfLabel(res.market.tf)}` : t('Chart')} className="mb" pad={false}>
        {res && res.bars.length ? <SignalChart res={res} colorOf={colorOf} focus={focus} setFocus={setFocus} loadingMore={busy} onNeedMore={nextLimit(limit) ? () => setLimit(nextLimit(limit)!) : undefined} /> : <div style={{ padding: 16 }}>{busy ? <Spinner /> : <Empty>{err ?? t('Activate a strategy to see signals.')}</Empty>}</div>}
      </Card>

      {res && (
        <div className="signal-grid mb">
          {res.signals.map((s) => (
            <SignalCard key={s.strategyId} s={s} market={res.market} dp={dp} tz={tz} color={colorOf(s.strategyId)} focused={focus === s.strategyId} onFocus={() => setFocus(focus === s.strategyId ? null : s.strategyId)} onSave={() => saveOpp(s)} onScript={() => openScript(s)} />
          ))}
        </div>
      )}

      <RankingPanel inst={inst} tf={tf} onActivate={(id) => !(id in slots) && toggle(id)} />

      <SavedOpportunities opps={opps} setOpps={setOpps} dp={dp} tz={tz} />
    </div>
  );
}

/** Plain-text version of a plan, in the format "Action > BUY / Entry > TP > SL / Why / Agree". */
export function planText(p: TradePlan, dp: number, ticker: string, tfName: string, lang: Lang = 'en', tn: (s: string) => string = (s) => s) {
  const f = (x: number) => fmt(x, dp);
  if (lang === 'ar') {
    const side = (a: string) => (a === 'BUY' ? 'شراء' : 'بيع');
    const lst = (xs: TradePlan['agree']) => xs.map((a) => `${tn(a.strategyName)} (${side(a.action)} ${f(a.entry)})`).join('، ');
    const ar = [
      `${ticker} ${tfName} · ${tn(p.strategyName)}`,
      `الإجراء > ${side(p.action)}`,
      `نقطة الدخول من ${f(p.entry)} > الهدف سيكون ${p.targets.map(f).join(' / ')} > وقف الخسارة سيكون ${f(p.stop)}`,
      `السبب: ${WHY_AR[p.strategyId]?.(p.action === 'BUY') ?? p.why}`,
      `الاستراتيجيات المتوافقة: ${p.agree.length ? lst(p.agree) : 'لا يوجد'}`,
    ];
    if (p.disagree.length) ar.push(`الاستراتيجيات المعارضة: ${lst(p.disagree)}`);
    return ar.join('\n');
  }
  const lines = [
    `${ticker} ${tfName} · ${p.strategyName}`,
    `Action > ${p.action}`,
    `Entry point from ${f(p.entry)} > TP will be ${p.targets.map(f).join(' / ')} > SL will be ${f(p.stop)}`,
    `Why: ${p.why}`,
    `Probability of profit: ${p.probability ? `${Math.round(p.probability.p * 100)}% (likely range ${Math.round(p.probability.lo * 100)}–${Math.round(p.probability.hi * 100)}%, ${p.probability.n} past trades)` : 'no past trades yet'}`,
    `Strategies that agree: ${p.agree.length ? p.agree.map((a) => `${a.strategyName} (${a.action} ${f(a.entry)})`).join(', ') : 'none'}`,
  ];
  if (p.disagree.length) lines.push(`Strategies that disagree: ${p.disagree.map((a) => `${a.strategyName} (${a.action} ${f(a.entry)})`).join(', ')}`);
  return lines.join('\n');
}

function TradePlans({ inst, tf, dp, live, active, onShow }: { inst: Inst; tf: string; dp: number; live: boolean; active: string[]; onShow: (id: string) => void }) {
  const { toast } = useApp();
  const { t, lang } = useI18n();
  const side = (a: string) => t(a);
  const why = (p: TradePlan) => (lang === 'ar' ? (WHY_AR[p.strategyId]?.(p.action === 'BUY') ?? p.why) : p.why);
  const summary = (p: TradePlan) => (lang === 'en' ? p.summary : !p.agree.length && !p.disagree.length ? t('No other strategy has a trade right now — this signal stands alone.') : t('{a} agree on this entry ({f} independent families), {d} disagree.', { a: p.agree.length, f: p.independentAgree, d: p.disagree.length }));
  const [data, setData] = useState<{ plans: TradePlan[]; evaluated: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .tradePlans({ source: inst.source, ticker: inst.ticker, tf, live })
        .then((r) => alive && (setData(r), setErr(null)))
        .catch((e) => alive && setErr((e as Error).message));
    setData(null);
    load();
    const id = setInterval(load, live ? 20_000 : 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [inst, tf, live]);
  const f = (x: number) => fmt(x, dp);
  // Activated strategies first, then the rest of the library.
  const plans = data ? [...data.plans].sort((a, b) => Number(active.includes(b.strategyId)) - Number(active.includes(a.strategyId)) || Date.parse(b.signalTime) - Date.parse(a.signalTime)) : [];
  return (
    <Card title={t('Trade plans · {ticker} {tf}', { ticker: inst.ticker, tf: tfLabel(tf) })} className="mb" actions={data && <span className="muted" style={{ fontSize: 12 }}>{t('{n} strategies checked · updates every minute', { n: data.evaluated })}</span>}>
      {err && <div className="bad-ink">{err}</div>}
      {!data && !err && <Spinner />}
      {data && !plans.length && <div className="muted">{t('No strategy has a BUY or SELL on this timeframe right now. Try another timeframe, or wait for the next signal.')}</div>}
      <div className="plans">
        {plans.map((p) => {
          const buy = p.action === 'BUY';
          return (
            <div key={p.strategyId} className={`plan ${buy ? 'buy' : 'sell'}`}>
              <div className="plan-head">
                <span className={`plan-action ${buy ? 'buy' : 'sell'}`}>{side(p.action)}</span>
                <span>
                  <b>{t(p.strategyName)}</b>
                  <span className="muted">
                    {t(' · signal {time} UTC', { time: new Date(p.signalTime).toISOString().slice(5, 16).replace('T', ' ') })}
                    {p.isNew ? t(' · NEW') : ''}
                    {active.includes(p.strategyId) ? '' : t(' · not activated')}
                  </span>
                </span>
              </div>
              <div className="plan-levels">
                <span>
                  {t('Entry')} <b className="num">{f(p.entry)}</b>
                </span>
                <span className="muted">›</span>
                <span className="good-ink">
                  {t('TP')} <b className="num">{p.targets.map(f).join(' / ')}</b>
                </span>
                <span className="muted">›</span>
                <span className="bad-ink">
                  {t('SL')} <b className="num">{f(p.stop)}</b>
                </span>
                {p.rewardRisk !== null && <span className="muted">{t('R:R {x}', { x: fmt(p.rewardRisk, 1) })}</span>}
              </div>
              <div className="plan-why">
                <b>{t('Why:')}</b> {why(p)}
                {p.notMet.length > 0 && <span className="muted"> ({t('not met: {list}', { list: p.notMet.map((x) => t(x)).join(', ') })})</span>}
              </div>
              <ProbLine p={p.probability} recent={p.probabilityRecent} />
              <div className="plan-agree">
                <span>
                  <b className="good-ink">{t('Agree:')}</b> {p.agree.length ? p.agree.map((a) => `${t(a.strategyName)} (${side(a.action)} ${f(a.entry)}${a.related ? t(', same family') : ''})`).join(' · ') : t('none')}
                </span>
                {p.disagree.length > 0 && (
                  <span>
                    <b className="bad-ink">{t('Disagree:')}</b> {p.disagree.map((a) => `${t(a.strategyName)} (${side(a.action)} ${f(a.entry)})`).join(' · ')}
                  </span>
                )}
                {p.sameDirection.length > 0 && (
                  <span className="muted">
                    {t('Same direction, different entry: {list}', { list: p.sameDirection.map((a) => `${t(a.strategyName)} (${f(a.entry)})`).join(' · ') })}
                  </span>
                )}
                {p.developing.length > 0 && <span className="muted">{t('Setting up the same way: {list}', { list: p.developing.map((a) => t(a.strategyName)).join(' · ') })}</span>}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12, flex: 1 }}>
                  {summary(p)}
                </span>
                <button className="btn sm" onClick={async () => toast(t((await copyText(planText(p, dp, inst.ticker, tfLabel(tf), lang, t))) ? 'Trade plan copied.' : 'Copy failed.'), 'ok')}>
                  <Icon name="copy" size={14} /> {t('Copy')}
                </button>
                <button className="btn sm ghost" onClick={() => onShow(p.strategyId)}>
                  {t('Show on chart')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {plans.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('"Agree" = same direction with an entry within one stop distance. Agreement describes the rules; it is not a probability of profit. Not investment advice.')}</div>}
    </Card>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Probability of profit from the strategy's own past trades, with its 95% range, sample size and recent check. */
function ProbLine({ p, recent, avgWin, avgLoss }: { p: StrategySignal['probability']['all']; recent?: StrategySignal['probability']['all']; avgWin?: number | null; avgLoss?: number | null }) {
  const { t } = useI18n();
  if (!p) return <div className="prob muted">{t('Probability of profit: no past trades on this market and timeframe yet.')}</div>;
  const weak = p.n < 30;
  return (
    <div className="prob" title={t('Share of this strategy’s past trades on this market and timeframe that ended in profit after costs. The range is the 95% confidence interval; fewer trades = wider range.')}>
      <b>{t('Probability of profit')}</b> <span className={`prob-value ${p.p >= 0.5 ? 'good-ink' : p.p < 0.35 ? 'bad-ink' : ''}`}>{pct(p.p)}</span>{' '}
      <span className="muted">
        ({t('likely range')} {pct(p.lo)}–{pct(p.hi)}, {p.n} {t('past trades')}
        {recent ? `; ${t('recent')} ${pct(recent.p)} ${t('of')} ${recent.n}` : ''})
      </span>
      {avgWin != null && avgLoss != null && (
        <span className="muted">
          {' '}
          · {t('avg win')} +{fmt(avgWin, 2)}R / {t('avg loss')} {fmt(avgLoss, 2)}R
        </span>
      )}
      {weak && <span className="warn-ink"> · {t('few trades — treat as rough')}</span>}
    </div>
  );
}

const triggerRange = (x: Trigger, f: (n: number) => string, tfName: string) =>
  x.from === null && x.to === null
    ? `on any close of this ${tfName} candle`
    : x.to === null
      ? `if this ${tfName} candle closes at or above ${f(x.from!)}`
      : x.from === null
        ? `if this ${tfName} candle closes at or below ${f(x.to)}`
        : `if this ${tfName} candle closes between ${f(x.from)} and ${f(x.to)}`;

/** How each active strategy sees the market on 5m / 15m / 30m / 1H, with the next entry trigger prices. */
function OutlookPanel({ inst, live, active, dp, colorOf, onShow }: { inst: Inst; live: boolean; active: string[]; dp: number; colorOf: (id: string) => string; onShow: (id: string, tf: string) => void }) {
  const { t } = useI18n();
  const [frames, setFrames] = useState<OutlookFrame[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const key = active.join(',');
  useEffect(() => {
    if (!active.length) {
      setFrames(null);
      return;
    }
    let alive = true;
    const load = () => {
      setBusy(true);
      api
        .outlook({ source: inst.source, ticker: inst.ticker, strategies: active, live })
        .then((r) => alive && (setFrames(r.frames), setErr(null)))
        .catch((e) => alive && setErr((e as Error).message))
        .finally(() => alive && setBusy(false));
    };
    setFrames(null);
    load();
    const id = setInterval(load, 60_000);
    const tick = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst, live, key]);
  const f = (x: number) => fmt(x, dp);
  const names = new Map((frames?.[0]?.strategies ?? []).map((s) => [s.strategyId, s.strategyName]));
  const until = (iso?: string | null) => {
    if (!iso) return '';
    const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));
    return m < 1 ? 'closing now' : `closes in ${m} min`;
  };
  return (
    <Card
      title={`How the strategies see ${inst.ticker}: 5m · 15m · 30m · 1H`}
      className="mb"
      actions={<span className="muted" style={{ fontSize: 12 }}>{busy ? <Spinner /> : `${active.length} active strateg${active.length === 1 ? 'y' : 'ies'} · ${live ? 'live candles' : 'closed candles'} · updates every minute`}</span>}
    >
      {!active.length && <div className="muted">Activate at least one strategy to see its view on each timeframe.</div>}
      {err && <div className="bad-ink">{err}</div>}
      {active.length > 0 && !frames && !err && (
        <div className="muted">
          <Spinner /> Checking every active strategy on 4 timeframes and searching the next entry prices — the first time can take 10–20 seconds.
        </div>
      )}
      {frames && (
        <div className="table-wrap">
          <table className="table outlook">
            <thead>
              <tr>
                <th>Strategy</th>
                {frames.map((fr) => (
                  <th key={fr.tf}>
                    {tfLabel(fr.tf)}
                    <div className="muted" style={{ fontWeight: 400 }}>
                      {fr.error ? 'no data' : `${fr.formingOpen != null ? `candle opened ${f(fr.formingOpen)} · ` : ''}${until(fr.formingCloseAt)}`}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((id) => (
                <tr key={id}>
                  <td>
                    <span className="swatch" style={{ background: colorOf(id) }} /> <b>{names.get(id) ?? id}</b>
                  </td>
                  {frames.map((fr) => {
                    if (fr.error) return <td key={fr.tf} className="bad-ink" style={{ fontSize: 12 }}>{fr.error}</td>;
                    const s = fr.strategies.find((x) => x.strategyId === id);
                    if (!s) return <td key={fr.tf}>—</td>;
                    const p = s.probability.all;
                    const tfName = tfLabel(fr.tf);
                    return (
                      <td key={fr.tf} className="outlook-cell">
                        <div className="row" style={{ gap: 6 }}>
                          <Badge tone={s.state === 'BUY' ? 'good' : s.state === 'SELL' ? 'bad' : s.stage === 'setup' ? 'warn' : 'neutral'} dot>
                            {s.state !== 'NO TRADE' ? s.state : s.stage === 'setup' ? `setting up ${s.setupDir === 1 ? 'BUY' : 'SELL'}` : 'NO TRADE'}
                          </Badge>
                          {!s.tfOk && <span className="warn-ink" style={{ fontSize: 11 }} title="This strategy was designed for other timeframes">off-design tf</span>}
                        </div>
                        {s.state !== 'NO TRADE' && s.entry !== null && (
                          <div className="mono" style={{ fontSize: 12 }}>
                            Entry {f(s.entry)} · SL {s.stop !== null ? f(s.stop) : '—'}
                            {s.targets.length > 0 && ` · TP ${s.targets.map(f).join(' / ')}`}
                          </div>
                        )}
                        <div style={{ fontSize: 12 }}>
                          <span className="muted">Profit probability </span>
                          {p ? (
                            <b className={p.p >= 0.5 ? 'good-ink' : p.p < 0.35 ? 'bad-ink' : ''}>{pct(p.p)}</b>
                          ) : (
                            '—'
                          )}
                          {p && (
                            <span className="muted">
                              {' '}
                              ({pct(p.lo)}–{pct(p.hi)}, {p.n} trades)
                            </span>
                          )}
                        </div>
                        <div className="triggers">
                          {s.triggers.length === 0 && (
                            <span className="muted">
                              No new entry this {tfName} candle within {f(s.searched.low)}–{f(s.searched.high)}.
                            </span>
                          )}
                          {s.triggers.map((x, k) => (
                            <div key={k} className={x.action === 'BUY' ? 'good-ink' : 'bad-ink'}>
                              <b>Next {x.action}</b> {triggerRange(x, f, tfName)}
                              {x.blockedReason ? (
                                <span className="muted"> — signal only, not taken: {x.blockedReason}</span>
                              ) : (
                                x.stop !== null && (
                                  <span className="muted">
                                    {' '}
                                    → SL {f(x.stop)}
                                    {x.targets.length > 0 && ` · TP ${x.targets.map(f).join(' / ')}`}
                                  </span>
                                )
                              )}
                            </div>
                          ))}
                        </div>
                        <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => onShow(id, fr.tf)}>
                          Show {tfName} chart
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="muted">All active</td>
                {frames.map((fr) => {
                  const b = fr.strategies.filter((x) => x.state === 'BUY').length;
                  const sl = fr.strategies.filter((x) => x.state === 'SELL').length;
                  return (
                    <td key={fr.tf} style={{ fontSize: 12 }}>
                      <b className="good-ink">{b} BUY</b> · <b className="bad-ink">{sl} SELL</b> · {fr.strategies.length - b - sl} flat
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        "Next BUY/SELL" = the closing price of the candle forming now at which the strategy’s own rules would give a new signal (the rules are replayed for many possible closes). Prices can move before the candle closes. Profit probability = share of that strategy’s past trades on this market and timeframe that ended in profit after costs; the range shows how uncertain that is.
      </div>
    </Card>
  );
}

export function AssetPicker({ value, onChange }: { value: Inst; onChange: (i: Inst) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Instrument[]>([]);
  const [info, setInfo] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      api
        .searchInstruments(q)
        .then((r) => {
          setList(r.results);
          setInfo(`${t('{n} instruments searchable', { n: r.total.toLocaleString() })}${r.errors.length ? ` · ${r.errors.join('; ')}` : ''}`);
        })
        .catch((e) => setInfo((e as Error).message));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, open, t]);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (x: Instrument) => {
    onChange({ source: x.source, ticker: x.ticker, name: x.name });
    setOpen(false);
  };
  return (
    <div className="field asset-picker" ref={box} style={{ width: 360 }}>
      {t('Asset')}
      <input
        value={open ? q : `${value.ticker} — ${t(value.name)}`}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) pick(list[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={t('Search: gold, XAU, BTC, EURUSD, TSLA…')}
        aria-label={t('Search assets')}
        role="combobox"
        aria-expanded={open}
      />
      {open && (
        <div className="asset-menu" role="listbox">
          {list.map((x) => (
            <button key={x.id} role="option" aria-selected={x.ticker === value.ticker && x.source === value.source} className="asset-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(x)}>
              <span>
                <b>{x.ticker}</b> <span className="muted">{t(x.name)}</span>
              </span>
              <span className="muted" style={{ fontSize: 11 }}>
                {t(x.kind)}
                {x.needsKey ? t(' · needs API key') : ''}
              </span>
            </button>
          ))}
          {!list.length && (
            <div className="muted" style={{ padding: 10 }}>
              {t('No matching instrument.')}
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, padding: '6px 10px' }}>
            {info}
          </div>
        </div>
      )}
    </div>
  );
}

function MarketHeader({ market: m, err, busy, dp, quote, tz, bars }: { market: MarketInfo | null; err: string | null; busy: boolean; dp: number; quote: { q: Quote | null; error: string | null } | null; tz: Tz; bars: SignalsResponse['bars'] }) {
  const { t, tx } = useI18n();
  if (err)
    return (
      <div className="card card-pad mb" role="alert">
        <Badge tone="bad" dot>
          {t('Data unavailable')}
        </Badge>{' '}
        {tx(err)}
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {t('No signals are generated without valid data. Try another source for the same asset, or another asset.')}
        </div>
      </div>
    );
  if (!m) return <div className="card card-pad mb">{busy ? <Spinner /> : t('Loading…')}</div>;
  const q = quote?.q ?? m.quote;
  const disconnected = !!quote?.error;
  const qTime = q?.exchangeTime ?? q?.receivedAt ?? null;
  const qAge = qTime ? (Date.now() - Date.parse(qTime)) / 1000 : null;
  const d = m.data;
  const status = disconnected ? 'disconnected' : d.status === 'invalid' ? 'invalid' : d.status === 'stale' ? 'stale' : q?.delayed || !m.realtime ? 'delayed' : qAge !== null && qAge > 120 ? 'stale' : 'live';
  const tone = status === 'live' ? 'good' : status === 'delayed' || status === 'stale' ? 'warn' : 'bad';
  const last = q?.last ?? bars[bars.length - 1]?.c ?? null;
  // The 24h reference close is fixed server-side; the change follows the live quote.
  const refClose = m.change ? (m.quote?.last ?? bars[bars.length - 1]?.c ?? 0) - m.change.abs : null;
  const chAbs = refClose && last !== null ? last - refClose : null;
  return (
    <div className="card card-pad mb market-head">
      <div className="mh-main">
        <div className="muted" style={{ fontSize: 12 }}>
          {t(m.name)}
        </div>
        <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{m.ticker}</span>
          <span className="mono" style={{ fontSize: 26, fontWeight: 650 }}>
            {last !== null ? fmt(last, dp) : '—'}
          </span>
          <span className="muted">{m.quoteCurrency}</span>
          {chAbs !== null && refClose && (
            <span className={`mono ${chAbs >= 0 ? 'good-ink' : 'bad-ink'}`}>
              {chAbs >= 0 ? '+' : ''}
              {fmt(chAbs, dp)} ({chAbs >= 0 ? '+' : ''}
              {fmt((100 * chAbs) / refClose, 2)}%) <span className="muted">{t('24h')}</span>
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {q?.bid != null && q.ask != null ? t('Bid {bid} · Ask {ask} · Spread {spread}', { bid: fmt(q.bid, dp), ask: fmt(q.ask, dp), spread: fmt(q.spread, dp) }) : t('Bid/ask not provided by this source')}
          {q && ` · ${t(q.delayed ? 'last trade (delayed)' : 'mid of best bid/ask')}`}
        </div>
      </div>
      <div className="mh-meta">
        <div>
          <Badge tone={tone} dot>
            {t(status.toUpperCase())}
          </Badge>{' '}
          <span className="muted" style={{ fontSize: 12 }}>
            {t('quote')} {qTime ? `${fmtTime(qTime, tz)}${t(q?.exchangeTime ? ' (exchange time)' : ' (time received)')}` : '—'}
          </span>
        </div>
        <div style={{ fontSize: 12 }}>
          <b>{t(m.instrument)}</b>
          <div className="muted">
            {m.provider} · {t(m.session)}
            {m.isProxy && t(' · proxy for the requested symbol')}
          </div>
          <div className="muted">{t('Last closed candle {time}', { time: fmtTime(d.lastClosedAt, tz) })}</div>
        </div>
        {m.crossCheck && (
          <div className="muted" style={{ fontSize: 12 }} title={m.crossCheck.note}>
            {t('Cross-check vs {ticker}: {price} (difference {diff}%)', { ticker: m.crossCheck.ticker, price: fmt(m.crossCheck.last, dp), diff: `${m.crossCheck.diffPct >= 0 ? '+' : ''}${fmt(m.crossCheck.diffPct, 2)}` })}
          </div>
        )}
        {disconnected && (
          <div className="bad-ink" style={{ fontSize: 12 }}>
            {t('Live quote failed: {err}. Showing the last known values.', { err: quote?.error ?? '' })}
          </div>
        )}
        {d.issues.map((i) => (
          <div key={i} className="warn-ink" style={{ fontSize: 12 }}>
            {tx(i)}
          </div>
        ))}
      </div>
    </div>
  );
}

const REVIEW_BADGE: Record<string, { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  approved: { tone: 'good', label: 'approved' },
  deprecated: { tone: 'bad', label: 'deprecated' },
  awaiting_validation: { tone: 'warn', label: 'awaiting validation' },
  experimental: { tone: 'neutral', label: 'experimental' },
};

function StrategyPicker({ strategies, slots, tf, colorOf, onToggle }: { strategies: StrategyInfo[]; slots: Record<string, number>; tf: string; colorOf: (id: string) => string; onToggle: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => load('pf-an-lib-open', true));
  useEffect(() => save('pf-an-lib-open', open), [open]);
  const filtered = strategies.filter((s) => !q || `${s.name} ${s.category} ${s.family} ${s.summary} ${t(s.name)} ${t(s.category)} ${t(s.summary)}`.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(filtered.map((s) => s.category))];
  const active = strategies.filter((s) => s.id in slots);
  return (
    <Card
      title={t('Strategies · {n} active', { n: active.length })}
      className="mb"
      actions={
        <>
          <input className="input-sm" placeholder={t('Search strategies…')} value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} aria-label={t('Search strategies')} />
          <button className="btn sm ghost" onClick={() => setOpen(!open)}>
            {t(open ? 'Hide library' : 'Show library')}
          </button>
        </>
      }
    >
      {active.length > 0 && (
        <div className="row" style={{ marginBottom: open ? 12 : 0 }}>
          {active.map((s) => (
            <span key={s.id} className="active-chip" style={{ borderColor: colorOf(s.id) }}>
              <span className="swatch" style={{ background: colorOf(s.id) }} />
              {t(s.name)}
              <button className="btn ghost icon" style={{ width: 22, height: 22 }} onClick={() => onToggle(s.id)} aria-label={t('Deactivate {name}', { name: t(s.name) })}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="strategy-lib">
          {cats.map((c) => (
            <div key={c}>
              <div className="nav-group" style={{ margin: '6px 0 2px' }}>
                {t(c)}
              </div>
              {filtered
                .filter((s) => s.category === c)
                .map((s) => {
                  const on = s.id in slots;
                  const fits = s.tfRange ? tfInRange(tf, s.tfRange) !== false : true;
                  const rb = REVIEW_BADGE[s.review.status];
                  return (
                    <div key={s.id} className="strategy-row">
                      <div style={{ minWidth: 0 }}>
                        <b>{t(s.name)}</b> <Badge tone={rb.tone}>{t(rb.label)}</Badge>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {t(s.summary)} · {t(s.family)} · {t('designed for {tf}', { tf: s.timeframes })}
                          {!fits && <span className="warn-ink">{t(' · outside the selected timeframe')}</span>}
                        </div>
                      </div>
                      <button className={`btn sm ${on ? '' : 'primary'}`} onClick={() => onToggle(s.id)} disabled={!on && s.review.status === 'deprecated'} title={s.review.status === 'deprecated' ? t('Deprecated: {note}', { note: s.review.note }) : undefined}>
                        {t(on ? 'Deactivate' : 'Activate strategy')}
                      </button>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ConfluenceBanner({ res }: { res: SignalsResponse }) {
  const { t, tx } = useI18n();
  const c = res.confluence;
  const names = (state: string) => res.signals.filter((s) => s.state === state).map((s) => t(s.strategyName));
  const fams = (xs: string[]) => xs.map((x) => t(x)).join(', ');
  return (
    <div className="card card-pad mb" style={{ borderInlineStart: `4px solid var(--${c.state === 'BUY' ? 'good' : c.state === 'SELL' ? 'bad' : 'line-strong'})` }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <span style={{ fontSize: 20, fontWeight: 700 }}>{t(c.state)}</span>
          <span>{tx(c.label)}</span>
        </div>
        <div className="row" style={{ fontSize: 12 }}>
          <span title={t('Share of independent strategy families agreeing with the leading direction. Not a probability.')}>
            {t('Confluence score')} <b>{c.score}</b>/100
          </span>
          <Badge tone="good">{t('{n} agree', { n: c.agreeing })}</Badge>
          <Badge tone={c.disagreeing ? 'bad' : 'neutral'}>{t('{n} disagree', { n: c.disagreeing })}</Badge>
        </div>
      </div>
      <div className="row" style={{ fontSize: 12, marginTop: 6 }}>
        {c.buyFamilies.length > 0 && <Badge tone="good">{t('BUY')}: {fams(c.buyFamilies)}</Badge>}
        {c.sellFamilies.length > 0 && <Badge tone="bad">{t('SELL')}: {fams(c.sellFamilies)}</Badge>}
        {c.splitFamilies.length > 0 && <Badge tone="warn">{t('split: {list}', { list: fams(c.splitFamilies) })}</Badge>}
        {c.neutralFamilies.length > 0 && <Badge>{t('flat: {list}', { list: fams(c.neutralFamilies) })}</Badge>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {names('BUY').length > 0 && t('Long: {list}. ', { list: names('BUY').join(', ') })}
        {names('SELL').length > 0 && t('Short: {list}. ', { list: names('SELL').join(', ') })}
        {tx(c.explanation)}
      </div>
    </div>
  );
}

const EVENT_GLOSSARY: Record<string, string> = {
  $: 'Sweep — price ran past a swing high/low (liquidity) and closed back inside',
  CHoCH: 'CHoCH — change of character: first break of structure against the previous trend',
  BOS: 'BOS — break of structure in the direction of the trend',
  FVG: 'FVG — fair value gap: a 3-candle imbalance price often returns to (labelled only after a sweep; all gaps are drawn as green/red step lines)',
};
const eventLabel = (t: string) => (t === '$' ? 'Sweep' : t);

/**
 * Fair value gaps are frequent; their zones are already drawn as lines. Only gaps that form within 20 candles after
 * a same-direction liquidity sweep (the setups the SMC strategy trades) get a text label, so the chart stays readable.
 */
/**
 * Simple view: for each entry, only the setup that led to it — the last liquidity sweep, the last structure shift
 * (CHoCH/BOS), the last FVG and the last other label in the same direction within the 40 candles before it.
 */
function setupChain(events: StrategySignal['events'], entries: { i: number; dir: 1 | -1 }[], idxOf: Map<number, number>) {
  const keep = new Set<StrategySignal['events'][number]>();
  const kind = (t: string) => (t === 'CHoCH' || t === 'BOS' ? 'shift' : t === '$' || t === 'FVG' ? t : 'other');
  for (const e of entries) {
    const tone = e.dir === 1 ? 'bull' : 'bear';
    const last: Record<string, StrategySignal['events'][number]> = {};
    for (const ev of events) {
      const i = idxOf.get(ev.t) ?? -1;
      if (i < e.i - 40 || i > e.i || (ev.tone !== tone && ev.tone !== 'neutral')) continue;
      last[kind(ev.text)] = ev;
    }
    Object.values(last).forEach((ev) => keep.add(ev));
  }
  return events.filter((ev) => keep.has(ev));
}

function relevantEvents(events: StrategySignal['events'], bars: SignalsResponse['bars']) {
  const idx = new Map(bars.map((b, i) => [b.t, i]));
  const lastSweep: Record<string, number> = {};
  return events.filter((e) => {
    const i = idx.get(e.t) ?? 0;
    if (e.text === '$') lastSweep[e.tone] = i;
    if (e.text !== 'FVG') return true;
    return lastSweep[e.tone] !== undefined && i - lastSweep[e.tone] <= 20;
  });
}

export function SignalChart({ res, colorOf, focus, setFocus, simple = false, onNeedMore, loadingMore = false }: { res: SignalsResponse; colorOf: (id: string) => string; focus: string | null; setFocus: (id: string | null) => void; simple?: boolean; onNeedMore?: () => void; loadingMore?: boolean }) {
  const { t, tx, dir } = useI18n();
  const holder = useRef<HTMLDivElement>(null);
  const [showInd, setShowInd] = useState<Record<string, boolean>>({});
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  // A strategy is drawn in detail (indicators, every trade's levels, labelled entries/exits, events) when its
  // "indicators" switch is on or it is focused; otherwise only its numbered entry arrows are shown.
  const detailed = useCallback((id: string) => showInd[id] ?? focus === id, [showInd, focus]);
  // The chart is created once; refreshes only replace its data so the user's zoom and scroll are kept.
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const extrasRef = useRef<{ series: ISeriesApi<'Line'>[]; lines: IPriceLine[] }>({ series: [], lines: [] });
  const viewRef = useRef<{ key: string; firstT: number | null }>({ key: '', firstT: null });
  const hoverRef = useRef<(p: MouseEventParams<Time>) => void>(() => undefined);
  const needMoreRef = useRef<(() => void) | undefined>(onNeedMore);
  needMoreRef.current = loadingMore ? undefined : onNeedMore;

  useEffect(() => {
    if (!holder.current) return;
    const chart = createChart(holder.current, {
      autoSize: true,
      crosshair: { mode: CrosshairMode.Normal },
      // A small minimum bar spacing lets the user zoom out to the whole loaded history (and trigger loading more).
      timeScale: { timeVisible: true, secondsVisible: false, minBarSpacing: 0.05, rightOffset: 5 },
    });
    chartRef.current = chart;
    candlesRef.current = chart.addSeries(CandlestickSeries, { upColor: '#26A69A', downColor: '#EF5350', wickUpColor: '#26A69A', wickDownColor: '#EF5350', borderVisible: false });
    markersRef.current = createSeriesMarkers(candlesRef.current, []);
    chart.subscribeCrosshairMove((p) => hoverRef.current(p));
    // Scrolling or zooming out to the oldest loaded candle asks for more history.
    const onRange = (r: LogicalRange | null) => {
      if (r && r.from < 3) needMoreRef.current?.();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      markersRef.current = null;
      extrasRef.current = { series: [], lines: [] };
      viewRef.current = { key: '', firstT: null };
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || !candles) return;
    const bars = res.bars;
    const ts = chart.timeScale();
    const prevRange = ts.getVisibleLogicalRange();
    // Colours follow the current theme.
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: css('--surface', '#1a1a19') }, textColor: css('--ink-3', '#9d9c95'), fontSize: 11 },
      grid: { vertLines: { color: css('--grid', '#2c2c2a') }, horzLines: { color: css('--grid', '#2c2c2a') } },
      rightPriceScale: { borderColor: css('--line', '#2c2c2a') },
      timeScale: { borderColor: css('--line', '#2c2c2a') },
    });
    // Remove the previous drawing (indicator/level lines and price lines); the candle series stays.
    for (const x of extrasRef.current.series) chart.removeSeries(x);
    for (const l of extrasRef.current.lines) candles.removePriceLine(l);
    extrasRef.current = { series: [], lines: [] };
    const time = (t: number) => (t / 1000) as UTCTimestamp;
    candles.setData(bars.map((b) => ({ time: time(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    const line = (values: (number | null)[], color: string, style: 'line' | 'step' | 'dotted' | undefined, width = 1) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width as 1 | 2, lineStyle: style === 'dotted' ? LineStyle.Dotted : LineStyle.Solid, lineType: style === 'step' ? LineType.WithSteps : LineType.Simple, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      // Values exist for closed bars only; the forming bar (if shown) gets no value.
      s.setData(bars.map((b, i) => (values[i] != null ? { time: time(b.t), value: values[i] as number } : { time: time(b.t) })));
      extrasRef.current.series.push(s);
    };
    const lastClose = bars[bars.length - 1]?.c ?? 0;
    const dp = Math.min(6, Math.max(2, String(lastClose).split('.')[1]?.length ?? 2));
    const detailedCount = res.signals.filter((x) => detailed(x.strategyId) && (!focus || focus === x.strategyId)).length;
    const ms: SeriesMarker<Time>[] = [];
    const compact = new Map<string, { t: number; dir: 1 | -1; ids: number[]; strong: boolean; color: string }>();
    const idxOf = new Map(bars.map((b, i) => [b.t, i]));
    res.signals.forEach((s, k) => {
      if (focus && focus !== s.strategyId) return;
      const c = colorOf(s.strategyId);
      if (!detailed(s.strategyId)) {
        for (const mk of s.markers) {
          const key = `${mk.t}:${mk.dir}`;
          const g = compact.get(key) ?? { t: mk.t, dir: mk.dir, ids: [], strong: false, color: c };
          g.ids.push(k + 1);
          g.strong ||= mk.text.includes('STRONG');
          if (g.ids.length > 1) g.color = mk.dir === 1 ? '#26A69A' : '#EF5350';
          compact.set(key, g);
        }
        return;
      }
      // Simple view: only the structure that led to an entry (the 40 candles before it, same direction) is drawn.
      const entries = s.markers.map((m) => ({ i: idxOf.get(m.t) ?? -1, dir: m.dir }));
      const near = (i: number, dir: 1 | -1 | 0) => entries.some((e) => (dir === 0 || e.dir === dir) && i <= e.i && i >= e.i - 40);
      for (const ind of s.indicators) {
        if (full) {
          line(ind.values, ind.color, ind.style);
          continue;
        }
        if (/order block|liquidity|Equilibrium/i.test(ind.name)) continue;
        const fvgDir = /Bullish FVG/.test(ind.name) ? 1 : /Bearish FVG/.test(ind.name) ? -1 : 0;
        line(fvgDir ? ind.values.map((v, i) => (near(i, fvgDir) ? v : null)) : ind.values, ind.color, ind.style);
      }
      if (s.levels) {
        line(s.levels.entry, c, 'step');
        line(s.levels.stop, '#EF5350', 'step', 2);
        line(s.levels.tp1, '#26A69A99', 'step');
        line(s.levels.tp2, '#26A69ACC', 'step');
        line(s.levels.final, '#26A69A', 'step', 2);
      }
      const prefix = detailedCount > 1 ? `${k + 1} ` : '';
      for (const mk of s.markers)
        ms.push({
          time: time(mk.t),
          position: mk.dir === 1 ? 'belowBar' : 'aboveBar',
          shape: mk.dir === 1 ? 'arrowUp' : 'arrowDown',
          color: mk.dir === 1 ? '#00C853' : '#FF1744',
          size: 2,
          text: `${prefix}${t(mk.dir === 1 ? 'BUY' : 'SELL')}${mk.text.includes('STRONG') ? ' ★' : ''} ${mk.price !== null ? fmt(mk.price, dp) : ''}`,
        });
      for (const x of s.exits) {
        const r = /([+-]?\d+\.\d+)R/.exec(x.detail)?.[1];
        ms.push({ time: time(x.t), position: x.dir === 1 ? 'aboveBar' : 'belowBar', shape: 'circle', color: x.good ? '#26A69A' : '#EF5350', text: `${x.text}${r ? ` ${r}R` : ''}` });
      }
      const evs = full ? relevantEvents(s.events, bars) : setupChain(s.events, entries, idxOf);
      // In the simple view setup labels sit on the opposite side of the candle from the BUY/SELL label so the entry stays readable.
      const pos = (e: StrategySignal['events'][number]) => (full ? (e.side === 'above' ? 'aboveBar' : 'belowBar') : e.tone === 'bear' ? 'belowBar' : e.tone === 'bull' ? 'aboveBar' : e.side === 'above' ? 'aboveBar' : 'belowBar');
      for (const e of evs) ms.push({ time: time(e.t), position: pos(e), shape: 'square', color: e.tone === 'bull' ? '#4DB6AC' : e.tone === 'bear' ? '#E57373' : '#9E9E9E', text: t(eventLabel(e.text)) });
    });
    for (const g of compact.values()) ms.push({ time: time(g.t), position: g.dir === 1 ? 'belowBar' : 'aboveBar', shape: g.dir === 1 ? 'arrowUp' : 'arrowDown', color: g.color, text: `${g.ids.join(',')}${g.strong ? '★' : ''}` });
    const first = bars[0]?.t ?? 0;
    markersRef.current?.setMarkers(ms.filter((m) => (m.time as number) * 1000 >= first).sort((a, b) => (a.time as number) - (b.time as number)));
    res.signals.forEach((s, k) => {
      if (s.state === 'NO TRADE' || s.entry === null || s.stop === null || (focus && focus !== s.strategyId)) return;
      extrasRef.current.lines.push(candles.createPriceLine({ price: s.entry, color: s.state === 'BUY' ? '#00C853' : '#FF1744', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${k + 1} ${t(s.state)} ${t('Entry')}` }));
      extrasRef.current.lines.push(candles.createPriceLine({ price: s.stop, color: '#EF5350', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${k + 1} ${t('SL')}` }));
      s.targets.forEach((x, j) => extrasRef.current.lines.push(candles.createPriceLine({ price: x, color: '#26A69A', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${k + 1} ${t('TP')}${j + 1}` })));
    });
    hoverRef.current = (p) => {
      if (!p.time) return setHover(null);
      const at = (p.time as number) * 1000;
      const hits = res.signals.flatMap((s, k) => {
        if (focus && focus !== s.strategyId) return [];
        const own = s.markers.filter((m) => m.t === at).map((m) => `${tx(m.detail)}${m.why.length ? `\n   ${t('Why: {list}', { list: m.why.map((w) => `✓ ${t(w)}`).join('  ') })}` : ''}`);
        if (detailed(s.strategyId)) own.push(...s.exits.filter((m) => m.t === at).map((m) => t('Exit: {d}', { d: tx(m.detail) })), ...s.events.filter((m) => m.t === at).map((m) => tx(m.detail)));
        return own.map((d) => `${k + 1}. ${t(s.strategyName)}: ${d}`);
      });
      setHover(hits.length ? hits.join('\n') : null);
    };
    // View: reset only when the asset, timeframe or focused strategy changes; otherwise keep the user's zoom.
    const key = `${res.market.source}|${res.market.ticker}|${res.market.tf}|${focus ?? ''}`;
    if (key !== viewRef.current.key || !prevRange) {
      // Default: the last 200 candles, widened so an open trade's entry candle is visible for detailed strategies.
      const entryIdx = res.signals
        .filter((s) => s.signalTime && detailed(s.strategyId) && (!focus || focus === s.strategyId))
        .map((s) => idxOf.get(Date.parse(s.signalTime!)) ?? -1)
        .filter((i) => i >= 0);
      const from = Math.max(0, Math.min(bars.length - 200, ...entryIdx.map((i) => i - 60)));
      ts.setVisibleLogicalRange({ from, to: bars.length + 5 });
    } else {
      // Older candles may have been added at the start: shift the range so the same candles stay in view.
      const shift = viewRef.current.firstT !== null ? Math.max(0, idxOf.get(viewRef.current.firstT) ?? 0) : 0;
      if (shift) ts.setVisibleLogicalRange({ from: prevRange.from + shift, to: prevRange.to + shift });
    }
    viewRef.current = { key, firstT: bars[0]?.t ?? null };
  }, [res, colorOf, focus, detailed, full, t, tx]);
  const bannerDp = Math.min(6, Math.max(2, String(res.bars[res.bars.length - 1]?.c ?? 0).split('.')[1]?.length ?? 2));
  const shown = res.signals.map((s, k) => ({ s, k })).filter(({ s }) => detailed(s.strategyId) && (!focus || focus === s.strategyId));
  return (
    <div>
      <div className="row" style={{ fontSize: 12, padding: '8px 16px', display: simple ? 'none' : undefined }}>
        {res.signals.map((s, k) => {
          const on = detailed(s.strategyId);
          return (
            <span key={s.strategyId} className="row" style={{ gap: 4 }}>
              <button className={`btn sm ${focus === s.strategyId ? '' : 'ghost'}`} onClick={() => setFocus(focus === s.strategyId ? null : s.strategyId)} title={t('Show only this strategy')}>
                <span className="swatch" style={{ background: colorOf(s.strategyId) }} />
                {k + 1}. {t(s.strategyName)}
              </button>
              <label className="row" style={{ gap: 3 }} title={t("Draw this strategy's indicators, every trade's entry / stop / targets, exits and structure events")}>
                <input type="checkbox" checked={on} onChange={() => setShowInd({ ...showInd, [s.strategyId]: !on })} />
                {t('indicators')}
              </label>
            </span>
          );
        })}
        <label className="row" style={{ gap: 3, marginInlineStart: 'auto' }} title={t('Off: only the structure that led to each entry. On: every sweep, BOS/CHoCH, FVG, order block and liquidity line.')}>
          <input type="checkbox" checked={full} onChange={() => setFull(!full)} />
          {t('full detail')}
        </label>
      </div>
      <div style={{ position: 'relative' }} dir="ltr">
        <div ref={holder} style={{ height: 500 }} />
        {loadingMore && <div className="chart-loading">Loading older candles…</div>}
        <div className="chart-banner">
          {res.signals.map((s, k) =>
            s.state === 'NO TRADE' || s.entry === null || s.stop === null || (focus && focus !== s.strategyId) || (!focus && !detailed(s.strategyId)) ? null : (
              <div key={s.strategyId} className={`trade-pill ${s.state === 'BUY' ? 'buy' : 'sell'}`} dir={dir}>
                <b>{t('{n}. {side} @ {price}', { n: k + 1, side: t(s.state), price: fmt(s.entry, bannerDp) })}</b>
                <span>{t('SL {sl} · TP {tp}', { sl: fmt(s.stop, bannerDp), tp: s.targets.map((x) => fmt(x, bannerDp)).join(' / ') })}</span>
                <span className="muted">{t('{name} · since {time} UTC', { name: t(s.strategyName), time: s.signalTime ? new Date(s.signalTime).toISOString().slice(5, 16).replace('T', ' ') : '—' })}</span>
              </div>
            ),
          )}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, padding: '8px 16px 4px', whiteSpace: 'pre-line', minHeight: 34 }}>
        {hover ?? t('Hover a candle with a label for the full explanation. Numbered arrows = entry signals (★ = strong; green/red = several strategies on one candle). Tick "indicators" (or focus a strategy) to see its full drawing.')}
      </div>
      {(simple ? [] : shown).map(({ s, k }) => {
        const tr = t;
        const names = [...new Map(s.indicators.map((i) => [i.name.replace(/ (top|bottom)$/, ''), i.color])).entries()];
        const evs = [...new Set(s.events.map((e) => e.text))].filter((x) => EVENT_GLOSSARY[x]);
        const other = [...new Set(s.events.map((e) => e.text))].filter((x) => !EVENT_GLOSSARY[x]);
        return (
          <div key={s.strategyId} className="chart-legend">
            <b>
              <span className="swatch" style={{ background: colorOf(s.strategyId) }} /> {k + 1}. {t(s.strategyName)}
            </b>
            <span>
              <i className="lg-arrow" style={{ color: '#089981' }}>▲</i>
              <i className="lg-arrow" style={{ color: '#F23645' }}>▼</i> <b style={{ width: 'auto' }}>{t('BUY / SELL + price')}</b>
              {t(' = entry: the signal confirms when the candle closes; the price shown is the fill at the next candle open')}
            </span>
            <span>
              <i className="lg-line" style={{ background: colorOf(s.strategyId) }} />
              {t(' entry · ')}
              <i className="lg-line" style={{ background: '#EF5350', height: 2 }} />
              {t(' stop-loss (moves on breakeven/trailing) · ')}
              <i className="lg-line" style={{ background: '#26A69A' }} />
              {t(' take-profit levels, drawn while each trade is open')}
            </span>
            <span>
              <i className="lg-dot" style={{ background: '#26A69A' }} />/<i className="lg-dot" style={{ background: '#EF5350' }} />
              {t(' exits: TP1/TP2/TP3 = target hit, SL = stop hit, “Rule exit” = strategy exit rule, with the trade result in R')}
            </span>
            {names.map(([n, c]) => (
              <span key={n}>
                <i className="lg-line" style={{ background: c }} /> {n}
              </span>
            ))}
            {evs.map((ev) => (
              <span key={ev}>
                <i className="lg-sq" /> {tr(EVENT_GLOSSARY[ev])}
              </span>
            ))}
            {other.length > 0 && (
              <span>
                <i className="lg-sq" /> {tr('Other labels: {list} — hover for details', { list: other.join(', ') })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PerfLine({ label, p }: { label: string; p: StrategySignal['all'] }) {
  const { t } = useI18n();
  if (!p.trades)
    return (
      <div>
        <span className="muted">{t(label)}:</span> {t('0 trades')}
      </div>
    );
  return (
    <div>
      <span className="muted">{t(label)}:</span> {t('{n} trades · win {w}%', { n: p.trades, w: fmt(p.winRate, 0) })}
      {p.breakEvenWinRate !== null && <span className="muted">{t(' (break-even {b}%)', { b: fmt(p.breakEvenWinRate, 0) })}</span>}
      {t(' · exp ')}
      <b className={(p.expectancyR ?? 0) >= 0 ? 'good-ink' : 'bad-ink'}>{fmt(p.expectancyR, 2)}R</b>
      {t(' · PF {pf} · max DD {dd}R', { pf: p.profitFactor === null ? '—' : fmt(p.profitFactor, 2), dd: fmt(p.maxDrawdownR, 1) })}
    </div>
  );
}

function SignalCard({ s, market, dp, tz, color, focused, onFocus, onSave, onScript }: { s: StrategySignal; market: MarketInfo; dp: number; tz: Tz; color: string; focused: boolean; onFocus: () => void; onSave: () => void; onScript: () => Promise<void> }) {
  const { t, tx } = useI18n();
  const [busy, setBusy] = useState(false);
  const stage = t(s.stage === 'confirmed' ? (s.isNew ? 'Confirmed entry · new' : 'Confirmed entry · active') : s.stage === 'setup' ? `Developing ${s.setupDir === 1 ? 'long' : 'short'} setup — not an entry` : 'No position');
  const evidence = t(s.all.trades >= 30 && s.outOfSample.trades >= 10 ? 'Adequate sample' : 'Small sample — weak evidence');
  return (
    <section className="card signal-card" style={{ borderTop: `3px solid ${color}`, outline: focused ? `2px solid ${color}` : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div>
          <b>{t(s.strategyName)}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {t(s.category)} · {t(s.family)} · {market.ticker} {tfLabel(market.tf)} · v{s.strategyVersion.slice(0, 7)}
          </div>
        </div>
        <Badge tone={stateTone(s.state)} dot>
          {t(s.state)}
        </Badge>
      </div>
      <div style={{ fontSize: 13, margin: '8px 0 4px' }}>
        <b>{stage}</b>
        {s.ruleScore !== null && <span className="muted">{t(' · rule score {n}/100', { n: Math.round(s.ruleScore) })}</span>}
      </div>
      {s.state !== 'NO TRADE' && s.entry !== null && s.stop !== null && (
        <div className="levels">
          <div>
            <span className="muted">{t('Entry')}</span> <span className="mono">{fmt(s.entry, dp)}</span>
          </div>
          <div>
            <span className="muted">{t('Stop')}</span> <span className="mono bad-ink">{fmt(s.stop, dp)}</span>
          </div>
          {s.targets.map((x, j) => (
            <div key={j}>
              <span className="muted">
                {t('TP')} {j + 1}
              </span>{' '}
              <span className="mono good-ink">{fmt(x, dp)}</span>
            </div>
          ))}
          <div>
            <span className="muted">{t('R:R')}</span> <span className="mono">{s.rewardRisk === null ? '—' : fmt(s.rewardRisk, 2)}</span>
          </div>
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
        {tx(s.reason)}
        {s.signalTime && t(' Signal candle: {time}.', { time: fmtTime(s.signalTime, tz) })}
        {s.pendingFill && t(' The entry shown is the signal close; the market order fills at the next candle open.')}
      </div>
      {s.reasons.length > 0 && (
        <details open={s.stage !== 'none'}>
          <summary className="sum">{t(s.stage === 'setup' ? 'Why — rule checks at the last candle' : 'Why — rule checks at the signal candle')}</summary>
          <ul className="checks">
            {s.reasons.map((r) => (
              <li key={r.label + r.role} className={r.met ? 'good-ink' : 'bad-ink'}>
                {r.met ? '✓' : '✗'} {t(r.label)} <span className="muted">({t(r.role)})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.invalidation.length > 0 && (
        <details>
          <summary className="sum">{t('What invalidates it')}</summary>
          <ul className="checks">
            {s.invalidation.map((x) => (
              <li key={x}>{tx(x)}</li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="sum">{t('Rules')}</summary>
        <div style={{ fontSize: 12 }} dir="auto">
          <p style={{ margin: '4px 0' }}>
            <b>{t('Entry:')}</b> {s.entryLogic}
          </p>
          <p style={{ margin: '4px 0' }}>
            <b>{t('Exit:')}</b> {s.exitLogic}
          </p>
          {!s.tfOk && <p className="warn-ink">{s.tfNote}</p>}
        </div>
      </details>
      <ProbLine p={s.probability.all} recent={s.probability.outOfSample} avgWin={s.all.avgWinR} avgLoss={s.all.avgLossR} />
      <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
        <PerfLine label="Out-of-sample (last 30%)" p={s.outOfSample} />
        <PerfLine label="All loaded history" p={s.all} />
        <div className="muted">
          {evidence}. {s.all.ambiguous > 0 && t('{n} trade(s) had a target and the stop in one candle and were counted at the stop. ', { n: s.all.ambiguous })}
          {tx(s.costNote)}
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm primary" disabled={s.state === 'NO TRADE'} onClick={onSave} title={t(s.state === 'NO TRADE' ? 'Only BUY or SELL signals can be saved' : 'Save this signal, its levels and the strategy version')}>
          {t('Save opportunity')}
        </button>
        <button className="btn sm" onClick={onFocus}>
          {t(focused ? 'Show all on chart' : 'Focus on chart')}
        </button>
        <button
          className="btn sm ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onScript();
            setBusy(false);
          }}
          title={t('Open the Pine v6 script for this strategy and timeframe (reuses an identical stored version)')}
        >
          {busy ? <Spinner /> : t('Pine script')}
        </button>
      </div>
    </section>
  );
}

function RankingPanel({ inst, tf, onActivate }: { inst: Inst; tf: string; onActivate: (id: string) => void }) {
  const { t, tx, lang } = useI18n();
  const [data, setData] = useState<Rankings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setErr(null);
  }, [inst, tf]);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await api.rankings({ source: inst.source, ticker: inst.ticker, tf }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={t('Strategy ranking on this market')}
      className="mb"
      actions={
        <button className="btn sm" onClick={run} disabled={busy}>
          {busy ? <Spinner /> : t('Test all strategies')}
        </button>
      }
    >
      {err && <div className="bad-ink">{tx(err)}</div>}
      {!data && !err && <div className="muted">{t('Runs every strategy on the same closed candles with the same costs and fills, then ranks by out-of-sample results. Strategies without enough trades are marked as insufficient evidence.')}</div>}
      {data && (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {t('{count} candles of {ticker} {tf} from {from} to {to}.', { count: data.bars.count, ticker: data.market.ticker, tf: tfLabel(data.market.tf), from: data.bars.from.slice(0, 10), to: data.bars.to?.slice(0, 10) ?? '' })}{' '}
            {lang === 'ar' ? t('Every strategy runs with the same execution model (next-candle-open fills, commission + slippage, a target and stop inside one candle count as a stop). Ranked by out-of-sample expectancy (last 30% of candles, after costs). "Sufficient" needs ≥ {min} trades and ≥ {oos} out-of-sample trades. Past results on one market and period do not predict future results.', { min: data.minTrades, oos: data.minOos }) : data.method}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('Strategy')}</th>
                  <th>{t('Evidence')}</th>
                  <th title={t('Trades entered in the last 30% of candles')}>{t('OOS trades')}</th>
                  <th title={t('Average result per trade after costs, out-of-sample')}>{t('OOS expectancy')}</th>
                  <th>{t('All trades')}</th>
                  <th>{t('Win rate (break-even)')}</th>
                  <th>{t('Profit factor')}</th>
                  <th>{t('Max DD')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, k) => (
                  <tr key={r.strategyId} style={{ opacity: r.evidence === 'high' ? 1 : 0.75 }}>
                    <td>{r.evidence === 'high' ? k + 1 : '—'}</td>
                    <td>
                      {t(r.strategyName)}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {t(r.family)}
                        {!r.tfOk && t(' · outside designed timeframe')} · {t(REVIEW_BADGE[r.review].label)}
                      </div>
                    </td>
                    <td>
                      <Badge tone={r.evidence === 'high' ? 'good' : r.evidence === 'low' ? 'warn' : 'neutral'}>{t(r.evidence === 'high' ? 'sufficient' : r.evidence === 'low' ? 'insufficient' : 'no trades')}</Badge>
                    </td>
                    <td className="mono">{r.outOfSample.trades}</td>
                    <td className={`mono ${(r.outOfSample.expectancyR ?? 0) >= 0 ? 'good-ink' : 'bad-ink'}`}>{r.outOfSample.trades ? `${fmt(r.outOfSample.expectancyR, 2)}R` : '—'}</td>
                    <td className="mono">{r.all.trades}</td>
                    <td className="mono">
                      {r.all.winRate === null ? '—' : `${fmt(r.all.winRate, 0)}%`}
                      {r.all.breakEvenWinRate !== null && <span className="muted"> ({fmt(r.all.breakEvenWinRate, 0)}%)</span>}
                    </td>
                    <td className="mono">{r.all.profitFactor === null ? '—' : fmt(r.all.profitFactor, 2)}</td>
                    <td className="mono">{fmt(r.all.maxDrawdownR, 1)}R</td>
                    <td>
                      <button className="btn sm ghost" onClick={() => onActivate(r.strategyId)}>
                        {t('Activate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function SavedOpportunities({ opps, setOpps, dp, tz }: { opps: Opportunity[]; setOpps: (f: (x: Opportunity[]) => Opportunity[]) => void; dp: number; tz: Tz }) {
  const { t, tx } = useI18n();
  const [evals, setEvals] = useState<Record<string, OutcomeEval | string>>({});
  const evaluate = async (id: string) => {
    setEvals((e) => ({ ...e, [id]: 'loading' }));
    try {
      const r = await api.evaluateOpportunity(id);
      setEvals((e) => ({ ...e, [id]: r }));
    } catch (e) {
      setEvals((x) => ({ ...x, [id]: (e as Error).message }));
    }
  };
  const remove = async (id: string) => {
    await api.deleteOpportunity(id).catch(() => undefined);
    setOpps((x) => x.filter((o) => o.id !== id));
  };
  return (
    <Card title={t('Saved opportunities ({n})', { n: opps.length })}>
      {!opps.length ? (
        <Empty>{t('Save a BUY or SELL signal to track what happens next. Saved signals are never edited.')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Saved')}</th>
                <th>{t('Asset')}</th>
                <th>{t('Strategy')}</th>
                <th>{t('Side')}</th>
                <th>{t('Entry / stop / targets')}</th>
                <th>{t('Outcome since saved')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {opps.map((o) => {
                const ev = evals[o.id];
                const snap = o.snapshot?.signal;
                return (
                  <tr key={o.id}>
                    <td title={fmtTime(o.createdAt, tz)}>{tx(ago(o.createdAt))}</td>
                    <td>
                      {o.ticker} · {tfLabel(o.tf)}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {t(o.instrument)}
                      </div>
                    </td>
                    <td>
                      {t(o.strategyName)}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {t('v{v} · signal {time}', { v: o.strategyVersion.slice(0, 7), time: fmtTime(o.signalTime, tz) })}
                      </div>
                      {snap?.reason && (
                        <details>
                          <summary className="sum">{t('Snapshot')}</summary>
                          <div style={{ fontSize: 12 }}>
                            {tx(snap.reason)}
                            {snap.reasons && (
                              <ul className="checks">
                                {snap.reasons.map((r) => (
                                  <li key={r.label + r.role}>
                                    {r.met ? '✓' : '✗'} {t(r.label)}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {o.snapshot.confluence && <div className="muted">{t('Confluence when saved: {label}', { label: tx(o.snapshot.confluence.label) })}</div>}
                          </div>
                        </details>
                      )}
                    </td>
                    <td>
                      <Badge tone={o.direction === 1 ? 'good' : 'bad'}>{t(o.direction === 1 ? 'BUY' : 'SELL')}</Badge>
                    </td>
                    <td className="mono">
                      {fmt(o.entry, dp)} / {fmt(o.stop, dp)} / {o.targets.map((x) => fmt(x, dp)).join(' / ')}
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      {ev === 'loading' ? (
                        <Spinner />
                      ) : typeof ev === 'string' ? (
                        <span className="bad-ink">{tx(ev)}</span>
                      ) : ev ? (
                        <div>
                          <Badge tone={ev.status === 'target' ? 'good' : ev.status === 'stopped' ? 'bad' : 'neutral'}>{t(ev.status)}</Badge> {ev.r !== null && <b className="mono">{fmt(ev.r, 2)}R</b>}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {tx(ev.note)} {t('{n} candle(s) checked · best {b}R · worst −{w}R', { n: ev.barsChecked, b: fmt(ev.mfeR, 2), w: fmt(ev.maeR, 2) })}
                          </div>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn sm" onClick={() => evaluate(o.id)}>
                          {t('Evaluate')}
                        </button>
                        <button className="btn sm ghost danger" onClick={() => remove(o.id)} aria-label={t('Delete')}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
