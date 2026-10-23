// Small SVG charts: single-series line (equity), sparkline, diverging bars (fold P&L), horizontal bars (topics).
// Single-series charts need no legend (the card title names the series); every chart has a hover readout.
import { useEffect, useRef, useState, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(200, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, n = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

const trim = (s: string) => s.replace(/\.0+$/, '');
const compact = (v: number) =>
  Math.abs(v) >= 1e6 ? `${trim((v / 1e6).toFixed(2))}M` : Math.abs(v) >= 1e4 ? `${trim((v / 1e3).toFixed(1))}k` : Math.abs(v) >= 100 ? v.toFixed(0) : trim(v.toFixed(2));

export function LineChart({ values, height = 240, baseline, xLabel = 'Trade', format = compact, ariaLabel }: { values: number[]; height?: number; baseline?: number; xLabel?: string; format?: (v: number) => string; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return <div className="empty">Not enough data to chart.</div>;
  const pad = { l: 56, r: 12, t: 12, b: 26 };
  const lo = Math.min(...values, baseline ?? Infinity);
  const hi = Math.max(...values, baseline ?? -Infinity);
  const ticks = niceTicks(lo, hi);
  const y0 = Math.min(lo, ticks[0]);
  const y1 = Math.max(hi, ticks[ticks.length - 1]);
  const x = (i: number) => pad.l + (i / (values.length - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / (width - pad.l - pad.r)) * (values.length - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {baseline !== undefined && <line x1={pad.l} x2={width - pad.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--axis)" strokeWidth={1} strokeDasharray="4 4" />}
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        <text x={width - pad.r} y={height - 6} textAnchor="end" fontSize={11} fill="var(--muted)">
          {xLabel} → {values.length - 1}
        </text>
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--axis)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(values[hover])} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: x(hover), top: y(values[hover]) }}>
          {xLabel} {hover}: <strong>{format(values[hover])}</strong>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 32, label }: { values: number[]; width?: number; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return <span className="muted small">—</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}: ${values.length} closes from ${values[0].toPrecision(6)} to ${values[values.length - 1].toPrecision(6)}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left - 2) / (width - 4)) * (values.length - 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={1.6} />
        {hover !== null && <circle cx={x(hover)} cy={y(values[hover])} r={3} fill="var(--series-1)" />}
      </svg>
      {hover !== null && (
        <span className="chart-tip" style={{ left: x(hover), top: y(values[hover]) }}>
          {values[hover].toPrecision(6)} ({values.length - 1 - hover}d ago)
        </span>
      )}
    </span>
  );
}

/** Vertical bars around a zero baseline; positive = series blue, negative = red (diverging poles). */
export function DivergingBars({ items, height = 200, format = compact, ariaLabel }: { items: { label: string; value: number; detail?: ReactNode }[]; height?: number; format?: (v: number) => string; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!items.length) return <div className="empty">No data.</div>;
  const pad = { l: 56, r: 8, t: 10, b: 24 };
  const lo = Math.min(0, ...items.map((i) => i.value));
  const hi = Math.max(0, ...items.map((i) => i.value));
  const ticks = niceTicks(lo, hi);
  const y0 = Math.min(lo, ticks[0]);
  const y1 = Math.max(hi, ticks[ticks.length - 1]);
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b);
  const band = (width - pad.l - pad.r) / items.length;
  const bw = Math.min(56, band - 2);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {format(t)}
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const cx = pad.l + band * i + band / 2;
          const top = Math.min(y(it.value), y(0));
          const h = Math.max(1, Math.abs(y(it.value) - y(0)));
          const r = Math.min(4, h / 2, bw / 2);
          const pos = it.value >= 0;
          // Rounded only at the data end (away from the baseline).
          const path = pos
            ? `M${cx - bw / 2},${y(0)} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${y(0)} Z`
            : `M${cx - bw / 2},${y(0)} V${top + h - r} Q${cx - bw / 2},${top + h} ${cx - bw / 2 + r},${top + h} H${cx + bw / 2 - r} Q${cx + bw / 2},${top + h} ${cx + bw / 2},${top + h - r} V${y(0)} Z`;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - band / 2} y={pad.t} width={band} height={height - pad.t - pad.b} fill="transparent" />
              <path d={path} fill={pos ? 'var(--series-1)' : 'var(--series-neg)'} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                {it.label}
              </text>
            </g>
          );
        })}
        <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: pad.l + band * hover + band / 2, top: y(Math.max(0, items[hover].value)) }}>
          {items[hover].label}: <strong>{format(items[hover].value)}</strong> {items[hover].detail}
        </div>
      )}
    </div>
  );
}

export function HBars({ items, max, format = (v) => String(v) }: { items: { label: string; value: number; note?: ReactNode }[]; max?: number; format?: (v: number) => string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="col" style={{ gap: 6 }}>
      {items.map((it) => (
        <div key={it.label} title={`${it.label}: ${format(it.value)}`} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 90px', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {it.label}
          </span>
          <span style={{ height: 10, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(100 * it.value) / m}%`, background: 'var(--series-1)', borderRadius: '0 4px 4px 0' }} />
          </span>
          <span className="num small" style={{ color: 'var(--ink-2)' }}>
            {format(it.value)} {it.note}
          </span>
        </div>
      ))}
    </div>
  );
}
