// Searchable instrument catalog. Binance spot and USDT-margined futures are discovered live from their public
// exchangeInfo endpoints (crypto, plus Binance "TradFi" perpetuals on metals, energy, US stocks and ETFs).
// FX, indices, CME futures and ETFs come from a curated list served by Yahoo Finance (delayed) or Twelve Data (key).
// Different gold instruments are kept separate — a perpetual, a token, a future and an ETF are not interchangeable.
import type { SourceKind } from './candles';
import { instrumentOf } from './candles';

export interface Instrument {
  /** Unique key: `${source}:${ticker}`. */
  id: string;
  source: SourceKind;
  ticker: string;
  name: string;
  assetClass: 'metals' | 'crypto' | 'forex' | 'stocks' | 'indices' | 'commodities' | 'etf';
  kind: string;
  quoteCurrency: string;
  provider: string;
  session: string;
  realtime: boolean;
  needsKey?: boolean;
}

const YAHOO = 'Yahoo Finance (unofficial chart API)';
const BINANCE_S = 'Binance spot public market data';
const BINANCE_F = 'Binance USDⓈ-M futures public market data';
const CRYPTO_SESSION = '24/7';
const CME = 'CME Globex: Sun–Fri ~22:00/23:00–21:00/22:00 UTC with a daily 1-hour break (delayed via Yahoo)';

function curated(source: SourceKind, ticker: string, name: string, assetClass: Instrument['assetClass'], quoteCurrency: string, session: string, extra: Partial<Instrument> = {}): Instrument {
  return {
    id: `${source}:${ticker}`,
    source,
    ticker,
    name,
    assetClass,
    kind: instrumentOf(source, ticker),
    quoteCurrency,
    provider: source === 'yahoo' ? YAHOO : source === 'twelvedata' ? 'Twelve Data (API key)' : source === 'binance' ? BINANCE_S : BINANCE_F,
    session,
    realtime: source === 'binance' || source === 'binancef',
    ...extra,
  };
}

const FX_SESSION = 'FX: Sun ~22:00 UTC – Fri ~22:00 UTC';
const US_SESSION = 'NYSE/Nasdaq: Mon–Fri 13:30–20:00 UTC (14:30–21:00 in winter), delayed';

export const CURATED: Instrument[] = [
  curated('binancef', 'XAUUSDT', 'Gold perpetual (USDT-margined)', 'metals', 'USDT', 'See Binance TradFi trading hours; data status shows when the market is closed'),
  curated('binance', 'PAXGUSDT', 'PAX Gold token (1 token ≈ 1 troy oz, gold-backed)', 'metals', 'USDT', CRYPTO_SESSION),
  curated('binance', 'XAUTUSDT', 'Tether Gold token (gold-backed)', 'metals', 'USDT', CRYPTO_SESSION),
  curated('yahoo', 'GC=F', 'COMEX gold futures, continuous front month', 'metals', 'USD', CME),
  curated('yahoo', 'GLD', 'SPDR Gold Shares ETF', 'etf', 'USD', US_SESSION),
  curated('twelvedata', 'XAU/USD', 'Gold spot (OTC)', 'metals', 'USD', 'OTC: Sun–Fri, provider dependent', { needsKey: true }),
  curated('yahoo', 'SI=F', 'COMEX silver futures, continuous front month', 'metals', 'USD', CME),
  curated('yahoo', 'EURUSD=X', 'Euro / US dollar', 'forex', 'USD', FX_SESSION),
  curated('yahoo', 'GBPUSD=X', 'British pound / US dollar', 'forex', 'USD', FX_SESSION),
  curated('yahoo', 'USDJPY=X', 'US dollar / Japanese yen', 'forex', 'JPY', FX_SESSION),
  curated('yahoo', 'AUDUSD=X', 'Australian dollar / US dollar', 'forex', 'USD', FX_SESSION),
  curated('yahoo', 'USDCHF=X', 'US dollar / Swiss franc', 'forex', 'CHF', FX_SESSION),
  curated('yahoo', 'USDCAD=X', 'US dollar / Canadian dollar', 'forex', 'CAD', FX_SESSION),
  curated('yahoo', '^GSPC', 'S&P 500 index', 'indices', 'USD', US_SESSION),
  curated('yahoo', '^NDX', 'Nasdaq 100 index', 'indices', 'USD', US_SESSION),
  curated('yahoo', '^DJI', 'Dow Jones Industrial Average', 'indices', 'USD', US_SESSION),
  curated('yahoo', '^GDAXI', 'DAX 40 index', 'indices', 'EUR', 'Xetra: Mon–Fri 07:00–15:30 UTC (winter 08:00–16:30), delayed'),
  curated('yahoo', 'CL=F', 'WTI crude oil futures, continuous front month', 'commodities', 'USD', CME),
  curated('yahoo', 'DX-Y.NYB', 'US Dollar Index', 'indices', 'USD', 'ICE: near 24h Mon–Fri, delayed'),
];

