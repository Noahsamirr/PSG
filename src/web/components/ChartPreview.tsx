// In-app chart preview: real candles + the strategy's signals, levels and overlays, computed in the browser
// from the same specification as the Pine script.
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, LineSeries, LineStyle, LineType, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { runSimulation, type Bar, type Marker, type SimResult } from '../../core/sim/engine';
import { TF_LADDER, tfLabel } from '../../core/timeframe';
import type { StrategySpec } from '../../core/types';
import { api } from '../api';
import { Badge, Card, fmt, Icon, Spinner, useApp } from './ui';
import { useI18n } from '../i18n';

type Pick = 'auto' | `c${number}` | 'custom' | 'csv';
type Candidate = Awaited<ReturnType<typeof api.candleSources>>[number];

const css = (v: string, d: string) => (typeof document === 'undefined' ? d : getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d);

export function parseOhlcCsv(text: string): Bar[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const head = lines[0].split(delim).map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const ct = col('time', 'date', 'datetime', 'timestamp');
  const [co, ch, cl, cc, cv] = [col('open'), col('high'), col('low'), col('close'), col('volume', 'vol')];
  if ([ct, co, ch, cl, cc].some((x) => x < 0)) throw new Error('CSV needs time, open, high, low and close columns (TradingView: chart menu → Export chart data).');
  const bars: Bar[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(delim).map((x) => x.trim().replace(/"/g, ''));
    const tRaw = c[ct];
    const t = /^\d+(\.\d+)?$/.test(tRaw) ? (Number(tRaw) > 1e12 ? Number(tRaw) : Number(tRaw) * 1000) : Date.parse(tRaw.includes('T') || tRaw.endsWith('Z') ? tRaw : tRaw.replace(' ', 'T') + 'Z');
    const b = { t, o: Number(c[co]), h: Number(c[ch]), l: Number(c[cl]), c: Number(c[cc]), v: cv >= 0 ? Number(c[cv]) || 0 : 0 };
    if ([b.t, b.o, b.h, b.l, b.c].every(Number.isFinite)) bars.push(b);
  }
  return bars.sort((a, b) => a.t - b.t);
}

function inferTf(bars: Bar[]): string {
  const diffs = bars.slice(1, 200).map((b, i) => b.t - bars[i].t).filter((d) => d > 0).sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)] / 60000;
  const ladder = TF_LADDER.map((t) => ({ t, m: t.endsWith('D') ? 1440 : t.endsWith('W') ? 10080 : Number(t) }));
  return ladder.reduce((best, x) => (Math.abs(x.m - med) < Math.abs(best.m - med) ? x : best), ladder[0]).t;
}

const MARKER_STYLE: Record<Marker['kind'], (m: Marker, bull: string, bear: string) => Omit<SeriesMarker<Time>, 'time'>> = {
  entry: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: m.dir === 1 ? 'arrowUp' : 'arrowDown', color: m.dir === 1 ? bull : bear, text: m.text, size: 1.4 }),
  strong: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: m.dir === 1 ? 'arrowUp' : 'arrowDown', color: m.dir === 1 ? bull : bear, text: m.text, size: 2.2 }),
  agreement: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: 'circle', color: m.dir === 1 ? bull : bear, text: m.text, size: 1 }),
  fill: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: 'circle', color: m.dir === 1 ? bull : bear, size: 0.4 }),
  setup: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: m.dir === 1 ? 'arrowUp' : 'arrowDown', color: (m.dir === 1 ? bull : bear) + '66', size: 0.6 }),
  invalid: (m) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: 'square', color: '#898781', text: '✕', size: 0.5 }),
  blocked: (m) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: 'square', color: '#898781', text: '⊘', size: 0.5 }),
  tp: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: 'circle', color: m.dir === 1 ? bull : bear, text: m.text, size: 0.6 }),
  exit: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: m.dir === 1 ? 'arrowDown' : 'arrowUp', color: m.good ? bull : bear, text: m.text, size: 0.9 }),
  event: (m, bull, bear) => ({ position: m.side === 'below' ? 'belowBar' : 'aboveBar', shape: 'circle', color: m.dir === 1 ? bull + 'AA' : m.dir === -1 ? bear + 'AA' : '#FFB300AA', text: m.text, size: 0.4 }),
};

interface Props {
  spec: StrategySpec;
  footer?: ReactNode;
}

