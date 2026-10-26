// In-app evaluation of each indicator module. Each function mirrors the Pine code emitted by
// src/core/components so the preview shows the same conditions the script computes.
import type { ParamValue } from '../types';
import { tfMinutes } from '../timeframe';
import * as T from './series';
import type { B, Bar, S } from './series';

export interface Overlay {
  name: string;
  values: S;
  color: string;
  width?: number;
  style?: 'line' | 'step' | 'dotted';
}

export interface CompEvent {
  bar: number;
  side: 'above' | 'below';
  text: string;
  tone: 'bull' | 'bear' | 'neutral';
  detail: string;
}

export interface CompSim {
  conds: Record<string, { L: B; S: B }>;
  overlays: Overlay[];
  stop?: { L: S; S: S };
  events: CompEvent[];
  readout?: { label: string; value: (i: number) => string };
}

export interface SimContext {
  bars: Bar[];
  chartTf: string;
}

type P = Record<string, ParamValue>;
const num = (p: P, k: string) => Number(p[k]);
const str = (p: P, k: string) => String(p[k]);
const bool = (p: P, k: string) => Boolean(p[k]);

const C = {
  blue: '#42A5F5',
  orange: '#FFA726',
  purple: '#AB47BC',
  bull: '#26A69A',
  bear: '#EF5350',
  magenta: '#E040FB',
  grey: '#90A4AE',
  amber: '#FFB74D',
};

function srcOf(bars: Bar[], s: string): S {
  switch (s) {
    case 'open':
      return bars.map((b) => b.o);
    case 'high':
      return bars.map((b) => b.h);
    case 'low':
      return bars.map((b) => b.l);
    case 'hl2':
      return bars.map((b) => (b.h + b.l) / 2);
    case 'hlc3':
      return bars.map((b) => (b.h + b.l + b.c) / 3);
    case 'ohlc4':
      return bars.map((b) => (b.o + b.h + b.l + b.c) / 4);
    case 'hlcc4':
      return bars.map((b) => (b.h + b.l + 2 * b.c) / 4);
    case 'volume':
      return bars.map((b) => b.v);
    default:
      return bars.map((b) => b.c);
  }
}

const both = (L: B, Sh: B) => ({ L, S: Sh });
const map2 = <T1, T2>(a: T1[], f: (x: T1, i: number) => T2) => a.map(f);

