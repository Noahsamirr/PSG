// Backtest analytics for results exported from TradingView's Strategy Tester ("List of trades").
// Nothing here fabricates performance: every number is computed from imported trades.

export type ResultKind = 'backtest' | 'out_of_sample' | 'paper' | 'live';

export interface Trade {
  id: number;
  direction: 'long' | 'short';
  entryTime: number | null; // epoch ms
  exitTime: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  qty: number | null;
  profit: number; // net, account currency
  signal?: string;
}

export interface ParseResult {
  trades: Trade[];
  warnings: string[];
  columns: Record<string, string | null>;
  format: 'tradingview-list-of-trades' | 'generic';
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  payoffRatio: number | null;
  expectancy: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  maxConsecutiveLosses: number;
  avgDurationHours: number | null;
  tStat: number | null;
  largestWinShare: number | null; // share of net profit from the single best trade
  firstTime: number | null;
  lastTime: number | null;
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseNumber(s: string | undefined): number | null {
  if (s === undefined) return null;
  let t = s.replace(/[\s $€£¥%]/g, '').replace(/[A-Z]{3}$/i, '').replace(/^[−–]/, '-').replace(/−/g, '-');
  if (!t || t === '-' || /^n\/?a$/i.test(t)) return null;
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);
  // 1.234,56 → 1234.56 ; 1,234.56 → 1234.56
  if (/,\d{1,2}$/.test(t) && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseTime(s: string | undefined): number | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5]);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function findCol(headers: string[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseTradesCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { trades: [], warnings: ['File has no data rows.'], columns: {}, format: 'generic' };
  const delim = [',', ';', '\t'].map((d) => [d, lines[0].split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((l) => splitCsvLine(l, delim));

  const cTrade = findCol(headers, /^trade\s*#|^trade$|trade number/);
  const cType = findCol(headers, /^type$/);
  const cSignal = findCol(headers, /^signal/);
  const cDate = findCol(headers, /date\/time|date and time|^date|^time/);
  const cPrice = findCol(headers, /^price/);
  const cQty = findCol(headers, /contracts|position size \(qty\)|^qty|quantity|^size/);
  const cProfit = findCol(headers, /^net p&l(?!.*%)/, /^profit(?!.*%)/, /^p&l(?!.*%)/, /^pnl/, /^net profit(?!.*%)/);
  const columns: Record<string, string | null> = {
    trade: cTrade >= 0 ? headers[cTrade] : null,
    type: cType >= 0 ? headers[cType] : null,
    date: cDate >= 0 ? headers[cDate] : null,
    price: cPrice >= 0 ? headers[cPrice] : null,
    qty: cQty >= 0 ? headers[cQty] : null,
    profit: cProfit >= 0 ? headers[cProfit] : null,
  };
  if (cProfit < 0) return { trades: [], warnings: ['No profit / net P&L column found. Expected the TradingView "List of trades" export or a CSV with a "profit" column.'], columns, format: 'generic' };

  if (cTrade >= 0 && cType >= 0) {
    const groups = new Map<number, { entry?: string[]; exit?: string[] }>();
    for (const r of rows) {
      const id = parseNumber(r[cTrade]);
      if (id === null) continue;
      const g = groups.get(id) ?? {};
      const type = (r[cType] ?? '').toLowerCase();
      if (type.includes('entry')) g.entry = r;
      else if (type.includes('exit')) g.exit = r;
      groups.set(id, g);
    }
    const trades: Trade[] = [];
    let open = 0;
    for (const [id, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const row = g.exit ?? g.entry!;
      const typeStr = ((g.entry ?? g.exit)![cType] ?? '').toLowerCase();
      if (!g.exit || /open/i.test(g.exit[cSignal] ?? '')) open++;
      const profit = parseNumber(g.exit?.[cProfit]) ?? parseNumber(g.entry?.[cProfit]);
      if (profit === null) {
        warnings.push(`Trade ${id}: no profit value — skipped.`);
        continue;
      }
      trades.push({
        id,
        direction: typeStr.includes('short') ? 'short' : 'long',
        entryTime: parseTime(g.entry?.[cDate]),
        exitTime: parseTime(g.exit?.[cDate]),
        entryPrice: parseNumber(g.entry?.[cPrice]),
        exitPrice: parseNumber(g.exit?.[cPrice]),
        qty: parseNumber(row[cQty]),
        profit,
        signal: g.exit?.[cSignal] ?? g.entry?.[cSignal],
      });
    }
    if (open) warnings.push(`${open} trade(s) appear to be still open; their P&L is unrealised.`);
    if (!trades.length) warnings.push('No complete trades found.');
    return { trades, warnings, columns, format: 'tradingview-list-of-trades' };
  }

  const trades: Trade[] = [];
  rows.forEach((r, i) => {
    const profit = parseNumber(r[cProfit]);
    if (profit === null) return;
    const t = parseTime(r[cDate]);
    trades.push({ id: i + 1, direction: /short|sell/i.test(r[cType] ?? '') ? 'short' : 'long', entryTime: t, exitTime: t, entryPrice: parseNumber(r[cPrice]), exitPrice: null, qty: parseNumber(r[cQty]), profit });
  });
  warnings.push('Generic CSV: one row per trade assumed.');
  return { trades, warnings, columns, format: 'generic' };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

export function equityCurve(trades: Trade[], initial = 0): number[] {
  const out: number[] = [initial];
  for (const t of trades) out.push(out[out.length - 1] + t.profit);
  return out;
}

export function computeMetrics(trades: Trade[], initialCapital?: number): Metrics {
  const n = trades.length;
  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const grossProfit = wins.reduce((a, t) => a + t.profit, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.profit, 0);
  const net = grossProfit - grossLoss;
  // Drawdown on the closed-trade equity curve
  let peak = initialCapital ?? 0;
  let eq = initialCapital ?? 0;
  let maxDD = 0;
  let maxDDPct: number | null = initialCapital ? 0 : null;
  for (const t of trades) {
    eq += t.profit;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
    if (initialCapital && peak > 0) maxDDPct = Math.max(maxDDPct ?? 0, (100 * dd) / peak);
  }
  let streak = 0;
  let maxStreak = 0;
  for (const t of trades) {
    streak = t.profit < 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }
  const durations = trades.filter((t) => t.entryTime && t.exitTime).map((t) => (t.exitTime! - t.entryTime!) / 3_600_000);
  const profits = trades.map((t) => t.profit);
  const sd = n > 1 ? Math.sqrt(profits.reduce((a, p) => a + (p - net / n) ** 2, 0) / (n - 1)) : 0;
  const times = trades.flatMap((t) => [t.entryTime, t.exitTime]).filter((x): x is number => x !== null);
  const best = wins.length ? Math.max(...wins.map((t) => t.profit)) : 0;
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? (100 * wins.length) / n : null,
    grossProfit,
    grossLoss,
    netProfit: net,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : null,
    avgWin: wins.length ? grossProfit / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    payoffRatio: wins.length && losses.length ? grossProfit / wins.length / (grossLoss / losses.length) : null,
    expectancy: n ? net / n : null,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    maxConsecutiveLosses: maxStreak,
    avgDurationHours: durations.length ? mean(durations) : null,
    tStat: n > 1 && sd > 0 ? net / n / (sd / Math.sqrt(n)) : null,
    largestWinShare: net > 0 && best > 0 ? best / net : null,
    firstTime: times.length ? Math.min(...times) : null,
    lastTime: times.length ? Math.max(...times) : null,
  };
}

export function splitInOut(trades: Trade[], opts: { ratio?: number; splitTime?: number }): { inSample: Trade[]; outSample: Trade[] } {
  if (opts.splitTime !== undefined) {
    const t = opts.splitTime;
    return { inSample: trades.filter((x) => (x.entryTime ?? 0) < t), outSample: trades.filter((x) => (x.entryTime ?? 0) >= t) };
  }
  const k = Math.round(trades.length * (opts.ratio ?? 0.7));
  return { inSample: trades.slice(0, k), outSample: trades.slice(k) };
}

export function walkForward(trades: Trade[], folds = 5): { fold: number; metrics: Metrics }[] {
  const size = Math.ceil(trades.length / folds);
  const out: { fold: number; metrics: Metrics }[] = [];
  for (let i = 0; i < folds; i++) {
    const part = trades.slice(i * size, (i + 1) * size);
    if (part.length) out.push({ fold: i + 1, metrics: computeMetrics(part) });
  }
  return out;
}

/** Re-computes results with an extra round-trip cost per trade (in % of notional, or fixed cash). */
export function costStress(trades: Trade[], extra: { pctOfNotional?: number; cashPerTrade?: number }, multipliers = [1, 2, 3]): { multiplier: number; metrics: Metrics }[] {
  return multipliers.map((m) => ({
    multiplier: m,
    metrics: computeMetrics(
      trades.map((t) => {
        const notional = (t.entryPrice ?? 0) * Math.abs(t.qty ?? 0);
        const cost = (extra.cashPerTrade ?? 0) + (notional * (extra.pctOfNotional ?? 0)) / 100 * 2;
        return { ...t, profit: t.profit - m * cost };
      }),
    ),
  }));
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface MonteCarloResult {
  iterations: number;
  maxDrawdown: { p5: number; p50: number; p95: number };
  netProfit: { p5: number; p50: number; p95: number };
  probLoss: number;
}

/** Bootstrap (resample with replacement) of trade P&L to show path-dependence of drawdown. */
export function monteCarlo(trades: Trade[], iterations = 1000, seed = 42): MonteCarloResult | null {
  if (trades.length < 5) return null;
  const r = rng(seed);
  const dds: number[] = [];
  const nets: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let eq = 0;
    let peak = 0;
    let dd = 0;
    for (let j = 0; j < trades.length; j++) {
      eq += trades[Math.floor(r() * trades.length)].profit;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
    }
    dds.push(dd);
    nets.push(eq);
  }
  const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
  return {
    iterations,
    maxDrawdown: { p5: pct(dds, 5), p50: pct(dds, 50), p95: pct(dds, 95) },
    netProfit: { p5: pct(nets, 5), p50: pct(nets, 50), p95: pct(nets, 95) },
    probLoss: nets.filter((x) => x < 0).length / iterations,
  };
}

export interface Flag {
  level: 'warning' | 'info' | 'ok';
  code: string;
  message: string;
}

export function robustnessFlags(trades: Trade[], opts: { ratio?: number } = {}): Flag[] {
  const flags: Flag[] = [];
  const m = computeMetrics(trades);
  if (m.trades < 30) flags.push({ level: 'warning', code: 'sample-size', message: `${m.trades} trades is too few for any conclusion; 100+ trades across varied conditions is a common minimum.` });
  else if (m.trades < 100) flags.push({ level: 'info', code: 'sample-size', message: `${m.trades} trades — results are still noisy; confidence intervals are wide.` });
  else flags.push({ level: 'ok', code: 'sample-size', message: `${m.trades} trades.` });
  if (m.tStat !== null) {
    if (m.tStat < 2) flags.push({ level: 'warning', code: 'significance', message: `Mean trade t-statistic ${m.tStat.toFixed(2)} < 2: the average trade is not statistically distinguishable from zero.` });
    else flags.push({ level: 'ok', code: 'significance', message: `Mean trade t-statistic ${m.tStat.toFixed(2)} (before any multiple-testing adjustment).` });
  }
  if (m.profitFactor !== null && m.profitFactor > 3 && m.trades < 100) flags.push({ level: 'warning', code: 'overfit-pf', message: `Profit factor ${m.profitFactor.toFixed(2)} on ${m.trades} trades looks too good — typical of curve fitting.` });
  if (m.winRate !== null && m.winRate > 80 && (m.payoffRatio ?? 1) < 0.5) flags.push({ level: 'warning', code: 'tail-risk', message: 'Very high win rate with small payoff ratio: occasional large losses dominate (negative skew).' });
  if (m.largestWinShare !== null && m.largestWinShare > 0.5) flags.push({ level: 'warning', code: 'outlier-dependence', message: `${(100 * m.largestWinShare).toFixed(0)}% of net profit comes from a single trade.` });
  if (trades.length >= 20) {
    const { inSample, outSample } = splitInOut(trades, { ratio: opts.ratio ?? 0.7 });
    const a = computeMetrics(inSample);
    const b = computeMetrics(outSample);
    if (a.expectancy !== null && b.expectancy !== null && a.expectancy > 0) {
      const decay = 1 - b.expectancy / a.expectancy;
      if (decay > 0.5) flags.push({ level: 'warning', code: 'oos-decay', message: `Out-of-sample expectancy is ${(decay * 100).toFixed(0)}% lower than in-sample (chronological ${Math.round((opts.ratio ?? 0.7) * 100)}/${Math.round((1 - (opts.ratio ?? 0.7)) * 100)} split).` });
      else flags.push({ level: 'ok', code: 'oos-decay', message: `Out-of-sample expectancy is ${((1 - decay) * 100).toFixed(0)}% of in-sample (no large decay; very high values usually mean a small or unusual later sample).` });
    }
    const wf = walkForward(trades, 5);
    const profitable = wf.filter((f) => f.metrics.netProfit > 0).length;
    flags.push({ level: profitable >= 4 ? 'ok' : profitable >= 3 ? 'info' : 'warning', code: 'stability', message: `${profitable}/${wf.length} chronological segments were profitable.` });
  }
  return flags;
}

export interface RunSummary {
  label: string;
  kind: ResultKind;
  metrics: Metrics;
}

/** Parameter-stability view across several imported runs (e.g. the same strategy with nearby parameters). */
export function stability(runs: RunSummary[]): { cvNetProfit: number | null; allProfitable: boolean; message: string } {
  if (runs.length < 2) return { cvNetProfit: null, allProfitable: runs.every((r) => r.metrics.netProfit > 0), message: 'Import at least two runs with neighbouring parameters to assess stability.' };
  const nets = runs.map((r) => r.metrics.netProfit);
  const m = mean(nets);
  const sd = Math.sqrt(nets.reduce((a, x) => a + (x - m) ** 2, 0) / (nets.length - 1));
  const cv = m !== 0 ? Math.abs(sd / m) : null;
  const allProfitable = nets.every((x) => x > 0);
  return {
    cvNetProfit: cv,
    allProfitable,
    message: cv === null ? 'Mean net profit is zero.' : cv > 1 ? `Results swing strongly between runs (CV ${cv.toFixed(2)}) — parameters look fragile.` : `Coefficient of variation ${cv.toFixed(2)} across ${runs.length} runs${allProfitable ? '; all runs profitable' : '; some runs lose money'}.`,
  };
}
