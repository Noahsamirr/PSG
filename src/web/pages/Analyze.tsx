// Primary workflow: pick an asset (GOLD by default) → activate strategies → read BUY / SELL / NO TRADE with levels,
// reasons and invalidation → compare agreement → save the opportunity → evaluate it later.
// Signals are computed on the server from closed bars with the app's deterministic strategy engine.
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, LineSeries, LineStyle, LineType, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Instrument, type MarketInfo, type Opportunity, type OutcomeEval, type Quote, type Rankings, type SignalsResponse, type StrategyInfo, type StrategySignal } from '../api';
import { ago, Badge, Card, Empty, fmt, Icon, Spinner, useApp, validationTone } from '../components/ui';
import { TF_LADDER, tfInRange, tfLabel } from '../../core/timeframe';

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const DEFAULT_STRATEGIES = ['ema_trend', 'bb_meanrev', 'macd_trend', 'squeeze_breakout'];
const MAX = SERIES.length;
type Inst = Pick<Instrument, 'source' | 'ticker' | 'name'>;
const GOLD: Inst = { source: 'binancef', ticker: 'XAUUSDT', name: 'Gold perpetual (USDT-margined)' };

const css = (v: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
const stateTone = (s: string) => (s === 'BUY' ? 'good' : s === 'SELL' ? 'bad' : 'neutral') as 'good' | 'bad' | 'neutral';
const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
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
  const { toast, go } = useApp();
  const [inst, setInst] = useState<Inst>(() => load('pf-an-inst', GOLD));
  const [tf, setTf] = useState(() => load('pf-an-tf', '60'));
  const [tz, setTz] = useState<Tz>(() => load('pf-an-tz', 'utc'));
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
      setRes(await api.signals({ source: inst.source, ticker: inst.ticker, tf, strategies: selected, activated }));
    } catch (e) {
      setErr((e as Error).message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  }, [inst, tf, selected]);
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
        toast(`Up to ${MAX} strategies at once — deactivate one first.`, 'bad');
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
      toast('Opportunity saved with its strategy version and market snapshot.', 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const openScript = async (sig: StrategySignal) => {
    try {
      const r = await api.strategyScript({ strategyId: sig.strategyId, tf, symbol: res?.market.ticker ?? inst.ticker });
      const v = validationTone(r.validation);
      toast(`${r.reused ? 'Reused stored' : 'Generated new'} Pine v6 script (v${r.version}) — static checks: ${v.label}. TradingView compile not yet recorded.`, v.tone === 'bad' ? 'bad' : 'ok');
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
          <h1>Market dashboard</h1>
          <p>Choose an asset and activate strategies. Signals use closed candles from the named data source. Agreement between strategies describes the rules — it is not a probability of profit. Not investment advice.</p>
        </div>
        <label className="field" style={{ width: 120 }}>
          Times in
          <select value={tz} onChange={(e) => setTz(e.target.value as Tz)}>
            <option value="utc">UTC</option>
            <option value="local">Local time</option>
          </select>
        </label>
      </div>

      <div className="row mb" style={{ alignItems: 'flex-end' }}>
        <AssetPicker value={inst} onChange={setInst} />
        <label className="field" style={{ width: 110 }}>
          Timeframe
          <select value={tf} onChange={(e) => setTf(e.target.value)}>
            {TF_LADDER.map((t) => (
              <option key={t} value={t}>
                {tfLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="refresh" size={15} />} Refresh
        </button>
        {inst.ticker !== GOLD.ticker && (
          <button className="btn ghost" onClick={() => setInst(GOLD)}>
            Back to gold
          </button>
        )}
      </div>

      <MarketHeader market={res?.market ?? null} err={err} busy={busy} dp={dp} quote={quote} tz={tz} bars={res?.bars ?? []} />

      <StrategyPicker strategies={strategies} slots={slots} tf={tf} colorOf={colorOf} onToggle={toggle} />

      {res && <ConfluenceBanner res={res} />}

      <Card title={res ? `${res.market.ticker} · ${tfLabel(res.market.tf)}` : 'Chart'} className="mb" pad={false}>
        {res && res.bars.length ? <SignalChart res={res} colorOf={colorOf} focus={focus} setFocus={setFocus} /> : <div style={{ padding: 16 }}>{busy ? <Spinner /> : <Empty>{err ?? 'Activate a strategy to see signals.'}</Empty>}</div>}
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

function AssetPicker({ value, onChange }: { value: Inst; onChange: (i: Inst) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Instrument[]>([]);
  const [info, setInfo] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api
        .searchInstruments(q)
        .then((r) => {
          setList(r.results);
          setInfo(`${r.total.toLocaleString()} instruments searchable${r.errors.length ? ` · ${r.errors.join('; ')}` : ''}`);
        })
        .catch((e) => setInfo((e as Error).message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);
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
      Asset
      <input
        value={open ? q : `${value.ticker} — ${value.name}`}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) pick(list[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search: gold, XAU, BTC, EURUSD, TSLA…"
        aria-label="Search assets"
        role="combobox"
        aria-expanded={open}
      />
      {open && (
        <div className="asset-menu" role="listbox">
          {list.map((x) => (
            <button key={x.id} role="option" aria-selected={x.ticker === value.ticker && x.source === value.source} className="asset-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(x)}>
              <span>
                <b>{x.ticker}</b> <span className="muted">{x.name}</span>
              </span>
              <span className="muted" style={{ fontSize: 11 }}>
                {x.kind}
                {x.needsKey ? ' · needs API key' : ''}
              </span>
            </button>
          ))}
          {!list.length && (
            <div className="muted" style={{ padding: 10 }}>
              No matching instrument.
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
  if (err)
    return (
      <div className="card card-pad mb" role="alert">
        <Badge tone="bad" dot>
          Data unavailable
        </Badge>{' '}
        {err}
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          No signals are generated without valid data. Try another source for the same asset, or another asset.
        </div>
      </div>
    );
  if (!m) return <div className="card card-pad mb">{busy ? <Spinner /> : 'Loading…'}</div>;
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
          {m.name}
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
              {fmt((100 * chAbs) / refClose, 2)}%) <span className="muted">24h</span>
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {q?.bid != null && q.ask != null ? `Bid ${fmt(q.bid, dp)} · Ask ${fmt(q.ask, dp)} · Spread ${fmt(q.spread, dp)}` : 'Bid/ask not provided by this source'}
          {q && ` · ${q.delayed ? 'last trade (delayed)' : 'mid of best bid/ask'}`}
        </div>
      </div>
      <div className="mh-meta">
        <div>
          <Badge tone={tone} dot>
            {status.toUpperCase()}
          </Badge>{' '}
          <span className="muted" style={{ fontSize: 12 }}>
            quote {qTime ? `${fmtTime(qTime, tz)}${q?.exchangeTime ? ' (exchange time)' : ' (time received)'}` : '—'}
          </span>
        </div>
        <div style={{ fontSize: 12 }}>
          <b>{m.instrument}</b>
          <div className="muted">
            {m.provider} · {m.session}
            {m.isProxy && ' · proxy for the requested symbol'}
          </div>
          <div className="muted">Last closed candle {fmtTime(d.lastClosedAt, tz)}</div>
        </div>
        {m.crossCheck && (
          <div className="muted" style={{ fontSize: 12 }} title={m.crossCheck.note}>
            Cross-check vs {m.crossCheck.ticker}: {fmt(m.crossCheck.last, dp)} (difference {m.crossCheck.diffPct >= 0 ? '+' : ''}
            {fmt(m.crossCheck.diffPct, 2)}%)
          </div>
        )}
        {disconnected && (
          <div className="bad-ink" style={{ fontSize: 12 }}>
            Live quote failed: {quote?.error}. Showing the last known values.
          </div>
        )}
        {d.issues.map((i) => (
          <div key={i} className="warn-ink" style={{ fontSize: 12 }}>
            {i}
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
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => load('pf-an-lib-open', true));
  useEffect(() => save('pf-an-lib-open', open), [open]);
  const filtered = strategies.filter((s) => !q || `${s.name} ${s.category} ${s.family} ${s.summary}`.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(filtered.map((s) => s.category))];
  const active = strategies.filter((s) => s.id in slots);
  return (
    <Card
      title={`Strategies · ${active.length} active`}
      className="mb"
      actions={
        <>
          <input className="input-sm" placeholder="Search strategies…" value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} aria-label="Search strategies" />
          <button className="btn sm ghost" onClick={() => setOpen(!open)}>
            {open ? 'Hide library' : 'Show library'}
          </button>
        </>
      }
    >
      {active.length > 0 && (
        <div className="row" style={{ marginBottom: open ? 12 : 0 }}>
          {active.map((s) => (
            <span key={s.id} className="active-chip" style={{ borderColor: colorOf(s.id) }}>
              <span className="swatch" style={{ background: colorOf(s.id) }} />
              {s.name}
              <button className="btn ghost icon" style={{ width: 22, height: 22 }} onClick={() => onToggle(s.id)} aria-label={`Deactivate ${s.name}`}>
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
                {c}
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
                        <b>{s.name}</b> <Badge tone={rb.tone}>{rb.label}</Badge>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {s.summary} · {s.family} · designed for {s.timeframes}
                          {!fits && <span className="warn-ink"> · outside the selected timeframe</span>}
                        </div>
                      </div>
                      <button className={`btn sm ${on ? '' : 'primary'}`} onClick={() => onToggle(s.id)} disabled={!on && s.review.status === 'deprecated'} title={s.review.status === 'deprecated' ? `Deprecated: ${s.review.note}` : undefined}>
                        {on ? 'Deactivate' : 'Activate strategy'}
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
  const c = res.confluence;
  const names = (state: string) => res.signals.filter((s) => s.state === state).map((s) => s.strategyName);
  return (
    <div className="card card-pad mb" style={{ borderLeft: `4px solid var(--${c.state === 'BUY' ? 'good' : c.state === 'SELL' ? 'bad' : 'line-strong'})` }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <span style={{ fontSize: 20, fontWeight: 700 }}>{c.state}</span>
          <span>{c.label}</span>
        </div>
        <div className="row" style={{ fontSize: 12 }}>
          <span title="Share of independent strategy families agreeing with the leading direction. Not a probability.">
            Confluence score <b>{c.score}</b>/100
          </span>
          <Badge tone="good">{c.agreeing} agree</Badge>
          <Badge tone={c.disagreeing ? 'bad' : 'neutral'}>{c.disagreeing} disagree</Badge>
        </div>
      </div>
      <div className="row" style={{ fontSize: 12, marginTop: 6 }}>
        {c.buyFamilies.length > 0 && <Badge tone="good">BUY: {c.buyFamilies.join(', ')}</Badge>}
        {c.sellFamilies.length > 0 && <Badge tone="bad">SELL: {c.sellFamilies.join(', ')}</Badge>}
        {c.splitFamilies.length > 0 && <Badge tone="warn">split: {c.splitFamilies.join(', ')}</Badge>}
        {c.neutralFamilies.length > 0 && <Badge>flat: {c.neutralFamilies.join(', ')}</Badge>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {names('BUY').length > 0 && `Long: ${names('BUY').join(', ')}. `}
        {names('SELL').length > 0 && `Short: ${names('SELL').join(', ')}. `}
        {c.explanation}
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

function SignalChart({ res, colorOf, focus, setFocus }: { res: SignalsResponse; colorOf: (id: string) => string; focus: string | null; setFocus: (id: string | null) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [showInd, setShowInd] = useState<Record<string, boolean>>({});
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  // A strategy is drawn in detail (indicators, every trade's levels, labelled entries/exits, events) when its
  // "indicators" switch is on or it is focused; otherwise only its numbered entry arrows are shown.
  const detailed = useCallback((id: string) => showInd[id] ?? focus === id, [showInd, focus]);
  useEffect(() => {
    if (!holder.current) return;
    const bars = res.bars;
    const chart = createChart(holder.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: css('--surface', '#1a1a19') }, textColor: css('--ink-3', '#9d9c95'), fontSize: 11 },
      grid: { vertLines: { color: css('--grid', '#2c2c2a') }, horzLines: { color: css('--grid', '#2c2c2a') } },
      rightPriceScale: { borderColor: css('--line', '#2c2c2a') },
      timeScale: { borderColor: css('--line', '#2c2c2a'), timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const time = (t: number) => (t / 1000) as UTCTimestamp;
    const candles = chart.addSeries(CandlestickSeries, { upColor: '#26A69A', downColor: '#EF5350', wickUpColor: '#26A69A', wickDownColor: '#EF5350', borderVisible: false });
    candles.setData(bars.map((b) => ({ time: time(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    const line = (values: (number | null)[], color: string, style: 'line' | 'step' | 'dotted' | undefined, width = 1) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width as 1 | 2, lineStyle: style === 'dotted' ? LineStyle.Dotted : LineStyle.Solid, lineType: style === 'step' ? LineType.WithSteps : LineType.Simple, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      // Values exist for closed bars only; the forming bar (if shown) gets no value.
      s.setData(bars.map((b, i) => (values[i] != null ? { time: time(b.t), value: values[i] as number } : { time: time(b.t) })));
    };
    const lastClose = bars[bars.length - 1]?.c ?? 0;
    const dp = Math.min(6, Math.max(2, String(lastClose).split('.')[1]?.length ?? 2));
    const detailedCount = res.signals.filter((x) => detailed(x.strategyId) && (!focus || focus === x.strategyId)).length;
    const ms: SeriesMarker<Time>[] = [];
    const compact = new Map<string, { t: number; dir: 1 | -1; ids: number[]; strong: boolean; color: string }>();
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
      const idxOf = new Map(bars.map((b, i) => [b.t, i]));
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
          text: `${prefix}${mk.dir === 1 ? 'BUY' : 'SELL'}${mk.text.includes('STRONG') ? ' ★' : ''} ${mk.price !== null ? fmt(mk.price, dp) : ''}`,
        });
      for (const x of s.exits) {
        const r = /([+-]?\d+\.\d+)R/.exec(x.detail)?.[1];
        ms.push({ time: time(x.t), position: x.dir === 1 ? 'aboveBar' : 'belowBar', shape: 'circle', color: x.good ? '#26A69A' : '#EF5350', text: `${x.text}${r ? ` ${r}R` : ''}` });
      }
      const evs = full ? relevantEvents(s.events, bars) : setupChain(s.events, entries, idxOf);
      // In the simple view setup labels sit on the opposite side of the candle from the BUY/SELL label so the entry stays readable.
      const pos = (e: StrategySignal['events'][number]) => (full ? (e.side === 'above' ? 'aboveBar' : 'belowBar') : e.tone === 'bear' ? 'belowBar' : e.tone === 'bull' ? 'aboveBar' : e.side === 'above' ? 'aboveBar' : 'belowBar');
      for (const e of evs) ms.push({ time: time(e.t), position: pos(e), shape: 'square', color: e.tone === 'bull' ? '#4DB6AC' : e.tone === 'bear' ? '#E57373' : '#9E9E9E', text: eventLabel(e.text) });
    });
    for (const g of compact.values()) ms.push({ time: time(g.t), position: g.dir === 1 ? 'belowBar' : 'aboveBar', shape: g.dir === 1 ? 'arrowUp' : 'arrowDown', color: g.color, text: `${g.ids.join(',')}${g.strong ? '★' : ''}` });
    const first = bars[0]?.t ?? 0;
    createSeriesMarkers(
      candles,
      ms.filter((m) => (m.time as number) * 1000 >= first).sort((a, b) => (a.time as number) - (b.time as number)),
    );
    res.signals.forEach((s, k) => {
      if (s.state === 'NO TRADE' || s.entry === null || s.stop === null || (focus && focus !== s.strategyId)) return;
      candles.createPriceLine({ price: s.entry, color: s.state === 'BUY' ? '#00C853' : '#FF1744', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${k + 1} ${s.state} entry` });
      candles.createPriceLine({ price: s.stop, color: '#EF5350', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${k + 1} SL` });
      s.targets.forEach((t, j) => candles.createPriceLine({ price: t, color: '#26A69A', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${k + 1} TP${j + 1}` }));
    });
    chart.subscribeCrosshairMove((p) => {
      if (!p.time) return setHover(null);
      const t = (p.time as number) * 1000;
      const hits = res.signals.flatMap((s, k) => {
        if (focus && focus !== s.strategyId) return [];
        const own = s.markers.filter((m) => m.t === t).map((m) => `${m.detail}${m.why.length ? `\n   Why: ${m.why.map((w) => `✓ ${w}`).join('  ')}` : ''}`);
        if (detailed(s.strategyId)) own.push(...s.exits.filter((m) => m.t === t).map((m) => `Exit: ${m.detail}`), ...s.events.filter((m) => m.t === t).map((m) => m.detail));
        return own.map((d) => `${k + 1}. ${s.strategyName}: ${d}`);
      });
      setHover(hits.length ? hits.join('\n') : null);
    });
    // Default view: the last 200 candles, widened so an open trade's entry candle is visible for detailed strategies.
    const entryIdx = res.signals
      .filter((s) => s.signalTime && detailed(s.strategyId) && (!focus || focus === s.strategyId))
      .map((s) => bars.findIndex((b) => b.t === Date.parse(s.signalTime!)))
      .filter((i) => i >= 0);
    const from = Math.max(0, Math.min(bars.length - 200, ...entryIdx.map((i) => i - 60)));
    const zoom = () => chart.timeScale().setVisibleLogicalRange({ from, to: bars.length + 5 });
    zoom();
    const raf = requestAnimationFrame(() => setTimeout(zoom, 0));
    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
    };
  }, [res, colorOf, focus, detailed, full]);
  const bannerDp = Math.min(6, Math.max(2, String(res.bars[res.bars.length - 1]?.c ?? 0).split('.')[1]?.length ?? 2));
  const shown = res.signals.map((s, k) => ({ s, k })).filter(({ s }) => detailed(s.strategyId) && (!focus || focus === s.strategyId));
  return (
    <div>
      <div className="row" style={{ fontSize: 12, padding: '8px 16px' }}>
        {res.signals.map((s, k) => {
          const on = detailed(s.strategyId);
          return (
            <span key={s.strategyId} className="row" style={{ gap: 4 }}>
              <button className={`btn sm ${focus === s.strategyId ? '' : 'ghost'}`} onClick={() => setFocus(focus === s.strategyId ? null : s.strategyId)} title="Show only this strategy">
                <span className="swatch" style={{ background: colorOf(s.strategyId) }} />
                {k + 1}. {s.strategyName}
              </button>
              <label className="row" style={{ gap: 3 }} title="Draw this strategy's indicators, every trade's entry / stop / targets, exits and structure events">
                <input type="checkbox" checked={on} onChange={() => setShowInd({ ...showInd, [s.strategyId]: !on })} />
                indicators
              </label>
            </span>
          );
        })}
        <label className="row" style={{ gap: 3, marginLeft: 'auto' }} title="Off: only the structure that led to each entry. On: every sweep, BOS/CHoCH, FVG, order block and liquidity line.">
          <input type="checkbox" checked={full} onChange={() => setFull(!full)} />
          full detail
        </label>
      </div>
      <div style={{ position: 'relative' }}>
        <div ref={holder} style={{ height: 500 }} />
        <div className="chart-banner">
          {res.signals.map((s, k) =>
            s.state === 'NO TRADE' || s.entry === null || s.stop === null || (focus && focus !== s.strategyId) || (!focus && !detailed(s.strategyId)) ? null : (
              <div key={s.strategyId} className={`trade-pill ${s.state === 'BUY' ? 'buy' : 'sell'}`}>
                <b>
                  {k + 1}. {s.state} @ {fmt(s.entry, bannerDp)}
                </b>
                <span>
                  SL {fmt(s.stop, bannerDp)} · TP {s.targets.map((t) => fmt(t, bannerDp)).join(' / ')}
                </span>
                <span className="muted">
                  {s.strategyName} · since {s.signalTime ? new Date(s.signalTime).toISOString().slice(5, 16).replace('T', ' ') : '—'} UTC
                </span>
              </div>
            ),
          )}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, padding: '8px 16px 4px', whiteSpace: 'pre-line', minHeight: 34 }}>
        {hover ?? 'Hover a candle with a label for the full explanation. Numbered arrows = entry signals (★ = strong; green/red = several strategies on one candle). Tick "indicators" (or focus a strategy) to see its full drawing.'}
      </div>
      {shown.map(({ s, k }) => {
        const names = [...new Map(s.indicators.map((i) => [i.name.replace(/ (top|bottom)$/, ''), i.color])).entries()];
        const evs = [...new Set(s.events.map((e) => e.text))].filter((t) => EVENT_GLOSSARY[t]);
        const other = [...new Set(s.events.map((e) => e.text))].filter((t) => !EVENT_GLOSSARY[t]);
        return (
          <div key={s.strategyId} className="chart-legend">
            <b>
              <span className="swatch" style={{ background: colorOf(s.strategyId) }} /> {k + 1}. {s.strategyName}
            </b>
            <span>
              <i className="lg-arrow" style={{ color: '#089981' }}>▲</i>
              <i className="lg-arrow" style={{ color: '#F23645' }}>▼</i> <b style={{ width: 'auto' }}>BUY / SELL + price</b> = entry: the signal confirms when the candle closes; the price shown is the fill at the next candle open
            </span>
            <span>
              <i className="lg-line" style={{ background: colorOf(s.strategyId) }} /> entry · <i className="lg-line" style={{ background: '#EF5350', height: 2 }} /> stop-loss (moves on breakeven/trailing) · <i className="lg-line" style={{ background: '#26A69A' }} /> take-profit levels, drawn while each trade is open
            </span>
            <span>
              <i className="lg-dot" style={{ background: '#26A69A' }} />/<i className="lg-dot" style={{ background: '#EF5350' }} /> exits: TP1/TP2/TP3 = target hit, SL = stop hit, “Rule exit” = strategy exit rule, with the trade result in R
            </span>
            {names.map(([n, c]) => (
              <span key={n}>
                <i className="lg-line" style={{ background: c }} /> {n}
              </span>
            ))}
            {evs.map((t) => (
              <span key={t}>
                <i className="lg-sq" /> {EVENT_GLOSSARY[t]}
              </span>
            ))}
            {other.length > 0 && (
              <span>
                <i className="lg-sq" /> Other labels: {other.join(', ')} — hover for details
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PerfLine({ label, p }: { label: string; p: StrategySignal['all'] }) {
  if (!p.trades)
    return (
      <div>
        <span className="muted">{label}:</span> 0 trades
      </div>
    );
  return (
    <div>
      <span className="muted">{label}:</span> <b>{p.trades}</b> trades · win {fmt(p.winRate, 0)}%{p.breakEvenWinRate !== null && <span className="muted"> (break-even {fmt(p.breakEvenWinRate, 0)}%)</span>} · exp{' '}
      <b className={(p.expectancyR ?? 0) >= 0 ? 'good-ink' : 'bad-ink'}>{fmt(p.expectancyR, 2)}R</b> · PF {p.profitFactor === null ? '—' : fmt(p.profitFactor, 2)} · max DD {fmt(p.maxDrawdownR, 1)}R
    </div>
  );
}

function SignalCard({ s, market, dp, tz, color, focused, onFocus, onSave, onScript }: { s: StrategySignal; market: MarketInfo; dp: number; tz: Tz; color: string; focused: boolean; onFocus: () => void; onSave: () => void; onScript: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const stage = s.stage === 'confirmed' ? (s.isNew ? 'Confirmed entry · new' : 'Confirmed entry · active') : s.stage === 'setup' ? `Developing ${s.setupDir === 1 ? 'long' : 'short'} setup — not an entry` : 'No position';
  const evidence = s.all.trades >= 30 && s.outOfSample.trades >= 10 ? 'Adequate sample' : 'Small sample — weak evidence';
  return (
    <section className="card signal-card" style={{ borderTop: `3px solid ${color}`, outline: focused ? `2px solid ${color}` : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div>
          <b>{s.strategyName}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {s.category} · {s.family} · {market.ticker} {tfLabel(market.tf)} · v{s.strategyVersion.slice(0, 7)}
          </div>
        </div>
        <Badge tone={stateTone(s.state)} dot>
          {s.state}
        </Badge>
      </div>
      <div style={{ fontSize: 13, margin: '8px 0 4px' }}>
        <b>{stage}</b>
        {s.ruleScore !== null && <span className="muted"> · rule score {Math.round(s.ruleScore)}/100</span>}
      </div>
      {s.state !== 'NO TRADE' && s.entry !== null && s.stop !== null && (
        <div className="levels mono">
          <div>
            <span className="muted">Entry</span> {fmt(s.entry, dp)}
          </div>
          <div>
            <span className="muted">Stop</span> <span className="bad-ink">{fmt(s.stop, dp)}</span>
          </div>
          {s.targets.map((t, j) => (
            <div key={j}>
              <span className="muted">TP{j + 1}</span> <span className="good-ink">{fmt(t, dp)}</span>
            </div>
          ))}
          <div>
            <span className="muted">R:R</span> {s.rewardRisk === null ? '—' : fmt(s.rewardRisk, 2)}
          </div>
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
        {s.reason}
        {s.signalTime && ` Signal candle: ${fmtTime(s.signalTime, tz)}.`}
        {s.pendingFill && ' The entry shown is the signal close; the market order fills at the next candle open.'}
      </div>
      {s.reasons.length > 0 && (
        <details open={s.stage !== 'none'}>
          <summary className="sum">Why — rule checks at the {s.stage === 'setup' ? 'last candle' : 'signal candle'}</summary>
          <ul className="checks">
            {s.reasons.map((r) => (
              <li key={r.label + r.role} className={r.met ? 'good-ink' : 'bad-ink'}>
                {r.met ? '✓' : '✗'} {r.label} <span className="muted">({r.role})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.invalidation.length > 0 && (
        <details>
          <summary className="sum">What invalidates it</summary>
          <ul className="checks">
            {s.invalidation.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="sum">Rules</summary>
        <div style={{ fontSize: 12 }}>
          <p style={{ margin: '4px 0' }}>
            <b>Entry:</b> {s.entryLogic}
          </p>
          <p style={{ margin: '4px 0' }}>
            <b>Exit:</b> {s.exitLogic}
          </p>
          {!s.tfOk && <p className="warn-ink">{s.tfNote}</p>}
        </div>
      </details>
      <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
        <PerfLine label="Out-of-sample (last 30%)" p={s.outOfSample} />
        <PerfLine label="All loaded history" p={s.all} />
        <div className="muted">
          {evidence}. {s.all.ambiguous > 0 && `${s.all.ambiguous} trade(s) had a target and the stop in one candle and were counted at the stop. `}
          {s.costNote}
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm primary" disabled={s.state === 'NO TRADE'} onClick={onSave} title={s.state === 'NO TRADE' ? 'Only BUY or SELL signals can be saved' : 'Save this signal, its levels and the strategy version'}>
          Save opportunity
        </button>
        <button className="btn sm" onClick={onFocus}>
          {focused ? 'Show all on chart' : 'Focus on chart'}
        </button>
        <button
          className="btn sm ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onScript();
            setBusy(false);
          }}
          title="Open the Pine v6 script for this strategy and timeframe (reuses an identical stored version)"
        >
          {busy ? <Spinner /> : 'Pine script'}
        </button>
      </div>
    </section>
  );
}

function RankingPanel({ inst, tf, onActivate }: { inst: Inst; tf: string; onActivate: (id: string) => void }) {
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
      title="Strategy ranking on this market"
      className="mb"
      actions={
        <button className="btn sm" onClick={run} disabled={busy}>
          {busy ? <Spinner /> : 'Test all strategies'}
        </button>
      }
    >
      {err && <div className="bad-ink">{err}</div>}
      {!data && !err && <div className="muted">Runs every strategy on the same closed candles with the same costs and fills, then ranks by out-of-sample results. Strategies without enough trades are marked as insufficient evidence.</div>}
      {data && (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {data.bars.count} candles of {data.market.ticker} {tfLabel(data.market.tf)} from {data.bars.from.slice(0, 10)} to {data.bars.to?.slice(0, 10)}. {data.method}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Strategy</th>
                  <th>Evidence</th>
                  <th title="Trades entered in the last 30% of candles">OOS trades</th>
                  <th title="Average result per trade after costs, out-of-sample">OOS expectancy</th>
                  <th>All trades</th>
                  <th>Win rate (break-even)</th>
                  <th>Profit factor</th>
                  <th>Max DD</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, k) => (
                  <tr key={r.strategyId} style={{ opacity: r.evidence === 'high' ? 1 : 0.75 }}>
                    <td>{r.evidence === 'high' ? k + 1 : '—'}</td>
                    <td>
                      {r.strategyName}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.family}
                        {!r.tfOk && ' · outside designed timeframe'} · {REVIEW_BADGE[r.review].label}
                      </div>
                    </td>
                    <td>
                      <Badge tone={r.evidence === 'high' ? 'good' : r.evidence === 'low' ? 'warn' : 'neutral'}>{r.evidence === 'high' ? 'sufficient' : r.evidence === 'low' ? 'insufficient' : 'no trades'}</Badge>
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
                        Activate
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
    <Card title={`Saved opportunities (${opps.length})`}>
      {!opps.length ? (
        <Empty>Save a BUY or SELL signal to track what happens next. Saved signals are never edited.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Saved</th>
                <th>Asset</th>
                <th>Strategy</th>
                <th>Side</th>
                <th>Entry / stop / targets</th>
                <th>Outcome since saved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {opps.map((o) => {
                const ev = evals[o.id];
                const snap = o.snapshot?.signal;
                return (
                  <tr key={o.id}>
                    <td title={fmtTime(o.createdAt, tz)}>{ago(o.createdAt)}</td>
                    <td>
                      {o.ticker} · {tfLabel(o.tf)}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {o.instrument}
                      </div>
                    </td>
                    <td>
                      {o.strategyName}
                      <div className="muted" style={{ fontSize: 12 }}>
                        v{o.strategyVersion.slice(0, 7)} · signal {fmtTime(o.signalTime, tz)}
                      </div>
                      {snap?.reason && (
                        <details>
                          <summary className="sum">Snapshot</summary>
                          <div style={{ fontSize: 12 }}>
                            {snap.reason}
                            {snap.reasons && (
                              <ul className="checks">
                                {snap.reasons.map((r) => (
                                  <li key={r.label + r.role}>
                                    {r.met ? '✓' : '✗'} {r.label}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {o.snapshot.confluence && <div className="muted">Confluence when saved: {o.snapshot.confluence.label}</div>}
                          </div>
                        </details>
                      )}
                    </td>
                    <td>
                      <Badge tone={o.direction === 1 ? 'good' : 'bad'}>{o.direction === 1 ? 'BUY' : 'SELL'}</Badge>
                    </td>
                    <td className="mono">
                      {fmt(o.entry, dp)} / {fmt(o.stop, dp)} / {o.targets.map((x) => fmt(x, dp)).join(' / ')}
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      {ev === 'loading' ? (
                        <Spinner />
                      ) : typeof ev === 'string' ? (
                        <span className="bad-ink">{ev}</span>
                      ) : ev ? (
                        <div>
                          <Badge tone={ev.status === 'target' ? 'good' : ev.status === 'stopped' ? 'bad' : 'neutral'}>{ev.status}</Badge> {ev.r !== null && <b className="mono">{fmt(ev.r, 2)}R</b>}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {ev.note} {ev.barsChecked} candle(s) checked · best {fmt(ev.mfeR, 2)}R · worst −{fmt(ev.maeR, 2)}R
                          </div>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn sm" onClick={() => evaluate(o.id)}>
                          Evaluate
                        </button>
                        <button className="btn sm ghost danger" onClick={() => remove(o.id)} aria-label="Delete">
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
