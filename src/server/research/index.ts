// Market research engine: pulls public news feeds, the macro calendar, sentiment gauges and daily
// prices, then builds a report. Every number comes from a fetched source; failures are reported.
import { XMLParser } from 'fast-xml-parser';
import { analyzeRegime, blackoutWindow, dedupe, tone, topicStats, topicsOf, type Bar, type CalendarEvent, type NewsItem, type RegimeResult, type TopicStat } from '../../core/research';
import { TEMPLATES } from '../../core/templates';
import type { LlmProvider } from '../llm';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export interface FeedSource {
  id: string;
  name: string;
  category: string;
  url: string;
  deepOnly?: boolean;
}

export const FEEDS: FeedSource[] = [
  { id: 'cnbc-top', name: 'CNBC Top News', category: 'Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
  { id: 'cnbc-econ', name: 'CNBC Economy', category: 'Macro', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
  { id: 'cnbc-invest', name: 'CNBC Investing', category: 'Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069' },
  { id: 'mw-top', name: 'MarketWatch Top Stories', category: 'Markets', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { id: 'mw-pulse', name: 'MarketWatch Market Pulse', category: 'Markets', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
  { id: 'investing', name: 'Investing.com News', category: 'Markets', url: 'https://www.investing.com/rss/news.rss' },
  { id: 'fxstreet', name: 'FXStreet', category: 'FX & metals', url: 'https://www.fxstreet.com/rss/news' },
  { id: 'coindesk', name: 'CoinDesk', category: 'Crypto', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', name: 'Cointelegraph', category: 'Crypto', url: 'https://cointelegraph.com/rss' },
  { id: 'fed', name: 'Federal Reserve press releases', category: 'Central banks', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { id: 'ecb', name: 'ECB press', category: 'Central banks', url: 'https://www.ecb.europa.eu/rss/press.html' },
  { id: 'boe', name: 'Bank of England news', category: 'Central banks', url: 'https://www.bankofengland.co.uk/rss/news' },
  { id: 'ft-markets', name: 'Financial Times Markets', category: 'Markets', url: 'https://www.ft.com/markets?format=rss' },
  { id: 'bbc-business', name: 'BBC Business', category: 'Macro', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { id: 'seekingalpha', name: 'Seeking Alpha Market Currents', category: 'Equities', url: 'https://seekingalpha.com/market_currents.xml' },
  { id: 'sec', name: 'SEC press releases', category: 'Regulation', url: 'https://www.sec.gov/news/pressreleases.rss', deepOnly: true },
];

const DEEP_TOPIC_QUERIES = ['federal reserve interest rates', 'inflation CPI report', 'stock market today', 'oil prices OPEC', 'earnings season', 'geopolitical risk markets', 'trading strategy algorithmic trading'];

type Provider =
  | { kind: 'yahoo'; ticker: string; note?: string }
  | { kind: 'binance'; pair: string; note?: string }
  | { kind: 'frankfurter'; base: string; quote: string; note?: string }
  | { kind: 'twelvedata'; symbol: string; note?: string }; // used only when TWELVEDATA_API_KEY is set

export interface WatchItem {
  symbol: string;
  name: string;
  query: string;
  periodsPerYear?: number;
  providers: Provider[];
}

export const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: 'XAUUSD', name: 'Gold', query: 'gold price', providers: [{ kind: 'yahoo', ticker: 'GC=F', note: 'COMEX gold futures' }, { kind: 'binance', pair: 'PAXGUSDT', note: 'PAX Gold token — gold-backed proxy' }] },
  { symbol: 'EURUSD', name: 'EUR/USD', query: 'EUR/USD euro dollar', providers: [{ kind: 'frankfurter', base: 'EUR', quote: 'USD', note: 'ECB daily reference rate' }, { kind: 'yahoo', ticker: 'EURUSD=X' }] },
  { symbol: 'GBPUSD', name: 'GBP/USD', query: 'pound sterling GBP/USD', providers: [{ kind: 'frankfurter', base: 'GBP', quote: 'USD', note: 'ECB daily reference rate (cross)' }, { kind: 'yahoo', ticker: 'GBPUSD=X' }] },
  { symbol: 'USDJPY', name: 'USD/JPY', query: 'USD/JPY yen', providers: [{ kind: 'frankfurter', base: 'USD', quote: 'JPY', note: 'ECB daily reference rate (cross)' }, { kind: 'yahoo', ticker: 'JPY=X' }] },
  { symbol: 'BTCUSD', name: 'Bitcoin', query: 'bitcoin price', periodsPerYear: 365, providers: [{ kind: 'binance', pair: 'BTCUSDT', note: 'Binance BTC/USDT' }, { kind: 'yahoo', ticker: 'BTC-USD' }] },
  { symbol: 'ETHUSD', name: 'Ethereum', query: 'ethereum price', periodsPerYear: 365, providers: [{ kind: 'binance', pair: 'ETHUSDT', note: 'Binance ETH/USDT' }, { kind: 'yahoo', ticker: 'ETH-USD' }] },
  { symbol: 'SPX', name: 'S&P 500', query: 'S&P 500 stock market', providers: [{ kind: 'yahoo', ticker: '^GSPC' }, { kind: 'twelvedata', symbol: 'SPY', note: 'SPY ETF (S&P 500 proxy)' }] },
  { symbol: 'NDX', name: 'Nasdaq 100', query: 'Nasdaq 100 tech stocks', providers: [{ kind: 'yahoo', ticker: '^NDX' }, { kind: 'twelvedata', symbol: 'QQQ', note: 'QQQ ETF (Nasdaq 100 proxy)' }] },
  { symbol: 'DXY', name: 'US Dollar Index', query: 'US dollar index DXY', providers: [{ kind: 'yahoo', ticker: 'DX-Y.NYB' }, { kind: 'twelvedata', symbol: 'UUP', note: 'UUP ETF (dollar proxy)' }] },
  { symbol: 'WTI', name: 'WTI Crude', query: 'crude oil price', providers: [{ kind: 'yahoo', ticker: 'CL=F' }, { kind: 'twelvedata', symbol: 'USO', note: 'USO ETF (oil proxy, roll-affected)' }] },
  { symbol: 'VIX', name: 'VIX', query: 'VIX volatility index', providers: [{ kind: 'yahoo', ticker: '^VIX' }] },
  { symbol: 'US10Y', name: 'US 10Y yield', query: '10-year Treasury yield', providers: [{ kind: 'yahoo', ticker: '^TNX' }] },
];

async function fetchText(url: string, timeoutMs = 12000, retries = 1): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.text();
  } catch (e) {
    const status = (e as { status?: number }).status;
    // Retry once on network errors and 5xx; never hammer a 429/403.
    if (retries > 0 && (status === undefined || status >= 500)) {
      await new Promise((r) => setTimeout(r, 800));
      return fetchText(url, timeoutMs, retries - 1);
    }
    throw e;
  }
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const text = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && '#text' in (v as any) ? String((v as any)['#text']) : v === undefined || v === null ? '' : String(v));
const strip = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function parseFeed(body: string, source: string, category: string): NewsItem[] {
  const doc = xml.parse(body);
  const items: any[] = [].concat(doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.['rdf:RDF']?.item ?? []);
  return items
    .map((it) => {
      const link = typeof it.link === 'string' ? it.link : Array.isArray(it.link) ? it.link[0]?.['@_href'] ?? text(it.link[0]) : it.link?.['@_href'] ?? text(it.link);
      const date = text(it.pubDate ?? it.published ?? it.updated ?? it['dc:date']);
      const t = Date.parse(date);
      const srcName = it.source ? text(it.source) : '';
      return {
        title: strip(text(it.title)),
        link: String(link ?? ''),
        source: srcName ? `${srcName} (via ${source})` : source,
        category,
        published: Number.isFinite(t) ? t : null,
        summary: strip(text(it.description ?? it.summary ?? '')).slice(0, 280),
      } satisfies NewsItem;
    })
    .filter((x) => x.title && x.link);
}

function googleNewsUrl(q: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchBars(p: Provider): Promise<Bar[]> {
  if (p.kind === 'binance') {
    const j = (await JSON.parse(await fetchText(`https://data-api.binance.vision/api/v3/klines?symbol=${p.pair}&interval=1d&limit=400`))) as any[];
    return j.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
  }
  if (p.kind === 'frankfurter') {
    const start = new Date(Date.now() - 420 * 86400000).toISOString().slice(0, 10);
    const j = JSON.parse(await fetchText(`https://api.frankfurter.dev/v1/${start}..?base=${p.base}&symbols=${p.quote}`)) as { rates: Record<string, Record<string, number>> };
    return Object.entries(j.rates)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => {
        const c = v[p.quote];
        return { t: Date.parse(d), o: c, h: c, l: c, c };
      });
  }
  if (p.kind === 'twelvedata') {
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) throw new Error('TWELVEDATA_API_KEY not set');
    const j = JSON.parse(await fetchText(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(p.symbol)}&interval=1day&outputsize=400&apikey=${key}`)) as any;
    if (!Array.isArray(j.values)) throw new Error(j.message ?? 'no data');
    return (j.values as any[]).map((v) => ({ t: Date.parse(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).reverse();
  }
  let lastErr: unknown;
  for (const host of ['query1', 'query2']) {
    try {
      const j = JSON.parse(await fetchText(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.ticker)}?range=2y&interval=1d`)) as any;
      const r = j.chart?.result?.[0];
      if (!r) throw new Error('no data');
      const q = r.indicators.quote[0];
      return (r.timestamp as number[])
        .map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
        .filter((b) => Number.isFinite(b.c));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export interface MarketSnapshot {
  symbol: string;
  name: string;
  ok: boolean;
  provider?: string;
  providerNote?: string;
  error?: string;
  regime?: RegimeResult;
  closes?: number[];
}

async function snapshot(w: WatchItem): Promise<MarketSnapshot> {
  const errors: string[] = [];
  for (const p of w.providers) {
    try {
      const bars = await fetchBars(p);
      if (bars.length < 30) throw new Error(`only ${bars.length} bars`);
      const label = p.kind === 'yahoo' ? `Yahoo Finance ${p.ticker}` : p.kind === 'binance' ? `Binance ${p.pair}` : p.kind === 'twelvedata' ? `Twelve Data ${p.symbol}` : `Frankfurter ${p.base}/${p.quote}`;
      return { symbol: w.symbol, name: w.name, ok: true, provider: label, providerNote: p.note, regime: analyzeRegime(bars, w.periodsPerYear ?? 252), closes: bars.slice(-90).map((b) => b.c) };
    } catch (e) {
      errors.push(`${p.kind}: ${(e as Error).message}`);
    }
  }
  return { symbol: w.symbol, name: w.name, ok: false, error: errors.join('; ') };
}

export interface SourceStatus {
  id: string;
  name: string;
  category: string;
  url: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface ResearchReport {
  createdAt: string;
  durationMs: number;
  mode: 'quick' | 'deep';
  sources: SourceStatus[];
  markets: MarketSnapshot[];
  news: NewsItem[];
  newsByAsset: Record<string, NewsItem[]>;
  topics: TopicStat[];
  overallTone: number | null;
  calendar: { events: CalendarEvent[]; blackouts: { session: string; timezone: string; label: string; time: number }[] } | null;
  cryptoFearGreed: { value: number; label: string; history: number[] } | null;
  strategyIdeas: { symbol: string; regime: string; templates: { id: string; name: string }[] }[];
  briefing: { source: 'llm' | 'rules'; model?: string; markdown: string; error?: string };
  disclaimers: string[];
}

export async function runResearch(opts: { mode: 'quick' | 'deep'; watchlist?: WatchItem[]; previousTopics?: Record<string, number>; llm?: LlmProvider }): Promise<ResearchReport> {
  const t0 = Date.now();
  const watch = opts.watchlist?.length ? opts.watchlist : DEFAULT_WATCHLIST;
  const deep = opts.mode === 'deep';
  const sources: SourceStatus[] = [];

  const feedJobs: { src: FeedSource; promise: Promise<NewsItem[]> }[] = [];
  for (const f of FEEDS.filter((x) => deep || !x.deepOnly)) feedJobs.push({ src: f, promise: fetchText(f.url).then((b) => parseFeed(b, f.name, f.category)) });
  const assetQueries = watch.map((w) => ({ src: { id: `gn-${w.symbol}`, name: `Google News: ${w.query}`, category: 'Per-asset news', url: googleNewsUrl(w.query) }, symbol: w.symbol }));
  for (const q of assetQueries) feedJobs.push({ src: q.src, promise: fetchText(q.src.url).then((b) => parseFeed(b, 'Google News', `Asset: ${q.symbol}`)) });
  if (deep) for (const q of DEEP_TOPIC_QUERIES) {
    const src = { id: `gn-${q}`, name: `Google News: ${q}`, category: 'Topic search', url: googleNewsUrl(q) };
    feedJobs.push({ src, promise: fetchText(src.url).then((b) => parseFeed(b, 'Google News', 'Topic search')) });
  }

  const calendarP = fetchText('https://nfs.faireconomy.media/ff_calendar_thisweek.json').then((b) => JSON.parse(b) as any[]);
  const fngP = fetchText('https://api.alternative.me/fng/?limit=30').then((b) => JSON.parse(b) as any);
  const marketsP = Promise.all(watch.map(snapshot));

  const feedResults = await Promise.allSettled(feedJobs.map((j) => j.promise));
  const all: NewsItem[] = [];
  const byAsset: Record<string, NewsItem[]> = {};
  feedResults.forEach((r, i) => {
    const { src } = feedJobs[i];
    if (r.status === 'fulfilled') {
      sources.push({ ...src, ok: true, count: r.value.length });
      const items = r.value.slice(0, deep ? 60 : 30);
      all.push(...items);
      const asset = assetQueries.find((q) => q.src.id === src.id);
      if (asset) byAsset[asset.symbol] = dedupe(items).slice(0, 8);
    } else sources.push({ ...src, ok: false, count: 0, error: (r.reason as Error)?.message ?? String(r.reason) });
  });
  const weekAgo = Date.now() - 7 * 86400000;
  const news = dedupe(all.filter((n) => n.published === null || n.published >= weekAgo)).slice(0, deep ? 300 : 150);
  const topics = topicStats(news, opts.previousTopics);
  const tones = news.map((n) => tone(`${n.title} ${n.summary ?? ''}`)).filter((x) => x !== 0);
  const overallTone = tones.length ? tones.reduce((a, b) => a + b, 0) / tones.length : null;

  let calendar: ResearchReport['calendar'] = null;
  try {
    const raw = await calendarP;
    const events: CalendarEvent[] = raw
      .map((e) => ({ title: String(e.title), country: String(e.country), time: Date.parse(e.date), impact: String(e.impact), forecast: e.forecast || undefined, previous: e.previous || undefined }))
      .filter((e) => Number.isFinite(e.time))
      .sort((a, b) => a.time - b.time);
    const upcoming = events.filter((e) => e.time >= Date.now() - 3600000);
    calendar = {
      events: upcoming.filter((e) => e.impact === 'High' || e.impact === 'Medium'),
      blackouts: upcoming.filter((e) => e.impact === 'High').map((e) => ({ ...blackoutWindow(e), time: e.time })),
    };
    sources.push({ id: 'ff-calendar', name: 'Forex Factory weekly calendar', category: 'Calendar', url: 'https://www.forexfactory.com/calendar', ok: true, count: events.length });
  } catch (e) {
    sources.push({ id: 'ff-calendar', name: 'Forex Factory weekly calendar', category: 'Calendar', url: 'https://www.forexfactory.com/calendar', ok: false, count: 0, error: (e as Error).message });
  }

  let cryptoFearGreed: ResearchReport['cryptoFearGreed'] = null;
  try {
    const j = await fngP;
    const d = j.data as { value: string; value_classification: string }[];
    cryptoFearGreed = { value: Number(d[0].value), label: d[0].value_classification, history: d.map((x) => Number(x.value)).reverse() };
    sources.push({ id: 'fng', name: 'Crypto Fear & Greed (alternative.me)', category: 'Sentiment', url: 'https://alternative.me/crypto/fear-and-greed-index/', ok: true, count: d.length });
  } catch (e) {
    sources.push({ id: 'fng', name: 'Crypto Fear & Greed (alternative.me)', category: 'Sentiment', url: 'https://alternative.me/crypto/fear-and-greed-index/', ok: false, count: 0, error: (e as Error).message });
  }

  const markets = await marketsP;
  for (const m of markets) sources.push({ id: `px-${m.symbol}`, name: `Prices: ${m.name}${m.provider ? ` (${m.provider})` : ''}`, category: 'Market data', url: '', ok: m.ok, count: m.closes?.length ?? 0, error: m.error });
  const tplName = (id: string) => TEMPLATES.find((t) => t.id === id)?.name ?? id;
  const strategyIdeas = markets
    .filter((m) => m.ok && m.regime && m.regime.regime !== 'Insufficient data' && !['VIX', 'US10Y', 'DXY'].includes(m.symbol))
    .map((m) => ({ symbol: m.symbol, regime: `${m.regime!.regime} · ${m.regime!.volatility} volatility`, templates: m.regime!.suggestedTemplates.slice(0, 3).map((id) => ({ id, name: tplName(id) })) }));

  const report: ResearchReport = {
    createdAt: new Date().toISOString(),
    durationMs: 0,
    mode: opts.mode,
    sources,
    markets,
    news,
    newsByAsset: byAsset,
    topics,
    overallTone,
    calendar,
    cryptoFearGreed,
    strategyIdeas,
    briefing: { source: 'rules', markdown: '' },
    disclaimers: [
      'Information only — not investment advice. No forecast of prices is made.',
      'Headline tone is a keyword-based proxy, not a validated sentiment model.',
      'Regimes describe recent price behaviour from daily data; they change and are not predictions.',
      'Gold history may come from a gold-backed token (PAXG) when futures data is unavailable — labelled per asset.',
      'Third-party feeds can be delayed, incomplete or unavailable; check the source status table.',
    ],
  };
  report.briefing = { source: 'rules', markdown: rulesBriefing(report) };
  if (opts.llm && opts.llm.status().configured) {
    try {
      report.briefing = { source: 'llm', model: opts.llm.status().model ?? undefined, markdown: await llmBriefing(report, opts.llm) };
    } catch (e) {
      report.briefing.error = `AI briefing failed (${(e as Error).message}); showing the rule-based briefing.`;
    }
  }
  report.durationMs = Date.now() - t0;
  return report;
}

const fmtPct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`);

export function rulesBriefing(r: ResearchReport): string {
  const lines: string[] = [];
  const ok = r.markets.filter((m) => m.ok && m.regime);
  if (ok.length) {
    lines.push('**Market regimes (daily data)**');
    for (const m of ok) lines.push(`- **${m.name}**: ${m.regime!.regime}, ${m.regime!.volatility.toLowerCase()} volatility — 1W ${fmtPct(m.regime!.change.w1)}, 1M ${fmtPct(m.regime!.change.m1)}.`);
  }
  const hot = r.topics.slice(0, 5);
  if (hot.length) {
    lines.push('', '**Most-covered themes this week**');
    for (const t of hot) lines.push(`- ${t.topic}: ${t.count} headlines${t.delta !== null ? ` (${t.delta >= 0 ? '+' : ''}${t.delta} vs last report)` : ''}, tone proxy ${t.tone >= 0.15 ? 'positive' : t.tone <= -0.15 ? 'negative' : 'mixed'}.`);
  }
  if (r.calendar?.events.length) {
    lines.push('', '**Upcoming high/medium-impact events**');
    for (const e of r.calendar.events.slice(0, 8)) lines.push(`- ${new Date(e.time).toUTCString().slice(0, 22)} UTC — ${e.country} ${e.title} (${e.impact}${e.forecast ? `, forecast ${e.forecast}` : ''}${e.previous ? `, previous ${e.previous}` : ''})`);
  }
  if (r.cryptoFearGreed) lines.push('', `**Crypto Fear & Greed**: ${r.cryptoFearGreed.value} (${r.cryptoFearGreed.label}).`);
  if (r.strategyIdeas.length) {
    lines.push('', '**Strategy families that fit current regimes (heuristic)**');
    for (const s of r.strategyIdeas) lines.push(`- ${s.symbol} (${s.regime}): ${s.templates.map((t) => t.name).join(', ')}`);
  }
  return lines.join('\n');
}

async function llmBriefing(r: ResearchReport, llm: LlmProvider): Promise<string> {
  const headlines = r.news.slice(0, 80).map((n, i) => `[${i + 1}] ${n.title} — ${n.source}${n.published ? `, ${new Date(n.published).toISOString().slice(0, 16)}Z` : ''}`);
  const markets = r.markets.filter((m) => m.ok && m.regime).map((m) => `${m.name}: ${m.regime!.regime}, vol ${m.regime!.volatility}, 1W ${fmtPct(m.regime!.change.w1)}, 1M ${fmtPct(m.regime!.change.m1)}, RSI14 ${m.regime!.rsi14?.toFixed(0) ?? '—'}`);
  const cal = (r.calendar?.events ?? []).slice(0, 15).map((e) => `${new Date(e.time).toISOString().slice(0, 16)}Z ${e.country} ${e.title} (${e.impact})`);
  const system =
    'You are a markets research assistant writing a briefing for a systematic trader. Use ONLY the data provided. Cite headlines with their [n] numbers. Do not predict prices, give buy/sell recommendations, or invent numbers. Flag uncertainty and conflicting information. Write concise Markdown with these sections: Overview, Key drivers (with citations), Asset-by-asset notes, Event risk this week, What to watch / how this affects strategy selection (refer to regimes; e.g. trend vs mean-reversion suitability, news blackout windows).';
  const user = `Report time: ${r.createdAt}\n\nMARKET REGIMES\n${markets.join('\n')}\n\nCALENDAR\n${cal.join('\n') || 'unavailable'}\n\nCRYPTO FEAR&GREED: ${r.cryptoFearGreed ? `${r.cryptoFearGreed.value} ${r.cryptoFearGreed.label}` : 'unavailable'}\n\nTOP THEMES: ${r.topics.slice(0, 8).map((t) => `${t.topic} (${t.count})`).join(', ')}\n\nHEADLINES\n${headlines.join('\n')}`;
  return llm.complete(system, user, 6000);
}

export function topicCounts(r: ResearchReport): Record<string, number> {
  return Object.fromEntries(r.topics.map((t) => [t.topic, t.count]));
}

export { topicsOf };
