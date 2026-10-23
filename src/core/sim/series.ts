// Technical-analysis series functions that mirror Pine Script's built-ins.
// Numbers use NaN for Pine's `na`; booleans are never na (as in Pine v6).

export type S = number[];
export type B = boolean[];

export interface Bar {
  t: number; // bar open time, epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const isNa = (x: number) => x === undefined || Number.isNaN(x);
export const na = isNa;
export const nz = (x: number, d = 0) => (isNa(x) ? d : x);

export function fill(n: number, v = NaN): S {
  return new Array(n).fill(v);
}

/** x[k] — history reference (NaN before the first bar). */
export function lag(a: S, k = 1): S {
  return a.map((_, i) => (i - k >= 0 ? a[i - k] : NaN));
}
export function lagB(a: B, k = 1): B {
  return a.map((_, i) => (i - k >= 0 ? a[i - k] : false));
}

export function sma(src: S, n: number): S {
  const out = fill(src.length);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < src.length; i++) {
    if (!isNa(src[i])) {
      sum += src[i];
      cnt++;
    }
    if (i >= n && !isNa(src[i - n])) {
      sum -= src[i - n];
      cnt--;
    }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
}

/** Exponential average seeded with the SMA of the first `n` valid values. */
function expAvg(src: S, n: number, alpha: number): S {
  const out = fill(src.length);
  let prev = NaN;
  let seed: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (isNa(x)) {
      out[i] = prev;
      continue;
    }
    if (isNa(prev)) {
      seed.push(x);
      if (seed.length === n) {
        prev = seed.reduce((a, b) => a + b, 0) / n;
        out[i] = prev;
        seed = [];
      }
      continue;
    }
    prev = alpha * x + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export const ema = (src: S, n: number) => expAvg(src, n, 2 / (n + 1));
export const rma = (src: S, n: number) => expAvg(src, n, 1 / n);

export function wma(src: S, n: number): S {
  const out = fill(src.length);
  const den = (n * (n + 1)) / 2;
  for (let i = n - 1; i < src.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const x = src[i - k];
      if (isNa(x)) {
        ok = false;
        break;
      }
      s += x * (n - k);
    }
    if (ok) out[i] = s / den;
  }
  return out;
}

export function vwma(src: S, vol: S, n: number): S {
  const pv = sma(
    src.map((x, i) => x * vol[i]),
    n,
  );
  const v = sma(vol, n);
  return pv.map((x, i) => (v[i] ? x / v[i] : NaN));
}

export function hma(src: S, n: number): S {
  const half = wma(src, Math.max(1, Math.floor(n / 2)));
  const full = wma(src, n);
  return wma(
    half.map((x, i) => 2 * x - full[i]),
    Math.max(1, Math.floor(Math.sqrt(n))),
  );
}

export function ma(src: S, vol: S, n: number, type: string): S {
  switch (type) {
    case 'SMA':
      return sma(src, n);
    case 'WMA':
      return wma(src, n);
    case 'VWMA':
      return vwma(src, vol, n);
    case 'HMA':
      return hma(src, n);
    case 'RMA':
      return rma(src, n);
    default:
      return ema(src, n);
  }
}

/** Population standard deviation (Pine's ta.stdev default, biased = true). */
export function stdev(src: S, n: number): S {
  const m = sma(src, n);
  return src.map((_, i) => {
    if (isNa(m[i])) return NaN;
    let s = 0;
    for (let k = 0; k < n; k++) s += (src[i - k] - m[i]) ** 2;
    return Math.sqrt(s / n);
  });
}

export function highest(src: S, n: number): S {
  return src.map((_, i) => {
    if (i < n - 1) return NaN;
    let m = -Infinity;
    for (let k = 0; k < n; k++) m = Math.max(m, src[i - k]);
    return Number.isFinite(m) ? m : NaN;
  });
}
export function lowest(src: S, n: number): S {
  return src.map((_, i) => {
    if (i < n - 1) return NaN;
    let m = Infinity;
    for (let k = 0; k < n; k++) m = Math.min(m, src[i - k]);
    return Number.isFinite(m) ? m : NaN;
  });
}

export function tr(bars: Bar[]): S {
  return bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
}
export const atr = (bars: Bar[], n: number) => rma(tr(bars), n);

export function rsi(src: S, n: number): S {
  const up = src.map((x, i) => (i ? Math.max(x - src[i - 1], 0) : NaN));
  const dn = src.map((x, i) => (i ? Math.max(src[i - 1] - x, 0) : NaN));
  const ru = rma(up, n);
  const rd = rma(dn, n);
  return ru.map((u, i) => (isNa(u) || isNa(rd[i]) ? NaN : rd[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[i])));
}

export function crossover(a: S, b: S): B {
  return a.map((x, i) => i > 0 && x > b[i] && a[i - 1] <= b[i - 1]);
}
export function crossunder(a: S, b: S): B {
  return a.map((x, i) => i > 0 && x < b[i] && a[i - 1] >= b[i - 1]);
}

export function macd(src: S, fast: number, slow: number, sig: number): [S, S, S] {
  const f = ema(src, fast);
  const s = ema(src, slow);
  const m = f.map((x, i) => x - s[i]);
  const signal = ema(m, sig);
  return [m, signal, m.map((x, i) => x - signal[i])];
}

export function bb(src: S, n: number, mult: number): [S, S, S] {
  const mid = sma(src, n);
  const dev = stdev(src, n);
  return [mid, mid.map((m, i) => m + mult * dev[i]), mid.map((m, i) => m - mult * dev[i])];
}

/** ta.dmi → [+DI, −DI, ADX] (Wilder). */
export function dmi(bars: Bar[], len: number, smooth: number): [S, S, S] {
  const up = bars.map((b, i) => (i ? b.h - bars[i - 1].h : NaN));
  const down = bars.map((b, i) => (i ? bars[i - 1].l - b.l : NaN));
  const plusDM = up.map((u, i) => (isNa(u) ? NaN : u > down[i] && u > 0 ? u : 0));
  const minusDM = down.map((d, i) => (isNa(d) ? NaN : d > up[i] && d > 0 ? d : 0));
  const trur = rma(tr(bars), len);
  const plus = rma(plusDM, len).map((x, i) => (100 * x) / trur[i]);
  const minus = rma(minusDM, len).map((x, i) => (100 * x) / trur[i]);
  const dx = plus.map((p, i) => {
    const sum = p + minus[i];
    return isNa(sum) ? NaN : Math.abs(p - minus[i]) / (sum === 0 ? 1 : sum);
  });
  return [plus, minus, rma(dx, smooth).map((x) => 100 * x)];
}

/** ta.supertrend(factor, atrPeriod) → [line, direction] (direction −1 = up). */
export function supertrend(bars: Bar[], factor: number, period: number): [S, S] {
  const a = atr(bars, period);
  const line = fill(bars.length);
  const dir = fill(bars.length);
  let pl = NaN;
  let pu = NaN;
  for (let i = 0; i < bars.length; i++) {
    const src = (bars[i].h + bars[i].l) / 2;
    let lower = src - factor * a[i];
    let upper = src + factor * a[i];
    const prevLower = nz(pl);
    const prevUpper = nz(pu);
    const prevClose = i ? bars[i - 1].c : NaN;
    lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
    upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;
    let d: number;
    if (i === 0 || isNa(a[i - 1])) d = 1;
    else if (line[i - 1] === pu) d = bars[i].c > upper ? -1 : 1;
    else d = bars[i].c < lower ? 1 : -1;
    dir[i] = d;
    line[i] = d === -1 ? lower : upper;
    pl = lower;
    pu = upper;
  }
  return [line.map((x, i) => (isNa(a[i]) ? NaN : x)), dir];
}

export function stoch(bars: Bar[], n: number): S {
  const hh = highest(
    bars.map((b) => b.h),
    n,
  );
  const ll = lowest(
    bars.map((b) => b.l),
    n,
  );
  return bars.map((b, i) => (hh[i] - ll[i] === 0 ? 0 : (100 * (b.c - ll[i])) / (hh[i] - ll[i])));
}

/** ta.linreg(src, length, 0): regression value at the current bar. */
export function linreg(src: S, n: number): S {
  return src.map((_, i) => {
    if (i < n - 1) return NaN;
    let sx = 0,
      sy = 0,
      sxy = 0,
      sxx = 0;
    for (let k = 0; k < n; k++) {
      const x = k;
      const y = src[i - n + 1 + k];
      if (isNa(y)) return NaN;
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    return intercept + slope * (n - 1);
  });
}

/** ta.pivothigh(src, left, right): value appears on the bar `right` bars after the pivot. */
export function pivothigh(src: S, left: number, right: number): S {
  return src.map((_, i) => {
    const p = i - right;
    if (p - left < 0) return NaN;
    const v = src[p];
    for (let k = p - left; k <= i; k++) if (k !== p && (k < p ? src[k] >= v : src[k] > v)) return NaN;
    return v;
  });
}
export function pivotlow(src: S, left: number, right: number): S {
  return src.map((_, i) => {
    const p = i - right;
    if (p - left < 0) return NaN;
    const v = src[p];
    for (let k = p - left; k <= i; k++) if (k !== p && (k < p ? src[k] <= v : src[k] < v)) return NaN;
    return v;
  });
}

export function barssince(cond: B): S {
  let last = -1;
  return cond.map((c, i) => {
    if (c) last = i;
    return last < 0 ? NaN : i - last;
  });
}
