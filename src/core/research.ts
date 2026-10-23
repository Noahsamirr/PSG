// Pure analysis used by the Market Research report: regime metrics from real price history,
// headline topics, a lexicon-based tone PROXY, de-duplication and trend deltas.
// Nothing here forecasts prices; outputs are descriptive and labelled as heuristics.

export interface Bar {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  category: string;
  published: number | null;
  summary?: string;
}

export interface RegimeResult {
  last: number;
  lastTime: number;
  change: { d1: number | null; w1: number | null; m1: number | null; m3: number | null };
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  efficiency20: number | null;
  rsi14: number | null;
  vol20Ann: number | null;
  volPercentile: number | null;
  regime: 'Uptrend' | 'Downtrend' | 'Range' | 'Transition' | 'Insufficient data';
  volatility: 'High' | 'Normal' | 'Compressed' | 'Unknown';
  suggestedTemplates: string[];
  rationale: string;
}

const pct = (a: number, b: number) => (100 * (a - b)) / b;

function sma(v: number[], n: number, end = v.length): number | null {
  if (end < n) return null;
  let s = 0;
  for (let i = end - n; i < end; i++) s += v[i];
  return s / n;
}

function rsi(v: number[], n = 14): number | null {
  if (v.length <= n) return null;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function stdev(a: number[]): number {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1));
}

export function analyzeRegime(bars: Bar[], periodsPerYear = 252): RegimeResult {
  const c = bars.map((b) => b.c);
  const n = c.length;
  const back = (k: number) => (n > k ? pct(c[n - 1], c[n - 1 - k]) : null);
  const base: RegimeResult = {
    last: c[n - 1] ?? NaN,
    lastTime: bars[n - 1]?.t ?? 0,
    change: { d1: back(1), w1: back(5), m1: back(21), m3: back(63) },
    aboveSma50: null,
    aboveSma200: null,
    efficiency20: null,
    rsi14: rsi(c),
    vol20Ann: null,
    volPercentile: null,
    regime: 'Insufficient data',
    volatility: 'Unknown',
    suggestedTemplates: [],
    rationale: 'Not enough history (need ≥ 60 daily bars).',
  };
  if (n < 60) return base;
  const s50 = sma(c, 50)!;
  const s200 = sma(c, 200);
  const s50prev = sma(c, 50, n - 10)!;
  const net = Math.abs(c[n - 1] - c[n - 21]);
  let path = 0;
  for (let i = n - 20; i < n; i++) path += Math.abs(c[i] - c[i - 1]);
  const er = path > 0 ? net / path : 0;
  const rets = c.slice(1).map((x, i) => Math.log(x / c[i]));
  const vol = (r: number[]) => stdev(r) * Math.sqrt(periodsPerYear) * 100;
  const cur = vol(rets.slice(-20));
  const hist: number[] = [];
  for (let i = 20; i <= rets.length; i += 5) hist.push(vol(rets.slice(i - 20, i)));
  const vp = hist.length > 5 ? (100 * hist.filter((x) => x <= cur).length) / hist.length : null;
  const up = c[n - 1] > s50 && s50 > s50prev && (s200 === null || s50 > s200);
  const down = c[n - 1] < s50 && s50 < s50prev && (s200 === null || s50 < s200);
  const regime: RegimeResult['regime'] = er >= 0.3 && up ? 'Uptrend' : er >= 0.3 && down ? 'Downtrend' : er < 0.2 ? 'Range' : 'Transition';
  const volatility: RegimeResult['volatility'] = vp === null ? 'Unknown' : vp >= 80 ? 'High' : vp <= 20 ? 'Compressed' : 'Normal';
  const suggest: string[] =
    regime === 'Uptrend' || regime === 'Downtrend'
      ? ['mtf_pullback', 'supertrend_trend', 'ema_trend', 'donchian_turtle']
      : regime === 'Range'
        ? ['bb_meanrev', 'sr_bounce', 'rsi2_meanrev']
        : ['donchian_retest', 'smc_sweep_fvg'];
  if (volatility === 'Compressed') suggest.unshift('squeeze_breakout');
  const rationale = [
    `Efficiency ratio ${er.toFixed(2)} (${er >= 0.3 ? 'directional' : er < 0.2 ? 'choppy' : 'mixed'})`,
    `price ${c[n - 1] > s50 ? 'above' : 'below'} the 50-bar average${s200 !== null ? ` and ${c[n - 1] > s200 ? 'above' : 'below'} the 200-bar average` : ''}`,
    `20-bar realised volatility ${cur.toFixed(1)}% annualised${vp !== null ? ` (${vp.toFixed(0)}th percentile of the past year)` : ''}`,
  ].join('; ');
  return {
    ...base,
    aboveSma50: c[n - 1] > s50,
    aboveSma200: s200 === null ? null : c[n - 1] > s200,
    efficiency20: er,
    vol20Ann: cur,
    volPercentile: vp,
    regime,
    volatility,
    suggestedTemplates: suggest,
    rationale: `${rationale}. Heuristic description of recent behaviour — not a forecast.`,
  };
}