// ─── time helpers ───
const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function localParts(t: number, tz: string): { minutes: number; day: string; dow: number } {
  const zone = tz === 'Exchange' || !tz ? 'UTC' : tz;
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    fmtCache.set(zone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), day: `${parts.year}-${parts.month}-${parts.day}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}

/** Pine `not na(time(timeframe.period, session, tz))` for a bar opening at t. */
export function inSession(t: number, session: string, tz: string): boolean {
  const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(session);
  if (!m) return true;
  const start = +m[1] * 60 + +m[2];
  const end = +m[3] * 60 + +m[4];
  const x = localParts(t, tz).minutes;
  return start <= end ? x >= start && x < end : x >= start || x < end;
}

/** Index of the higher-timeframe bucket each bar belongs to (UTC buckets). */
export function bucketKeys(bars: Bar[], tf: string): number[] {
  const min = tfMinutes(tf) ?? 60;
  const u = tf.toUpperCase();
  return bars.map((b) => {
    const d = new Date(b.t);
    if (u.endsWith('M') && min >= 43200) return d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (u.endsWith('W')) {
      const day = (d.getUTCDay() + 6) % 7; // Monday = 0
      return Math.floor((b.t - day * 86400000) / 86400000 / 7);
    }
    return Math.floor(b.t / (min * 60000));
  });
}

/** Aggregate to HTF bars; returns HTF bars and the HTF index of each chart bar. */
export function resample(bars: Bar[], tf: string): { htf: Bar[]; idx: number[] } {
  const keys = bucketKeys(bars, tf);
  const htf: Bar[] = [];
  const idx: number[] = [];
  keys.forEach((k, i) => {
    const b = bars[i];
    if (!htf.length || keys[i - 1] !== k) htf.push({ ...b });
    else {
      const h = htf[htf.length - 1];
      h.h = Math.max(h.h, b.h);
      h.l = Math.min(h.l, b.l);
      h.c = b.c;
      h.v += b.v;
    }
    idx.push(htf.length - 1);
  });
  return { htf, idx };
}

function dayKey(t: number, unit: 'D' | 'W' | 'M'): number {
  const d = new Date(t);
  if (unit === 'M') return d.getUTCFullYear() * 12 + d.getUTCMonth();
  if (unit === 'W') return Math.floor((t - ((d.getUTCDay() + 6) % 7) * 86400000) / (7 * 86400000));
  return Math.floor(t / 86400000);
}

// ─── components ───
type Sim = (ctx: SimContext, p: P) => CompSim;

const ema: Sim = ({ bars }, p) => {
  const src = srcOf(bars, str(p, 'src'));
  const vol = bars.map((b) => b.v);
  const fast = T.ma(src, vol, num(p, 'fastLen'), str(p, 'maType'));
  const slow = T.ma(src, vol, num(p, 'slowLen'), str(p, 'maType'));
  const up = T.crossover(fast, slow);
  const dn = T.crossunder(fast, slow);
  const pbL = bars.map((b, i) => fast[i] > slow[i] && b.l <= fast[i] && b.c > fast[i] && b.c > b.o);
  const pbS = bars.map((b, i) => fast[i] < slow[i] && b.h >= fast[i] && b.c < fast[i] && b.c < b.o);
  return {
    conds: {
      cross: both(up, dn),
      stack: both(
        fast.map((f, i) => f > slow[i]),
        fast.map((f, i) => f < slow[i]),
      ),
      pullback: both(pbL, pbS),
      crossExit: both(dn, up),
    },
    overlays: bool(p, 'show')
      ? [
          { name: 'Fast MA', values: fast, color: C.blue },
          { name: 'Slow MA', values: slow, color: C.orange, width: 2 },
        ]
      : [],
    events: [],
  };
};

const trend: Sim = ({ bars }, p) => {
  const close = bars.map((b) => b.c);
  const m = T.ma(
    close,
    bars.map((b) => b.v),
    num(p, 'len'),
    str(p, 'maType'),
  );
  const k = num(p, 'slopeBars');
  return {
    conds: {
      side: both(
        close.map((c, i) => c > m[i]),
        close.map((c, i) => c < m[i]),
      ),
      slope: both(
        m.map((x, i) => i >= k && x > m[i - k]),
        m.map((x, i) => i >= k && x < m[i - k]),
      ),
      crossExit: both(T.crossover(close, m), T.crossunder(close, m)),
    },
    overlays: bool(p, 'show') ? [{ name: `Trend MA ${num(p, 'len')}`, values: m, color: C.grey, width: 2 }] : [],
    events: [],
  };
};

const st: Sim = ({ bars }, p) => {
  const [line, dir] = T.supertrend(bars, num(p, 'factor'), num(p, 'atrLen'));
  const up = dir.map((d, i) => i > 0 && d < 0 && dir[i - 1] > 0);
  const dn = dir.map((d, i) => i > 0 && d > 0 && dir[i - 1] < 0);
  return {
    conds: {
      flip: both(up, dn),
      state: both(
        dir.map((d) => d < 0),
        dir.map((d) => d > 0),
      ),
      flipExit: both(dn, up),
    },
    overlays: [
      { name: 'Supertrend (up)', values: line.map((x, i) => (dir[i] < 0 ? x : NaN)), color: C.bull, width: 2 },
      { name: 'Supertrend (down)', values: line.map((x, i) => (dir[i] > 0 ? x : NaN)), color: C.bear, width: 2 },
    ],
    stop: { L: line, S: line },
    events: [],
  };
};

const htf: Sim = ({ bars }, p) => {
  const tf = str(p, 'tf');
  const { htf: hb, idx } = resample(bars, tf);
  const hc = hb.map((b) => b.c);
  const hm = T.ma(
    hc,
    hb.map((b) => b.v),
    num(p, 'len'),
    str(p, 'maType'),
  );
  // request.security(..., expr[1], lookahead_on): value of the previous completed HTF bar.
  const cl = idx.map((k) => (k > 0 ? hc[k - 1] : NaN));
  const mv = idx.map((k) => (k > 0 ? hm[k - 1] : NaN));
  return {
    conds: {
      bias: both(
        cl.map((c, i) => c > mv[i]),
        cl.map((c, i) => c < mv[i]),
      ),
    },
    overlays: bool(p, 'show') ? [{ name: `HTF MA (${tf})`, values: mv, color: C.purple, width: 2, style: 'step' }] : [],
    events: [],
    readout: { label: 'HTF bias', value: (i) => (cl[i] > mv[i] ? 'Bullish' : cl[i] < mv[i] ? 'Bearish' : 'Neutral') },
  };
};

const ichi: Sim = ({ bars }, p) => {
  const H = bars.map((b) => b.h);
  const Lw = bars.map((b) => b.l);
  const mid = (n: number) => T.highest(H, n).map((h, i) => (h + T.lowest(Lw, n)[i]) / 2);
  const tenkan = mid(num(p, 'conv'));
  const kijun = mid(num(p, 'base'));
  const spanA = tenkan.map((t, i) => (t + kijun[i]) / 2);
  const spanB = mid(num(p, 'spanB'));
  const d = num(p, 'disp') - 1;
  const top = spanA.map((_, i) => (i >= d ? Math.max(spanA[i - d], spanB[i - d]) : NaN));
  const bot = spanA.map((_, i) => (i >= d ? Math.min(spanA[i - d], spanB[i - d]) : NaN));
  const close = bars.map((b) => b.c);
  const disp = num(p, 'disp');
  return {
    conds: {
      tk: both(T.crossover(tenkan, kijun), T.crossunder(tenkan, kijun)),
      cloud: both(
        close.map((c, i) => c > top[i]),
        close.map((c, i) => c < bot[i]),
      ),
      chikou: both(
        close.map((c, i) => i >= disp && c > close[i - disp]),
        close.map((c, i) => i >= disp && c < close[i - disp]),
      ),
    },
    overlays: [
      { name: 'Tenkan', values: tenkan, color: '#29B6F6' },
      { name: 'Kijun', values: kijun, color: '#EF6C00' },
      { name: 'Cloud top (current)', values: top, color: C.bull, style: 'dotted' },
      { name: 'Cloud bottom (current)', values: bot, color: C.bear, style: 'dotted' },
    ],
    events: [],
  };
};

const adx: Sim = ({ bars }, p) => {
  const [dip, dim, a] = T.dmi(bars, num(p, 'len'), num(p, 'smooth'));
  const thr = num(p, 'thr');
  const trending = a.map((x) => x > thr);
  const ranging = a.map((x) => x < thr);
  return {
    conds: {
      trending: both(trending, trending),
      di: both(
        dip.map((x, i) => x > dim[i]),
        dip.map((x, i) => x < dim[i]),
      ),
      ranging: both(ranging, ranging),
    },
    overlays: [],
    events: [],
    readout: { label: 'ADX', value: (i) => (Number.isNaN(a[i]) ? '—' : `${a[i].toFixed(1)} ${a[i] > thr ? 'trending' : 'ranging'}`) },
  };
};

const rsi: Sim = ({ bars }, p) => {
  const v = T.rsi(srcOf(bars, str(p, 'src')), num(p, 'len'));
  const os = T.fill(bars.length, num(p, 'os'));
  const ob = T.fill(bars.length, num(p, 'ob'));
  const mid = num(p, 'mid');
  return {
    conds: {
      reversal: both(T.crossover(v, os), T.crossunder(v, ob)),
      dip: both(T.crossunder(v, os), T.crossover(v, ob)),
      momentum: both(
        v.map((x) => x > mid),
        v.map((x) => x < mid),
      ),
      notExtreme: both(
        v.map((x) => x < ob[0]),
        v.map((x) => x > os[0]),
      ),
      midExit: both(
        v.map((x) => x > mid),
        v.map((x) => x < mid),
      ),
    },
    overlays: [],
    events: [],
    readout: { label: 'RSI', value: (i) => (Number.isNaN(v[i]) ? '—' : v[i].toFixed(1)) },
  };
};

const macd: Sim = ({ bars }, p) => {
  const [m, s, h] = T.macd(
    bars.map((b) => b.c),
    num(p, 'fast'),
    num(p, 'slow'),
    num(p, 'sig'),
  );
  const up = T.crossover(m, s);
  const dn = T.crossunder(m, s);
  return {
    conds: {
      cross: both(up, dn),
      zoneValue: both(
        m.map((x) => x < 0),
        m.map((x) => x > 0),
      ),
      aboveZero: both(
        m.map((x) => x > 0),
        m.map((x) => x < 0),
      ),
      hist: both(
        h.map((x, i) => i > 0 && x > h[i - 1]),
        h.map((x, i) => i > 0 && x < h[i - 1]),
      ),
      crossExit: both(dn, up),
    },
    overlays: [],
    events: [],
    readout: { label: 'MACD hist', value: (i) => (Number.isNaN(h[i]) ? '—' : h[i].toPrecision(4)) },
  };
};

const stoch: Sim = ({ bars }, p) => {
  const k = T.sma(T.stoch(bars, num(p, 'kLen')), num(p, 'smooth'));
  const d = T.sma(k, num(p, 'dLen'));
  const up = T.crossover(k, d);
  const dn = T.crossunder(k, d);
  return {
    conds: {
      cross: both(
        up.map((x, i) => x && d[i] < num(p, 'os')),
        dn.map((x, i) => x && d[i] > num(p, 'ob')),
      ),
      side: both(
        k.map((x, i) => x > d[i]),
        k.map((x, i) => x < d[i]),
      ),
    },
    overlays: [],
    events: [],
    readout: { label: 'Stoch %K', value: (i) => (Number.isNaN(k[i]) ? '—' : k[i].toFixed(1)) },
  };
};

const sqz: Sim = ({ bars }, p) => {
  const n = num(p, 'len');
  const close = bars.map((b) => b.c);
  const basis = T.sma(close, n);
  const dev = T.stdev(close, n).map((x) => num(p, 'bbMult') * x);
  const rng = T.sma(T.tr(bars), n);
  const kc = num(p, 'kcMult');
  const on = basis.map((b, i) => b - dev[i] > b - kc * rng[i] && b + dev[i] < b + kc * rng[i]);
  const fired = on.map((x, i) => i > 0 && on[i - 1] && !x);
  const hh = T.highest(
    bars.map((b) => b.h),
    n,
  );
  const ll = T.lowest(
    bars.map((b) => b.l),
    n,
  );
  const sm = T.sma(close, n);
  const mom = T.linreg(
    close.map((c, i) => c - ((hh[i] + ll[i]) / 2 + sm[i]) / 2),
    n,
  );
  return {
    conds: {
      fire: both(
        fired.map((f, i) => f && mom[i] > 0),
        fired.map((f, i) => f && mom[i] < 0),
      ),
      mom: both(
        mom.map((m, i) => i > 0 && m > 0 && m > mom[i - 1]),
        mom.map((m, i) => i > 0 && m < 0 && m < mom[i - 1]),
      ),
      momExit: both(
        mom.map((m, i) => i > 1 && m < mom[i - 1] && mom[i - 1] < mom[i - 2]),
        mom.map((m, i) => i > 1 && m > mom[i - 1] && mom[i - 1] > mom[i - 2]),
      ),
    },
    overlays: [],
    events: fired.flatMap((f, i) => (f ? [{ bar: i, side: 'below' as const, text: 'SQZ', tone: 'neutral' as const, detail: 'Volatility squeeze released' }] : [])),
    readout: { label: 'Squeeze', value: (i) => `${on[i] ? 'ON' : 'off'} · mom ${Number.isNaN(mom[i]) ? '—' : mom[i].toPrecision(3)}` },
  };
};

const bbSim: Sim = ({ bars }, p) => {
  const close = bars.map((b) => b.c);
  const [mid, up, lo] = T.bb(close, num(p, 'len'), num(p, 'mult'));
  return {
    conds: {
      reentry: both(T.crossover(close, lo), T.crossunder(close, up)),
      breakout: both(T.crossover(close, up), T.crossunder(close, lo)),
      belowBasis: both(
        close.map((c, i) => c < mid[i]),
        close.map((c, i) => c > mid[i]),
      ),
      basisExit: both(
        close.map((c, i) => c >= mid[i]),
        close.map((c, i) => c <= mid[i]),
      ),
    },
    overlays: [
      { name: 'BB basis', values: mid, color: C.amber },
      { name: 'BB upper', values: up, color: '#64B5F6' },
      { name: 'BB lower', values: lo, color: '#64B5F6' },
    ],
    events: [],
  };
};

const atrf: Sim = ({ bars }, p) => {
  const a = T.atr(bars, num(p, 'len'));
  const base = T.sma(a, num(p, 'baseLen'));
  const pct = a.map((x, i) => (100 * x) / bars[i].c);
  const band = pct.map((x) => x >= num(p, 'minPct') && x <= num(p, 'maxPct'));
  const exp = a.map((x, i) => x > base[i]);
  return { conds: { band: both(band, band), expanding: both(exp, exp) }, overlays: [], events: [], readout: { label: 'ATR %', value: (i) => (Number.isNaN(pct[i]) ? '—' : `${pct[i].toFixed(2)}%`) } };
};

const vwap: Sim = ({ bars }, p) => {
  const unit = str(p, 'anchor') === 'Week' ? 'W' : str(p, 'anchor') === 'Month' ? 'M' : 'D';
  const v = T.fill(bars.length);
  const sd = T.fill(bars.length);
  let spv = 0,
    sv = 0,
    sp2v = 0;
  bars.forEach((b, i) => {
    if (i === 0 || dayKey(b.t, unit) !== dayKey(bars[i - 1].t, unit)) spv = sv = sp2v = 0;
    const hlc3 = (b.h + b.l + b.c) / 3;
    const vol = T.nz(b.v);
    spv += hlc3 * vol;
    sv += vol;
    sp2v += hlc3 * hlc3 * vol;
    v[i] = sv > 0 ? spv / sv : hlc3;
    sd[i] = sv > 0 ? Math.sqrt(Math.max(sp2v / sv - v[i] * v[i], 0)) : 0;
  });
  const m = num(p, 'bandMult');
  const up = v.map((x, i) => x + m * sd[i]);
  const lo = v.map((x, i) => x - m * sd[i]);
  const close = bars.map((b) => b.c);
  return {
    conds: {
      reclaim: both(T.crossover(close, v), T.crossunder(close, v)),
      bounce: both(
        bars.map((b, i) => b.l < v[i] && b.c > v[i] && b.c > b.o),
        bars.map((b, i) => b.h > v[i] && b.c < v[i] && b.c < b.o),
      ),
      side: both(
        close.map((c, i) => c > v[i]),
        close.map((c, i) => c < v[i]),
      ),
      notStretched: both(
        close.map((c, i) => c < up[i]),
        close.map((c, i) => c > lo[i]),
      ),
    },
    overlays: [
      { name: 'VWAP', values: v, color: C.magenta, width: 2 },
      { name: 'VWAP upper', values: up, color: C.magenta, style: 'dotted' },
      { name: 'VWAP lower', values: lo, color: C.magenta, style: 'dotted' },
    ],
    events: [],
  };
};

const vol: Sim = ({ bars }, p) => {
  const vv = bars.map((b) => b.v);
  const avg = T.sma(vv, num(p, 'len'));
  const rv = vv.map((x, i) => (avg[i] > 0 ? x / avg[i] : 0));
  const spike = rv.map((x) => x > num(p, 'mult'));
  return { conds: { spike: both(spike, spike) }, overlays: [], events: [], readout: { label: 'RVOL', value: (i) => `${rv[i].toFixed(2)}x` } };
};

const don: Sim = ({ bars }, p) => {
  const H = bars.map((b) => b.h);
  const Lw = bars.map((b) => b.l);
  const close = bars.map((b) => b.c);
  const hi = T.lag(T.highest(H, num(p, 'len')));
  const lo = T.lag(T.lowest(Lw, num(p, 'len')));
  const exHi = T.lag(T.highest(H, num(p, 'exitLen')));
  const exLo = T.lag(T.lowest(Lw, num(p, 'exitLen')));
  const a = T.atr(bars, 14);
  const brkL = T.crossover(close, hi);
  const brkS = T.crossunder(close, lo);
  const tol = num(p, 'tol');
  const win = num(p, 'retestBars');
  const retL: boolean[] = [];
  const retS: boolean[] = [];
  let lvlL = NaN,
    barL = NaN,
    lvlS = NaN,
    barS = NaN;
  bars.forEach((b, i) => {
    const rl = !Number.isNaN(lvlL) && i - barL > 0 && i - barL <= win && b.l <= lvlL + tol * a[i] && b.c > lvlL;
    const rs = !Number.isNaN(lvlS) && i - barS > 0 && i - barS <= win && b.h >= lvlS - tol * a[i] && b.c < lvlS;
    retL.push(rl);
    retS.push(rs);
    if (rl || (!Number.isNaN(lvlL) && (b.c < lvlL - tol * a[i] || i - barL > win))) lvlL = NaN;
    if (rs || (!Number.isNaN(lvlS) && (b.c > lvlS + tol * a[i] || i - barS > win))) lvlS = NaN;
    if (brkL[i]) {
      lvlL = hi[i];
      barL = i;
    }
    if (brkS[i]) {
      lvlS = lo[i];
      barS = i;
    }
  });
  return {
    conds: {
      breakout: both(brkL, brkS),
      retest: both(retL, retS),
      channelExit: both(
        close.map((c, i) => c < exLo[i]),
        close.map((c, i) => c > exHi[i]),
      ),
    },
    overlays: [
      { name: 'Donchian high', values: hi, color: C.bull, style: 'step' },
      { name: 'Donchian low', values: lo, color: C.bear, style: 'step' },
    ],
    stop: { L: lo, S: hi },
    events: [],
  };
};

const sr: Sim = ({ bars }, p) => {
  const ph = T.pivothigh(
    bars.map((b) => b.h),
    num(p, 'left'),
    num(p, 'right'),
  );
  const pl = T.pivotlow(
    bars.map((b) => b.l),
    num(p, 'left'),
    num(p, 'right'),
  );
  const a = T.atr(bars, 14);
  const tol = num(p, 'tol');
  const res = T.fill(bars.length);
  const sup = T.fill(bars.length);
  const resB = T.fill(bars.length); // value before role-reversal, used by conditions
  const supB = T.fill(bars.length);
  const brkL: boolean[] = [],
    brkS: boolean[] = [],
    bounceL: boolean[] = [],
    rejectS: boolean[] = [];
  let r = NaN,
    s = NaN;
  bars.forEach((b, i) => {
    if (!Number.isNaN(ph[i])) r = ph[i];
    if (!Number.isNaN(pl[i])) s = pl[i];
    const pc = i ? bars[i - 1].c : NaN;
    const bl = !Number.isNaN(r) && b.c > r && pc <= r;
    const bs = !Number.isNaN(s) && b.c < s && pc >= s;
    brkL.push(bl);
    brkS.push(bs);
    bounceL.push(!Number.isNaN(s) && b.l <= s + tol * a[i] && b.c > s && b.c > b.o);
    rejectS.push(!Number.isNaN(r) && b.h >= r - tol * a[i] && b.c < r && b.c < b.o);
    resB[i] = r;
    supB[i] = s;
    if (bl) {
      s = r;
      r = NaN;
    }
    if (bs) {
      r = s;
      s = NaN;
    }
    res[i] = r;
    sup[i] = s;
  });
  return {
    conds: {
      bounce: both(bounceL, rejectS),
      break: both(brkL, brkS),
      room: both(
        bars.map((b, i) => Number.isNaN(resB[i]) || resB[i] - b.c > a[i]),
        bars.map((b, i) => Number.isNaN(supB[i]) || b.c - supB[i] > a[i]),
      ),
    },
    overlays: [
      { name: 'Resistance', values: res, color: C.bear, width: 2 },
      { name: 'Support', values: sup, color: C.bull, width: 2 },
    ],
    stop: { L: sup, S: res },
    events: [],
  };
};

const smc: Sim = ({ bars }, p) => {
  const n = bars.length;
  const sw = num(p, 'swing');
  const sweepWin = num(p, 'sweepWin');
  const entryWin = num(p, 'entryWin');
  const fvgMin = num(p, 'fvgMin');
  const obLook = num(p, 'obLook');
  const H = bars.map((b) => b.h);
  const Lw = bars.map((b) => b.l);
  const a = T.atr(bars, 14);
  const ph = T.pivothigh(H, sw, sw);
  const pl = T.pivotlow(Lw, sw, sw);
  const lowRef = T.lowest(Lw, sw * 2 + 1);
  const highRef = T.highest(H, sw * 2 + 1);
  const eq = T.highest(H, num(p, 'pdLen')).map((h, i) => (h + T.lowest(Lw, num(p, 'pdLen'))[i]) / 2);
  const out = {
    seqL: [] as boolean[], seqS: [] as boolean[], bosL: [] as boolean[], bosS: [] as boolean[], chochL: [] as boolean[], chochS: [] as boolean[],
    recentL: [] as boolean[], recentS: [] as boolean[], trend: [] as number[], inObL: [] as boolean[], inObS: [] as boolean[],
    stopL: T.fill(n), stopS: T.fill(n), swH: T.fill(n), swL: T.fill(n),
    // Active zones per bar (NaN when none), drawn as step lines on the chart.
    fvgLTop: T.fill(n), fvgLBot: T.fill(n), fvgSTop: T.fill(n), fvgSBot: T.fill(n),
    obLTop: T.fill(n), obLBot: T.fill(n), obSTop: T.fill(n), obSBot: T.fill(n),
  };
  const events: CompEvent[] = [];
  let swH = NaN, swL = NaN, swHBar = NaN, swLBar = NaN, swHBroken = true, swLBroken = true, trend = 0;
  let sweepBarL = NaN, sweepBarS = NaN, sweepExtL = NaN, sweepExtS = NaN;
  let fvgLTop = NaN, fvgLBot = NaN, fvgLBar = NaN, fvgSTop = NaN, fvgSBot = NaN, fvgSBar = NaN;
  let obLTop = NaN, obLBot = NaN, obSTop = NaN, obSBot = NaN, shiftBarL = NaN, shiftBarS = NaN;
  const isN = Number.isNaN;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!isN(ph[i])) { swH = ph[i]; swHBar = i - sw; swHBroken = false; }
    if (!isN(pl[i])) { swL = pl[i]; swLBar = i - sw; swLBroken = false; }
    const sweepL = !isN(swL) && !swLBroken && b.l < swL && b.c > swL;
    const sweepS = !isN(swH) && !swHBroken && b.h > swH && b.c < swH;
    if (sweepL) { sweepExtL = !isN(sweepBarL) && i - sweepBarL <= sweepWin ? Math.min(sweepExtL, b.l) : b.l; sweepBarL = i; events.push({ bar: i, side: 'below', text: '$', tone: 'bull', detail: 'Sell-side liquidity sweep' }); }
    if (sweepS) { sweepExtS = !isN(sweepBarS) && i - sweepBarS <= sweepWin ? Math.max(sweepExtS, b.h) : b.h; sweepBarS = i; events.push({ bar: i, side: 'above', text: '$', tone: 'bear', detail: 'Buy-side liquidity sweep' }); }
    const recentL = !isN(sweepBarL) && i - sweepBarL <= sweepWin;
    const recentS = !isN(sweepBarS) && i - sweepBarS <= sweepWin;
    let bosL = false, chochL = false, bosS = false, chochS = false;
    if (!swHBroken && !isN(swH) && b.c > swH) { if (trend === -1) chochL = true; else bosL = true; trend = 1; swHBroken = true; }
    if (!swLBroken && !isN(swL) && b.c < swL) { if (trend === 1) chochS = true; else bosS = true; trend = -1; swLBroken = true; }
    const shiftL = bosL || chochL;
    const shiftS = bosS || chochS;
    if (shiftL) events.push({ bar: i, side: 'below', text: chochL ? 'CHoCH' : 'BOS', tone: 'bull', detail: `Bullish ${chochL ? 'change of character' : 'break of structure'}` });
    if (shiftS) events.push({ bar: i, side: 'above', text: chochS ? 'CHoCH' : 'BOS', tone: 'bear', detail: `Bearish ${chochS ? 'change of character' : 'break of structure'}` });
    if (i >= 2) {
      const fvgUp = b.l > bars[i - 2].h && b.l - bars[i - 2].h >= fvgMin * a[i] && bars[i - 1].c > bars[i - 1].o;
      const fvgDn = b.h < bars[i - 2].l && bars[i - 2].l - b.h >= fvgMin * a[i] && bars[i - 1].c < bars[i - 1].o;
      if (fvgUp) { fvgLTop = b.l; fvgLBot = bars[i - 2].h; fvgLBar = i; events.push({ bar: i, side: 'below', text: 'FVG', tone: 'bull', detail: `Bullish fair value gap ${fvgLBot.toPrecision(6)}–${fvgLTop.toPrecision(6)}` }); }
      if (fvgDn) { fvgSTop = bars[i - 2].l; fvgSBot = b.h; fvgSBar = i; events.push({ bar: i, side: 'above', text: 'FVG', tone: 'bear', detail: `Bearish fair value gap ${fvgSBot.toPrecision(6)}–${fvgSTop.toPrecision(6)}` }); }
    }
    if (shiftL) for (let k = 1; k <= obLook && i - k >= 0; k++) if (bars[i - k].c < bars[i - k].o) { obLTop = bars[i - k].h; obLBot = bars[i - k].l; break; }
    if (shiftS) for (let k = 1; k <= obLook && i - k >= 0; k++) if (bars[i - k].c > bars[i - k].o) { obSTop = bars[i - k].h; obSBot = bars[i - k].l; break; }
    out.inObL.push(!isN(obLTop) && b.l <= obLTop && b.c > obLTop && b.c > b.o);
    out.inObS.push(!isN(obSBot) && b.h >= obSBot && b.c < obSBot && b.c < b.o);
    if (!isN(obLBot) && b.c < obLBot) obLTop = obLBot = NaN;
    if (!isN(obSTop) && b.c > obSTop) obSTop = obSBot = NaN;
    if (shiftL && recentL) shiftBarL = i;
    if (shiftS && recentS) shiftBarS = i;
    const armedL = !isN(shiftBarL) && i - shiftBarL <= entryWin;
    const armedS = !isN(shiftBarS) && i - shiftBarS <= entryWin;
    const okL = !isN(fvgLTop) && !isN(sweepBarL) && fvgLBar >= sweepBarL && i > fvgLBar;
    const okS = !isN(fvgSBot) && !isN(sweepBarS) && fvgSBar >= sweepBarS && i > fvgSBar;
    const seqL = armedL && okL && b.l <= fvgLTop && b.c > fvgLBot;
    const seqS = armedS && okS && b.h >= fvgSBot && b.c < fvgSTop;
    if (seqL) shiftBarL = NaN;
    if (seqS) shiftBarS = NaN;
    if (!isN(fvgLBot) && b.c < fvgLBot) fvgLTop = fvgLBot = NaN;
    if (!isN(fvgSTop) && b.c > fvgSTop) fvgSTop = fvgSBot = NaN;
    out.seqL.push(seqL); out.seqS.push(seqS); out.bosL.push(bosL); out.bosS.push(bosS); out.chochL.push(chochL); out.chochS.push(chochS);
    out.recentL.push(recentL); out.recentS.push(recentS); out.trend.push(trend);
    out.stopL[i] = isN(sweepExtL) || !recentL ? lowRef[i] : Math.min(sweepExtL, lowRef[i]);
    out.stopS[i] = isN(sweepExtS) || !recentS ? highRef[i] : Math.max(sweepExtS, highRef[i]);
    out.swH[i] = swHBroken ? NaN : swH;
    out.swL[i] = swLBroken ? NaN : swL;
    out.fvgLTop[i] = fvgLTop; out.fvgLBot[i] = fvgLBot; out.fvgSTop[i] = fvgSTop; out.fvgSBot[i] = fvgSBot;
    out.obLTop[i] = obLTop; out.obLBot[i] = obLBot; out.obSTop[i] = obSTop; out.obSBot[i] = obSBot;
  }
  const close = bars.map((b) => b.c);
  const showEv = (t: string) => (t === '$' ? bool(p, 'showSweep') : t === 'FVG' ? bool(p, 'showFvg') : bool(p, 'showStruct'));
  return {
    conds: {
      sequence: both(out.seqL, out.seqS),
      shift: both(out.bosL.map((x, i) => x || out.chochL[i]), out.bosS.map((x, i) => x || out.chochS[i])),
      choch: both(out.chochL, out.chochS),
      recentSweep: both(out.recentL, out.recentS),
      trend: both(out.trend.map((t) => t === 1), out.trend.map((t) => t === -1)),
      discount: both(close.map((c, i) => c < eq[i]), close.map((c, i) => c > eq[i])),
      inOb: both(out.inObL, out.inObS),
    },
    overlays: [
      ...(bool(p, 'showSweep')
        ? [
            { name: 'Buy-side liquidity (swing high)', values: out.swH, color: C.bear, style: 'dotted' as const },
            { name: 'Sell-side liquidity (swing low)', values: out.swL, color: C.bull, style: 'dotted' as const },
          ]
        : []),
      ...(bool(p, 'showFvg')
        ? [
            { name: 'Bullish FVG top', values: out.fvgLTop, color: '#26A69A', style: 'step' as const },
            { name: 'Bullish FVG bottom', values: out.fvgLBot, color: '#26A69A', style: 'step' as const },
            { name: 'Bearish FVG top', values: out.fvgSTop, color: '#EF5350', style: 'step' as const },
            { name: 'Bearish FVG bottom', values: out.fvgSBot, color: '#EF5350', style: 'step' as const },
          ]
        : []),
      ...(bool(p, 'showOb')
        ? [
            { name: 'Bullish order block top', values: out.obLTop, color: '#00897B', style: 'dotted' as const },
            { name: 'Bullish order block bottom', values: out.obLBot, color: '#00897B', style: 'dotted' as const },
            { name: 'Bearish order block top', values: out.obSTop, color: '#C62828', style: 'dotted' as const },
            { name: 'Bearish order block bottom', values: out.obSBot, color: '#C62828', style: 'dotted' as const },
          ]
        : []),
      { name: 'Equilibrium (premium above / discount below)', values: eq, color: C.grey, style: 'dotted' as const },
    ],
    stop: { L: out.stopL, S: out.stopS },
    events: events.filter((e) => showEv(e.text)),
    readout: { label: 'Structure', value: (i) => `${out.trend[i] === 1 ? 'Bullish' : out.trend[i] === -1 ? 'Bearish' : 'Undefined'} · ${close[i] < eq[i] ? 'discount' : 'premium'}` },
  };
};

const orb: Sim = ({ bars }, p) => {
  const sess = str(p, 'sess');
  const tz = str(p, 'tz');
  const inOR = bars.map((b) => inSession(b.t, sess, tz));
  const orH = T.fill(bars.length);
  const orL = T.fill(bars.length);
  const sigL: boolean[] = [];
  const sigS: boolean[] = [];
  let h = NaN,
    l = NaN,
    usedL = false,
    usedS = false;
  bars.forEach((b, i) => {
    const prevH = h;
    const prevL = l;
    if (inOR[i] && !(i > 0 && inOR[i - 1])) {
      h = b.h;
      l = b.l;
      usedL = usedS = false;
    } else if (inOR[i]) {
      h = Math.max(h, b.h);
      l = Math.min(l, b.l);
    }
    orH[i] = h;
    orL[i] = l;
    const ready = !inOR[i] && !Number.isNaN(h);
    // ta.crossover(close, orH): uses the previous bar's orH value as its reference point.
    const pc = i ? bars[i - 1].c : NaN;
    const xUp = b.c > h && pc <= (i ? orH[i - 1] : NaN) && !Number.isNaN(prevH);
    const xDn = b.c < l && pc >= (i ? orL[i - 1] : NaN) && !Number.isNaN(prevL);
    const sl = ready && xUp && !usedL;
    const ss = ready && xDn && !usedS;
    if (sl) usedL = true;
    if (ss) usedS = true;
    sigL.push(sl);
    sigS.push(ss);
  });
  return {
    conds: { breakout: both(sigL, sigS) },
    overlays: [
      { name: 'OR high', values: orH.map((x, i) => (!inOR[i] ? x : NaN)), color: C.bull },
      { name: 'OR low', values: orL.map((x, i) => (!inOR[i] ? x : NaN)), color: C.bear },
    ],
    stop: { L: orL, S: orH },
    events: [],
  };
};

const candle: Sim = ({ bars }, p) => {
  const w = num(p, 'wickRatio');
  const engL = bars.map((b, i) => i > 0 && b.c > b.o && bars[i - 1].c < bars[i - 1].o && b.c >= bars[i - 1].o && b.o <= bars[i - 1].c);
  const engS = bars.map((b, i) => i > 0 && b.c < b.o && bars[i - 1].c > bars[i - 1].o && b.c <= bars[i - 1].o && b.o >= bars[i - 1].c);
  const tick = 1e-9;
  const pinL = bars.map((b) => {
    const r = b.h - b.l;
    return r > 0 && Math.min(b.o, b.c) - b.l >= w * Math.max(Math.abs(b.c - b.o), tick) && b.c >= b.l + (r * 2) / 3;
  });
  const pinS = bars.map((b) => {
    const r = b.h - b.l;
    return r > 0 && b.h - Math.max(b.o, b.c) >= w * Math.max(Math.abs(b.c - b.o), tick) && b.c <= b.l + r / 3;
  });
  return {
    conds: {
      engulf: both(engL, engS),
      pin: both(pinL, pinS),
      any: both(
        engL.map((x, i) => x || pinL[i]),
        engS.map((x, i) => x || pinS[i]),
      ),
    },
    overlays: [],
    events: [],
  };
};

export const SIMS: Record<string, Sim> = { ema, trend, st, htf, ichi, adx, rsi, macd, stoch, sqz, bb: bbSim, atrf, vwap, vol, don, sr, smc, orb, candle };
void map2;