export function ChartPreview({ spec, footer }: Props) {
  const { toast } = useApp();
  const { t, tx } = useI18n();
  const [symbol, setSymbol] = useState(spec.market.symbol || 'BTCUSDT');
  const [tf, setTf] = useState(spec.market.timeframe || '60');
  const [limit, setLimit] = useState(1000);
  const [pick, setPick] = useState<Pick>('auto');
  const [customSource, setCustomSource] = useState('binance');
  const [ticker, setTicker] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [popular, setPopular] = useState<{ symbol: string; label: string }[]>([]);
  const source = pick === 'csv' ? 'csv' : 'api';
  useEffect(() => {
    api.popularSymbols().then(setPopular).catch(() => undefined);
  }, []);
  useEffect(() => {
    const h = setTimeout(() => {
      api
        .candleSources(symbol, spec.market.assetClass)
        .then((c) => {
          setCandidates(c);
          setPick((p) => (p.startsWith('c') ? 'auto' : p));
        })
        .catch(() => setCandidates([]));
    }, 350);
    return () => clearTimeout(h);
  }, [symbol, spec.market.assetClass]);
  const [data, setData] = useState<{ bars: Bar[]; label: string; note: string; isProxy: boolean; qtyStep: number; tf: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState({ overlays: true, events: false, setups: false, levels: true });
  const [hover, setHover] = useState<number | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const load = async () => {
    if (source === 'csv') return;
    setLoading(true);
    setError(null);
    try {
      const chosen = pick.startsWith('c') ? candidates[Number(pick.slice(1))] : undefined;
      const q = chosen
        ? { source: chosen.source, ticker: chosen.ticker }
        : pick === 'custom' && ticker
          ? { source: customSource, ticker }
          : {};
      const r = await api.candles({ symbol, assetClass: spec.market.assetClass, tf, limit, ...q });
      setData({ bars: r.bars, label: r.label.split(' — ')[0], note: r.label.split(' — ')[1] ?? r.note, isProxy: r.isProxy, qtyStep: r.qtyStep, tf: r.tf });
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result: SimResult | null = useMemo(() => {
    if (!data) return null;
    try {
      return runSimulation(spec, data.bars, { chartTf: data.tf, qtyStep: data.qtyStep, showEvents: show.events });
    } catch (e) {
      toast(`Preview failed: ${(e as Error).message}`, 'bad');
      return null;
    }
  }, [spec, data, show.events, toast]);

  // Chart rendering
  useEffect(() => {
    if (!holder.current || !data || !result) return;
    const bull = spec.visuals.bullColor || '#26A69A';
    const bear = spec.visuals.bearColor || '#EF5350';
    const chart = createChart(holder.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: css('--surface', '#1a1a19') }, textColor: css('--ink-3', '#9d9c95'), fontSize: 11 },
      grid: { vertLines: { color: css('--grid', '#2c2c2a') }, horzLines: { color: css('--grid', '#2c2c2a') } },
      rightPriceScale: { borderColor: css('--line', '#2c2c2a') },
      timeScale: { borderColor: css('--line', '#2c2c2a'), timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;
    const time = (i: number) => (data.bars[i].t / 1000) as UTCTimestamp;
    const candles = chart.addSeries(CandlestickSeries, { upColor: bull, downColor: bear, wickUpColor: bull, wickDownColor: bear, borderVisible: false });
    candles.setData(data.bars.map((b, i) => ({ time: time(i), open: b.o, high: b.h, low: b.l, close: b.c })));
    const line = (values: number[], color: string, opts: { width?: number; style?: 'line' | 'step' | 'dotted'; title?: string } = {}) => {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: (opts.width ?? 1) as 1 | 2 | 3 | 4,
        lineStyle: opts.style === 'dotted' ? LineStyle.Dotted : LineStyle.Solid,
        lineType: opts.style === 'step' ? LineType.WithSteps : LineType.Simple,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: opts.title ?? '',
      });
      s.setData(values.map((v, i) => (Number.isFinite(v) ? { time: time(i), value: v } : { time: time(i) })));
    };
    if (show.overlays) for (const o of result.overlays) line(o.values, o.color, { width: o.width, style: o.style });
    if (show.levels) {
      line(result.levels.entry, '#9d9c95', { style: 'step' });
      line(result.levels.stop, bear, { width: 2, style: 'step' });
      line(result.levels.tp1, bull + 'AA', { style: 'step' });
      line(result.levels.tp2, bull + 'CC', { style: 'step' });
      line(result.levels.final, bull, { width: 2, style: 'step' });
    }
    const ms = result.markers
      .filter((m) => show.setups || !['setup', 'invalid', 'blocked'].includes(m.kind))
      .map((m) => ({ time: time(m.bar), ...MARKER_STYLE[m.kind](m, bull, bear) }) as SeriesMarker<Time>);
    createSeriesMarkers(candles, ms);
    chart.subscribeCrosshairMove((p) => {
      if (p.logical === undefined || p.logical === null) return;
      setHover(Math.max(0, Math.min(data.bars.length - 1, Math.round(p.logical))));
    });
    // autoSize lays the chart out asynchronously; set the zoom once it has a size.
    const zoom = () => chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.bars.length - 150), to: data.bars.length + 5 });
    zoom();
    const raf = requestAnimationFrame(() => setTimeout(zoom, 0));
    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, result, show.overlays, show.levels, show.setups, spec.visuals.bullColor, spec.visuals.bearColor]);

  const jumpTo = (bar: number) => {
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, bar - 60), to: bar + 60 });
    setHover(bar);
  };
  const idx = hover ?? (data ? data.bars.length - 1 : null);
  const info = result && idx !== null ? result.info(idx) : null;
  const barMarkers = result && idx !== null ? result.markers.filter((m) => m.bar === idx) : [];
  const dp = (x: number) => (data ? fmt(x, Math.min(8, Math.max(2, String(data.bars[data.bars.length - 1].c).split('.')[1]?.length ?? 2))) : String(x));
  const s = result?.stats;

  return (
    <div className="col">
      <div className="row">
        <label className="field" style={{ width: 210 }}>
          {t('Symbol')}
          <input
            list="pf-symbols"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            disabled={source === 'csv'}
            placeholder="XAUUSDT, OANDA:XAUUSD, gold usdt…"
            title="Plain or TradingView-style names: XAUUSD, XAUUSDT, BINANCE:BTCUSDT.P, OANDA:EURUSD, TVC:GOLD, COMEX:GC1!, NAS100, AAPL…"
          />
          <datalist id="pf-symbols">
            {popular.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.label}
              </option>
            ))}
          </datalist>
        </label>
        <label className="field" style={{ width: 110 }}>
          {t('Timeframe')}
          <select value={tf} onChange={(e) => setTf(e.target.value)} disabled={source === 'csv'}>
            {[...new Set([...TF_LADDER, tf])].map((t) => (
              <option key={t} value={t}>
                {tfLabel(t)}
                {t === spec.market.timeframe ? ' ★' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 100 }}>
          {t('Bars')}
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} disabled={source === 'csv'}>
            {[500, 1000, 2000, 3000].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 330 }}>
          {t('Data source')}
          <select value={pick} onChange={(e) => setPick(e.target.value as Pick)}>
            <option value="auto">
              {t('Auto — best available')}
              {candidates[0] ? ` (${candidates[0].label.split(' — ')[0]})` : ''}
            </option>
            {candidates.map((c, k) => (
              <option key={k} value={`c${k}`}>
                {c.label}
              </option>
            ))}
            <option value="custom">{t('Custom source & ticker…')}</option>
            <option value="csv">{t('Upload CSV exported from TradingView')}</option>
          </select>
        </label>
        {pick === 'custom' && (
          <>
            <label className="field" style={{ width: 150 }}>
              {t('Source')}
              <select value={customSource} onChange={(e) => setCustomSource(e.target.value)}>
                <option value="binance">Binance spot</option>
                <option value="binancef">Binance futures (USDT perps)</option>
                <option value="yahoo">Yahoo Finance</option>
                <option value="twelvedata">Twelve Data (API key)</option>
              </select>
            </label>
            <label className="field" style={{ width: 130 }}>
              {t('Ticker')}
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder={customSource.startsWith('binance') ? 'XAUUSDT' : customSource === 'yahoo' ? 'EURUSD=X' : 'EUR/USD'} />
            </label>
          </>
        )}
        {source === 'csv' ? (
          <label className="field">
            {t('CSV file')}
            <input
              type="file"
              accept=".csv,.txt"
              style={{ height: 'auto', border: 0, padding: '6px 0' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                f.text().then((t) => {
                  try {
                    const bars = parseOhlcCsv(t);
                    if (bars.length < 50) throw new Error(`Only ${bars.length} bars found.`);
                    const itf = inferTf(bars);
                    setTf(itf);
                    setError(null);
                    setData({ bars, label: `Uploaded ${f.name}`, note: 'Your own exported data — matches TradingView most closely.', isProxy: false, qtyStep: spec.market.assetClass === 'crypto' ? 0.0001 : 1, tf: itf });
                  } catch (err) {
                    setError((err as Error).message);
                  }
                });
              }}
            />
          </label>
        ) : (
          <button className="btn primary" onClick={load} disabled={loading} style={{ alignSelf: 'flex-end' }}>
            {loading ? <Spinner /> : <Icon name="refresh" size={16} />} {t('Load & run')}
          </button>
        )}
      </div>
      <div className="row small">
        {(
          [
            ['overlays', 'Indicators'],
            ['levels', 'Stop / targets'],
            ['setups', 'Setups, invalidated & blocked'],
            ['events', 'Structure events (BOS, CHoCH, FVG, $)'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check small">
            <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {t(label)}
          </label>
        ))}
      </div>
      {error && <div className="notice bad">{error}</div>}
      {data && (
        <div className="row small muted">
          <Badge tone={data.isProxy ? 'warn' : 'info'}>{data.label}</Badge>
          <span>
            {t('{n} bars', { n: data.bars.length })} · {tfLabel(data.tf)} · {new Date(data.bars[0].t).toISOString().slice(0, 10)} → {new Date(data.bars[data.bars.length - 1].t).toISOString().slice(0, 16).replace('T', ' ')} UTC
          </span>
          <span>{data.note}</span>
          {result && !result.tfOk && <Badge tone="warn">outside designed timeframe</Badge>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 12 }} className="chart-grid">
        <div ref={holder} dir="ltr" style={{ height: 520, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }} role="img" aria-label={t('Price chart with strategy signals')}>
          {!data && !loading && <div className="empty">{t('Load data to preview signals.')}</div>}
          {loading && (
            <div className="empty">
              <Spinner /> {t('Loading candles…')}
            </div>
          )}
        </div>
        <div className="card card-pad small" style={{ height: 520, overflow: 'auto', boxShadow: 'none' }}>
          {data && idx !== null && info ? (
            <div className="col" style={{ gap: 8 }}>
              <div>
                <strong>{new Date(data.bars[idx].t).toISOString().slice(0, 16).replace('T', ' ')} UTC</strong>
                <div className="muted num">
                  O {dp(data.bars[idx].o)} H {dp(data.bars[idx].h)} L {dp(data.bars[idx].l)} C {dp(data.bars[idx].c)}
                </div>
              </div>
              {barMarkers.length > 0 && (
                <div className="col" style={{ gap: 4 }}>
                  {barMarkers.map((m, k) => (
                    <div key={k} className={`notice ${m.kind === 'blocked' || m.kind === 'invalid' ? '' : m.dir === 1 ? 'good' : m.dir === -1 ? 'bad' : ''}`} style={{ padding: '6px 8px' }}>
                      <strong>{m.text}</strong> <span dir="auto">{tx(m.detail)}</span>
                    </div>
                  ))}
                </div>
              )}
              {info.votes ? (
                <div>
                  <h4>Votes · ▲ {fmt(info.agreeL, 0)}% ▼ {fmt(info.agreeS, 0)}%</h4>
                  {info.votes.map((v) => (
                    <div key={v.name} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <span style={{ width: 16 }}>{v.vote === 1 ? '▲' : v.vote === -1 ? '▼' : '·'}</span>
                      <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.name}>
                        {v.name}
                      </span>
                      <span className="muted">{v.barsAgo !== null ? `${v.barsAgo}b` : ''}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <h4>
                    {t('Rules · long {l}% · short {s}%', { l: fmt(info.scoreL, 0), s: fmt(info.scoreS, 0) })}
                  </h4>
                  {info.conds.map((c) => (
                    <div key={c.label + c.role} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <span title="long" style={{ color: c.L ? 'var(--good-ink)' : 'var(--ink-3)', width: 14 }}>
                        {c.L ? '✓' : '✗'}
                      </span>
                      <span title="short" style={{ color: c.S ? 'var(--bad-ink)' : 'var(--ink-3)', width: 14 }}>
                        {c.S ? '✓' : '✗'}
                      </span>
                      <span className="grow">{t(c.label)}</span>
                      <span className="muted">{t(c.role)}</span>
                    </div>
                  ))}
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    {t('First column = long side, second = short side.')}
                  </p>
                </div>
              )}
              {info.readouts.length > 0 && (
                <dl className="kv">
                  {info.readouts.map((r) => (
                    <div key={r.label} style={{ display: 'contents' }}>
                      <dt>{r.label}</dt>
                      <dd>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="muted" style={{ margin: 0 }}>
                {t('Hover the chart to inspect any bar.')}
              </p>
            </div>
          ) : (
            <span className="muted">{t('Bar details appear here.')}</span>
          )}
        </div>
      </div>
      {result && s && (
        <>
          <div className="grid g4">
            <div className="card stat">
              <div className="label">{t('Signals / trades')}</div>
              <div className="value num">
                {s.signals} / {s.trades}
              </div>
              <div className="sub">
                {t('{n} not traded', { n: s.blocked })}{spec.consensus.enabled ? ` · ${s.strongSignals} STRONG` : ''}
              </div>
            </div>
            <div className="card stat">
              <div className="label">{t('Win rate')}</div>
              <div className="value num">{s.winRate === null ? '—' : `${s.winRate.toFixed(0)}%`}</div>
              <div className="sub">
                {t('{w} wins · {l} losses', { w: s.wins, l: s.losses })}
              </div>
            </div>
            <div className="card stat">
              <div className="label">{t('Total R (before costs)')}</div>
              <div className="value num">
                {s.totalR >= 0 ? '+' : ''}
                {s.totalR.toFixed(1)}R
              </div>
              <div className="sub">{t('avg {a} · PF {pf}', { a: s.avgR === null ? '—' : `${s.avgR.toFixed(2)}R`, pf: fmt(s.profitFactor) })}</div>
            </div>
            <div className="card stat">
              <div className="label">{t('Net P&L (after commission)')}</div>
              <div className="value num">{fmt(s.netPnl)}</div>
              <div className="sub">{t('max DD {dd}% · start {c}', { dd: s.maxDrawdownPct.toFixed(1), c: fmt(spec.backtest.initialCapital, 0) })}</div>
            </div>
          </div>
          <div className="notice small" dir="auto">
            {result.notes.map((n) => (
              <div key={n} dir="auto">
                • {tx(n)}
              </div>
            ))}
            <div>• {t("A short preview window is weak evidence. Confirm in TradingView's Strategy Tester and with out-of-sample data before trusting results.")}</div>
          </div>
          <Card title={t('Trades ({n})', { n: result.trades.length })} pad={false}>
            {result.trades.length === 0 ? (
              <div className="empty">{t('No completed trades in this window.')}</div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('Side')}</th>
                      <th>{t('Signal (UTC)')}</th>
                      <th className="num">{t('Entry')}</th>
                      <th className="num">{t('Stop')}</th>
                      <th>{t('Exit (UTC)')}</th>
                      <th>{t('Reason')}</th>
                      <th className="num">R</th>
                      <th className="num">{t('P&L')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((tr, k) => (
                      <tr key={k} className="clickable" onClick={() => jumpTo(tr.signalBar)}>
                        <td>{k + 1}</td>
                        <td>
                          <Badge tone={tr.dir === 1 ? 'good' : 'bad'}>
                            {tr.strong ? `${t('STRONG')} ` : ''}
                            {t(tr.dir === 1 ? 'BUY' : 'SELL')}
                          </Badge>
                        </td>
                        <td className="nowrap">{new Date(data!.bars[tr.signalBar].t).toISOString().slice(0, 16).replace('T', ' ')}</td>
                        <td className="num">{dp(tr.entry)}</td>
                        <td className="num" title={tr.stop !== tr.initialStop ? `Moved to ${dp(tr.stop)} (breakeven/trailing)` : ''}>
                          {dp(tr.initialStop)}
                          {tr.stop !== tr.initialStop && <span className="muted"> → {dp(tr.stop)}</span>}
                        </td>
                        <td className="nowrap">{tr.exitBar !== null ? new Date(data!.bars[tr.exitBar].t).toISOString().slice(0, 16).replace('T', ' ') : t('open')}</td>
                        <td>
                          {tr.partials
                            .map((p) => p.label)
                            .filter((x, i2, a) => a.indexOf(x) === i2)
                            .join(' → ')}
                        </td>
                        <td className="num">
                          {tr.r === null ? '—' : `${tr.r >= 0 ? '+' : ''}${tr.r.toFixed(2)}`}
                        </td>
                        <td className="num">{fmt(tr.pnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {footer}
    </div>
  );
}