const SYNONYMS: [RegExp, string[]][] = [
  [/^gold|^xau|^gc\b/i, ['XAU', 'PAXG', 'XAUT', 'GC=F', 'GLD']],
  [/^silver|^xag/i, ['XAG', 'SI=F']],
  [/^(oil|crude|wti)/i, ['CL', 'BZ']],
  [/^bitcoin/i, ['BTC']],
  [/^ether/i, ['ETH']],
  [/^(s&?p|spx|us500)/i, ['^GSPC', 'SPY']],
  [/^(nasdaq|ndx|nas100|us100)/i, ['^NDX', 'QQQ']],
];

let cache: { at: number; list: Instrument[]; errors: string[] } | null = null;
let loading: Promise<{ list: Instrument[]; errors: string[] }> | null = null;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const FUT_CLASS: Record<string, Instrument['assetClass']> = { COMMODITY: 'commodities', EQUITY: 'stocks', HK_EQUITY: 'stocks', KR_EQUITY: 'stocks', CN_EQUITY: 'stocks', FX: 'forex', INDEX: 'indices', COIN: 'crypto' };

/** Live catalog (cached 6 hours). Falls back to the curated list, reporting why, if Binance is unreachable. */
export async function loadCatalog(): Promise<{ list: Instrument[]; errors: string[] }> {
  if (cache && Date.now() - cache.at < 6 * 3600_000) return cache;
  if (loading) return loading;
  loading = (async () => {
    const errors: string[] = [];
    const list: Instrument[] = [...CURATED];
    const seen = new Set(list.map((x) => x.id));
    const add = (x: Instrument) => !seen.has(x.id) && (seen.add(x.id), list.push(x));
    try {
      const f = await getJson('https://fapi.binance.com/fapi/v1/exchangeInfo');
      for (const s of f.symbols as any[]) {
        if (s.status !== 'TRADING' || !/PERPETUAL/.test(s.contractType) || s.quoteAsset !== 'USDT') continue;
        const tradfi = s.contractType === 'TRADIFI_PERPETUAL';
        const cls = /^X(AU|AG|PT|PD)USDT$/.test(s.symbol) ? 'metals' : (FUT_CLASS[s.underlyingType] ?? 'crypto');
        add({
          id: `binancef:${s.symbol}`,
          source: 'binancef',
          ticker: s.symbol,
          name: `${s.baseAsset} perpetual${tradfi ? ' (TradFi)' : ''}`,
          assetClass: cls,
          kind: instrumentOf('binancef', s.symbol),
          quoteCurrency: 'USDT',
          provider: BINANCE_F,
          session: tradfi ? 'Binance TradFi perpetual — see Binance for trading hours' : CRYPTO_SESSION,
          realtime: true,
        });
      }
    } catch (e) {
      errors.push(`Binance futures catalog: ${(e as Error).message}`);
    }
    try {
      const sp = await getJson('https://data-api.binance.vision/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false');
      for (const s of sp.symbols as any[]) {
        if (!['USDT', 'USDC', 'FDUSD', 'BTC', 'EUR'].includes(s.quoteAsset)) continue;
        const gold = /^(PAXG|XAUT)$/.test(s.baseAsset);
        add({
          id: `binance:${s.symbol}`,
          source: 'binance',
          ticker: s.symbol,
          name: `${s.baseAsset} / ${s.quoteAsset}`,
          assetClass: gold ? 'metals' : 'crypto',
          kind: instrumentOf('binance', s.symbol),
          quoteCurrency: s.quoteAsset,
          provider: BINANCE_S,
          session: CRYPTO_SESSION,
          realtime: true,
        });
      }
    } catch (e) {
      errors.push(`Binance spot catalog: ${(e as Error).message}`);
    }
    cache = { at: Date.now(), list, errors };
    return cache;
  })().finally(() => (loading = null));
  return loading;
}

/** Ranked search: exact ticker, then prefix, then name; gold-related names expand to every gold instrument. */
export function searchCatalog(list: Instrument[], q: string, limit = 30): Instrument[] {
  const query = q.trim();
  if (!query) return list.slice(0, CURATED.length);
  const up = query.toUpperCase().replace(/^[A-Z]+:/, '').replace(/[\s/_-]+/g, '');
  const syn = SYNONYMS.find(([re]) => re.test(query))?.[1] ?? [];
  const score = (x: Instrument) => {
    const t = x.ticker.toUpperCase().replace(/[/_-]/g, '');
    let s = 0;
    if (t === up || t === `${up}USDT`) s = 100;
    else if (t.startsWith(up)) s = 60 - Math.min(20, t.length - up.length);
    else if (syn.some((p) => t.startsWith(p.toUpperCase().replace(/[/_-]/g, '')))) s = 55;
    else if (x.name.toUpperCase().includes(query.toUpperCase())) s = 30;
    if (!s) return 0;
    if (x.quoteCurrency === 'USDT' || x.quoteCurrency === 'USD') s += 5;
    if (CURATED.includes(x)) s += 8;
    return s;
  };
  return list
    .map((x) => [x, score(x)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([x]) => x);
}

export function findInstrument(list: Instrument[], source: string, ticker: string): Instrument | undefined {
  return list.find((x) => x.source === source && x.ticker === ticker);
}