export const TOPICS: Record<string, RegExp> = {
  'Central banks & rates': /\b(fed|fomc|powell|ecb|lagarde|boj|boe|central bank|rate (cut|hike|decision)|interest rates?|monetary policy)\b/i,
  Inflation: /\b(inflation|cpi|pce|ppi|prices? index|disinflation)\b/i,
  'Jobs & labour': /\b(payrolls?|nfp|jobless|unemployment|labou?r market|jobs report|hiring)\b/i,
  'Growth & recession': /\b(gdp|pmi|recession|slowdown|economic growth|retail sales|consumer spending)\b/i,
  Earnings: /\b(earnings|quarterly results|revenue|guidance|eps|profit (warning|forecast))\b/i,
  Geopolitics: /\b(war|sanctions?|tariffs?|election|geopolitic|conflict|ceasefire|trade (deal|war))\b/i,
  'Energy & oil': /\b(oil|crude|opec|brent|wti|natural gas|lng)\b/i,
  'Gold & metals': /\b(gold|silver|bullion|precious metals?|copper)\b/i,
  Crypto: /\b(bitcoin|btc|crypto|ether(eum)?|stablecoin|blockchain|solana)\b/i,
  'Tech & AI': /\b(ai|artificial intelligence|nvidia|semiconductor|chips?|big tech|software)\b/i,
  'Bonds & yields': /\b(treasur(y|ies)|bond yields?|yields?|gilts?|bunds?|10-year)\b/i,
  'FX & dollar': /\b(dollar|euro|yen|sterling|pound|forex|currenc(y|ies)|usd)\b/i,
  'Regulation & legal': /\b(sec|regulat(or|ion|ory)|lawsuit|antitrust|probe|fine[ds]?)\b/i,
  'Equities & indices': /\b(stocks?|s&p|nasdaq|dow|equities|shares|wall street|index)\b/i,
};

const POS = /\b(surge[sd]?|rall(y|ies|ied)|gains?|gained|rises?|rose|jumps?|jumped|beats?|record high|soars?|soared|bullish|upgraded?|strong(er)?|rebounds?|rebounded|recover(y|s|ed)|optimism|boost(s|ed)?|tops? estimates|eases? (fears|concerns))\b/gi;
const NEG = /\b(falls?|fell|drops?|dropped|slumps?|slumped|plunges?|plunged|miss(es|ed)?|recession|fears?|bearish|downgraded?|weak(er|ness)?|crash(es|ed)?|sell-?off|tumbles?|tumbled|slides?|slid|losses|warns?|warning|turmoil|default|layoffs?|cuts? (jobs|forecast)|probe)\b/gi;

export function tone(text: string): number {
  const p = (text.match(POS) ?? []).length;
  const n = (text.match(NEG) ?? []).length;
  return p + n === 0 ? 0 : (p - n) / (p + n);
}

export function topicsOf(text: string): string[] {
  return Object.entries(TOPICS)
    .filter(([, re]) => re.test(text))
    .map(([k]) => k);
}

export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\s+-\s+[^-]+$/, '') // Google News "Title - Publisher"
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Map<string, NewsItem>();
  for (const it of items) {
    const key = normalizeTitle(it.title).split(' ').slice(0, 10).join(' ');
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev || (it.published ?? 0) > (prev.published ?? 0)) seen.set(key, it);
  }
  return [...seen.values()].sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
}

export interface TopicStat {
  topic: string;
  count: number;
  tone: number; // mean tone proxy -1..1
  previous: number | null;
  delta: number | null;
}

export function topicStats(items: NewsItem[], previous?: Record<string, number>): TopicStat[] {
  const acc = new Map<string, { n: number; t: number }>();
  for (const it of items) {
    const text = `${it.title} ${it.summary ?? ''}`;
    for (const tp of topicsOf(text)) {
      const a = acc.get(tp) ?? { n: 0, t: 0 };
      a.n++;
      a.t += tone(text);
      acc.set(tp, a);
    }
  }
  return [...acc.entries()]
    .map(([topic, a]) => ({
      topic,
      count: a.n,
      tone: a.t / a.n,
      previous: previous ? previous[topic] ?? 0 : null,
      delta: previous ? a.n - (previous[topic] ?? 0) : null,
    }))
    .sort((x, y) => y.count - x.count);
}

export interface CalendarEvent {
  title: string;
  country: string;
  time: number;
  impact: string;
  forecast?: string;
  previous?: string;
}

/** Suggest a "news blackout" window (±minutes around the event) in New York time for the generator's filter. */
export function blackoutWindow(ev: CalendarEvent, minutes = 15): { session: string; timezone: string; label: string } {
  const fmt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const h = parts.find((p) => p.type === 'hour')!.value.padStart(2, '0');
    const m = parts.find((p) => p.type === 'minute')!.value.padStart(2, '0');
    return `${h}${m}`;
  };
  return { session: `${fmt(ev.time - minutes * 60_000)}-${fmt(ev.time + minutes * 60_000)}`, timezone: 'America/New_York', label: `${ev.country} ${ev.title}` };
}

export const COUNTRY_TO_ASSETS: Record<string, string[]> = {
  USD: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'SPX', 'NDX', 'BTCUSD', 'DXY', 'US10Y'],
  EUR: ['EURUSD'],
  GBP: ['GBPUSD'],
  JPY: ['USDJPY'],
  CNY: ['XAUUSD', 'WTI'],
  ALL: [],
};
