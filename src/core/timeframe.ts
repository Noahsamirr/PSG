// Timeframe helpers (TradingView format: "1", "5", "15", "60", "240", "1D", "1W", "1M").

export const TF_LADDER = ['1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W'];

export function tfMinutes(tf: string): number | null {
  const m = /^(\d*)([SDWM]?)$/i.exec(tf.trim());
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  const u = m[2].toUpperCase();
  return u === '' ? n : u === 'S' ? n / 60 : u === 'D' ? n * 1440 : u === 'W' ? n * 10080 : n * 43200;
}

/** Human label: "15" → "15m", "60" → "1H", "240" → "4H", "1D" → "1D". */
export function tfLabel(tf: string): string {
  const min = tfMinutes(tf);
  if (min === null) return tf;
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min}m`;
  if (min < 1440 && min % 60 === 0) return `${min / 60}H`;
  if (min % 10080 === 0 && min >= 10080) return `${min / 10080}W`;
  if (min % 1440 === 0) return `${min / 1440}D`;
  return `${min}m`;
}

export function tfInRange(tf: string, range: [string, string]): boolean | null {
  const t = tfMinutes(tf);
  const lo = tfMinutes(range[0]);
  const hi = tfMinutes(range[1]);
  if (t === null || lo === null || hi === null) return null;
  return t >= lo && t <= hi;
}

export function rangeLabel(range: [string, string]): string {
  return range[0] === range[1] ? tfLabel(range[0]) : `${tfLabel(range[0])}–${tfLabel(range[1])}`;
}

export interface TimeframeChoice {
  timeframe: string;
  range: [string, string];
  outside: string[]; // names of strategies whose designed range excludes the choice
  note: string;
}

/**
 * Chooses a chart timeframe for several strategies: the shared range if one exists,
 * otherwise the contiguous ladder band accepted by the most strategies.
 */
export function pickSharedTimeframe(items: { name: string; range: [string, string]; preferred?: string }[]): TimeframeChoice {
  const counts = TF_LADDER.map((tf) => items.filter((i) => tfInRange(tf, i.range)).length);
  const best = Math.max(...counts);
  const idx = counts.map((c, i) => (c === best ? i : -1)).filter((i) => i >= 0);
  // Longest contiguous run of best-count timeframes.
  let run: number[] = [];
  let cur: number[] = [];
  for (const i of idx) {
    cur = cur.length && i === cur[cur.length - 1] + 1 ? [...cur, i] : [i];
    if (cur.length > run.length) run = cur;
  }
  const range: [string, string] = [TF_LADDER[run[0]], TF_LADDER[run[run.length - 1]]];
  const prefs = items.map((i) => i.preferred).filter((p): p is string => !!p && tfInRange(p, range) === true);
  const tally = new Map<string, number>();
  prefs.forEach((p) => tally.set(p, (tally.get(p) ?? 0) + 1));
  const timeframe = [...tally.entries()].sort((a, b) => b[1] - a[1] || (tfMinutes(b[0])! - tfMinutes(a[0])!))[0]?.[0] ?? TF_LADDER[run[Math.floor(run.length / 2)]];
  const outside = items.filter((i) => tfInRange(timeframe, i.range) === false).map((i) => i.name);
  const alternatives = idx.map((i) => TF_LADDER[i]).filter((t) => tfInRange(t, range) === false).map(tfLabel);
  const note = outside.length
    ? `No single timeframe suits every strategy. ${tfLabel(timeframe)} (range ${rangeLabel(range)}) suits ${best} of ${items.length}${alternatives.length ? ` (so does ${alternatives.join(', ')})` : ''}; outside their designed range: ${outside.join(', ')}.`
    : `All ${items.length} strategies are designed for ${rangeLabel(range)}; recommended chart ${tfLabel(timeframe)}.`;
  return { timeframe, range, outside, note };
}
