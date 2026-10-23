// OHLCV candles for the in-app chart preview. Free sources: Binance public market data (crypto, PAXG as a
// gold proxy) and Yahoo Finance charts (FX, indices, futures, stocks — may rate-limit). Twelve Data is used
// when TWELVEDATA_API_KEY is set. Users can always upload a CSV exported from TradingView instead.
import type { Bar } from '../core/sim/series';
import { tfMinutes } from '../core/timeframe';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export type SourceKind = 'binance' | 'binancef' | 'yahoo' | 'twelvedata';

export interface SourceCandidate {
  source: SourceKind;
  ticker: string;
  isProxy: boolean;
  note: string;
  label: string;
}

export interface CandleRequest {
  symbol: string;
  assetClass?: string;
  tf: string;
  limit?: number;
  source?: 'auto' | SourceKind;
  ticker?: string;
}

export interface CandleResponse {
  bars: Bar[];
  source: SourceKind;
  ticker: string;
  tf: string;
  note: string;
  label: string;
  qtyStep: number;
  isProxy: boolean;
}

const CRYPTO = /^(BTC|ETH|SOL|XRP|ADA|DOGE|BNB|LTC|AVAX|DOT|LINK|MATIC|POL|TRX|TON|SHIB|PEPE|ARB|OP|SUI|NEAR|ATOM|APT|INJ|FIL|UNI|AAVE|ETC|BCH|XLM)/;
const INDEX: Record<string, string> = { SPX: '^GSPC', SPX500: '^GSPC', US500: '^GSPC', SP500: '^GSPC', NDX: '^NDX', NAS100: '^NDX', US100: '^NDX', DJI: '^DJI', US30: '^DJI', GER40: '^GDAXI', DE40: '^GDAXI', DAX: '^GDAXI', UK100: '^FTSE', JP225: '^N225', VIX: '^VIX', DXY: 'DX-Y.NYB' };
const COMMOD: Record<string, string> = { XAUUSD: 'GC=F', GOLD: 'GC=F', XAGUSD: 'SI=F', SILVER: 'SI=F', USOIL: 'CL=F', WTI: 'CL=F', UKOIL: 'BZ=F', BRENT: 'BZ=F', NATGAS: 'NG=F', COPPER: 'HG=F' };

const SOURCE_NAME: Record<SourceKind, string> = { binance: 'Binance spot', binancef: 'Binance futures', yahoo: 'Yahoo Finance', twelvedata: 'Twelve Data' };
const cand = (source: SourceKind, ticker: string, note: string, isProxy = false): SourceCandidate => ({ source, ticker, note, isProxy, label: `${SOURCE_NAME[source]} ${ticker} — ${note}` });

const GOLD = ['XAUUSD', 'GOLD', 'GC', 'GC1!', 'XAU'];
const GOLD_USDT = ['XAUUSDT', 'GOLDUSDT', 'GOLDUSD T', 'XAUUSDT.P'];
const SILVER = ['XAGUSD', 'SILVER', 'SI', 'SI1!', 'XAG'];
const NATURAL: Record<string, string> = { BITCOIN: 'BTCUSDT', ETHEREUM: 'ETHUSDT', SOLANA: 'SOLUSDT', OIL: 'USOIL', CRUDE: 'USOIL', 'S&P500': 'SPX', SP500: 'SPX', NASDAQ: 'NDX', DOW: 'DJI' };

/**
 * Maps a symbol — plain (XAUUSD), TradingView-style (OANDA:XAUUSD, BINANCE:BTCUSDT.P, TVC:GOLD, COMEX:GC1!)
 * or a plain-English name ("gold usdt") — to data sources, best first.
 */
export function resolveSource(symbolIn: string, assetClass?: string): SourceCandidate[] {
  let raw = (symbolIn || '').trim().toUpperCase();
  const exchange = raw.includes(':') ? raw.split(':')[0] : '';
  raw = raw.replace(/^[A-Z0-9_]+:/, '');
  const perp = /\.P$|PERP$/.test(raw) || exchange === 'BINANCEFUTURES' || exchange === 'BYBIT';
  const compact = raw.replace(/\.P$/, '').replace(/PERP$/, '').replace(/[\s/_-]+/g, '');
  const symbol = NATURAL[compact] ?? compact;
  if (!symbol) return [cand('binance', 'BTCUSDT', 'No instrument in the specification — showing Bitcoin.')];

  // Gold & silver
  if (GOLD_USDT.includes(symbol) || (symbol === 'GOLD' && /USDT/.test(raw))) {
    return [
      cand('binancef', 'XAUUSDT', 'gold perpetual priced in USDT (tracks spot gold)'),
      cand('binance', 'PAXGUSDT', 'PAX Gold token (gold-backed)', true),
      cand('binance', 'XAUTUSDT', 'Tether Gold token (gold-backed)', true),
    ];
  }
  if (GOLD.includes(symbol)) {
    return [
      cand('yahoo', 'GC=F', 'COMEX gold futures (close to spot)', true),
      cand('binancef', 'XAUUSDT', 'gold perpetual in USDT (tracks spot gold)', true),
      cand('binance', 'PAXGUSDT', 'PAX Gold token (gold-backed)', true),
      cand('twelvedata', 'XAU/USD', 'spot gold (API key)'),
    ];
  }
  if (symbol === 'XAGUSDT') return [cand('binancef', 'XAGUSDT', 'silver perpetual priced in USDT'), cand('yahoo', 'SI=F', 'COMEX silver futures', true)];
  if (SILVER.includes(symbol)) return [cand('yahoo', 'SI=F', 'COMEX silver futures (close to spot)', true), cand('binancef', 'XAGUSDT', 'silver perpetual in USDT', true), cand('twelvedata', 'XAG/USD', 'spot silver (API key)')];

  // Crypto
  if (CRYPTO.test(symbol) || assetClass === 'crypto' || exchange === 'BINANCE' || exchange === 'BYBIT' || exchange === 'BINANCEFUTURES') {
    const base = symbol.replace(/(USDT|USDC|BUSD|USD)$/, '');
    const pair = `${base}USDT`;
    const spot = cand('binance', pair, symbol.endsWith('USDT') ? 'spot' : `spot (USDT pair for ${symbol})`, !symbol.endsWith('USDT'));
    const fut = cand('binancef', pair, 'USDT perpetual futures');
    return [...(perp ? [fut, spot] : [spot, fut]), cand('yahoo', `${base}-USD`, 'USD price')];
  }
  if (COMMOD[symbol]) return [cand('yahoo', COMMOD[symbol], `futures contract for ${symbol}`, true)];
  if (INDEX[symbol]) return [cand('yahoo', INDEX[symbol], 'index')];
  const fut = /^([A-Z0-9]{1,3})1!$/.exec(symbol) ?? (/^(ES|NQ|YM|RTY|CL|GC|SI|NG|ZB|ZN|MES|MNQ)$/.exec(symbol) as RegExpExecArray | null);
  if (fut || assetClass === 'futures') return [cand('yahoo', `${fut ? fut[1] : symbol}=F`, 'continuous front-month futures')];
  if (/^[A-Z]{6}$/.test(symbol) && (assetClass === 'forex' || /^(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)/.test(symbol)))
    return [cand('yahoo', `${symbol}=X`, 'FX rate'), cand('twelvedata', `${symbol.slice(0, 3)}/${symbol.slice(3)}`, 'FX rate (API key)')];
  return [cand('yahoo', symbol.replace(/\./g, '-'), 'stock / ETF'), cand('twelvedata', symbol, 'stock / ETF (API key)')];
}

export const POPULAR_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: 'XAUUSD', label: 'Gold spot (USD)' },
  { symbol: 'XAUUSDT', label: 'Gold priced in USDT (Binance perpetual)' },
  { symbol: 'PAXGUSDT', label: 'PAX Gold token / USDT' },
  { symbol: 'XAUTUSDT', label: 'Tether Gold token / USDT' },
  { symbol: 'XAGUSD', label: 'Silver spot (USD)' },
  { symbol: 'XAGUSDT', label: 'Silver priced in USDT (Binance perpetual)' },
  { symbol: 'BTCUSDT', label: 'Bitcoin / USDT' },
  { symbol: 'ETHUSDT', label: 'Ethereum / USDT' },
  { symbol: 'SOLUSDT', label: 'Solana / USDT' },
  { symbol: 'XRPUSDT', label: 'XRP / USDT' },
  { symbol: 'BNBUSDT', label: 'BNB / USDT' },
  { symbol: 'BINANCE:BTCUSDT.P', label: 'Bitcoin perpetual (TradingView name)' },
  { symbol: 'EURUSD', label: 'Euro / US dollar' },
  { symbol: 'GBPUSD', label: 'British pound / US dollar' },
  { symbol: 'USDJPY', label: 'US dollar / Japanese yen' },
  { symbol: 'AUDUSD', label: 'Australian dollar / US dollar' },
  { symbol: 'US500', label: 'S&P 500 index' },
  { symbol: 'NAS100', label: 'Nasdaq 100 index' },
  { symbol: 'US30', label: 'Dow Jones index' },
  { symbol: 'GER40', label: 'DAX index' },
  { symbol: 'USOIL', label: 'WTI crude oil' },
  { symbol: 'ES1!', label: 'E-mini S&P 500 futures' },
  { symbol: 'NQ1!', label: 'E-mini Nasdaq futures' },
  { symbol: 'AAPL', label: 'Apple' },
  { symbol: 'TSLA', label: 'Tesla' },
  { symbol: 'NVDA', label: 'Nvidia' },
];

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(res.status === 429 ? 'rate limited (HTTP 429)' : `HTTP ${res.status}`);
  return res.json();
}

function aggregate(bars: Bar[], minutes: number): Bar[] {
  const out: Bar[] = [];
  let key = NaN;
  for (const b of bars) {
    const k = Math.floor(b.t / (minutes * 60000));
    if (k !== key) {
      out.push({ ...b, t: k * minutes * 60000 });
      key = k;
    } else {
      const o = out[out.length - 1];
      o.h = Math.max(o.h, b.h);
      o.l = Math.min(o.l, b.l);
      o.c = b.c;
      o.v += b.v;
    }
  }
  return out;
}

const BINANCE_TF: Record<string, string> = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', '1D': '1d', '1W': '1w', '1M': '1M' };

async function binance(ticker: string, tf: string, limit: number): Promise<Bar[]> {
  const iv = BINANCE_TF[tf];
  if (!iv) throw new Error(`Binance has no ${tf} interval`);
  let bars: Bar[] = [];
  let end: number | undefined;
  while (bars.length < limit) {
    const n = Math.min(1000, limit - bars.length);
    const j = (await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${ticker}&interval=${iv}&limit=${n}${end ? `&endTime=${end}` : ''}`)) as any[];
    if (!Array.isArray(j) || !j.length) break;
    const chunk = j.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    bars = [...chunk, ...bars];
    end = chunk[0].t - 1;
    if (j.length < n) break;
  }
  return bars;
}

async function binanceFutures(ticker: string, tf: string, limit: number): Promise<Bar[]> {
  const iv = BINANCE_TF[tf];
  if (!iv) throw new Error(`Binance futures has no ${tf} interval`);
  let bars: Bar[] = [];
  let end: number | undefined;
  while (bars.length < limit) {
    const n = Math.min(1500, limit - bars.length);
    const j = (await getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${ticker}&interval=${iv}&limit=${n}${end ? `&endTime=${end}` : ''}`)) as any[];
    if (!Array.isArray(j) || !j.length) break;
    const chunk = j.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    bars = [...chunk, ...bars];
    end = chunk[0].t - 1;
    if (j.length < n) break;
  }
  return bars;
}

async function yahoo(ticker: string, tf: string, limit: number): Promise<Bar[]> {
  const min = tfMinutes(tf) ?? 60;
  // Pick the native interval and range; aggregate when Yahoo has no matching interval.
  const plan: [string, string, number] =
    min <= 1 ? ['1m', '7d', 1] : min < 5 ? ['1m', '7d', min] : min < 15 ? ['5m', '60d', min / 5] : min < 30 ? ['15m', '60d', min / 15] : min < 60 ? ['30m', '60d', min / 30] : min < 1440 ? ['60m', '730d', min / 60] : min < 10080 ? ['1d', '10y', 1] : ['1wk', 'max', 1];
  const [interval, range, factor] = plan;
  let lastErr: unknown;
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`);
      const r = j.chart?.result?.[0];
      if (!r?.timestamp) throw new Error(j.chart?.error?.description ?? 'no data');
      const q = r.indicators.quote[0];
      let bars: Bar[] = (r.timestamp as number[]).map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume?.[i] ?? 0 })).filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite));
      if (factor > 1) bars = aggregate(bars, min);
      return bars.slice(-limit);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const TD_TF: Record<string, string> = { '1': '1min', '5': '5min', '15': '15min', '30': '30min', '60': '1h', '120': '2h', '240': '4h', '1D': '1day', '1W': '1week' };

async function twelvedata(ticker: string, tf: string, limit: number): Promise<Bar[]> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('TWELVEDATA_API_KEY not set');
  const iv = TD_TF[tf];
  if (!iv) throw new Error(`Twelve Data has no ${tf} interval`);
  const j = await getJson(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=${iv}&outputsize=${Math.min(limit, 5000)}&timezone=UTC&apikey=${key}`);
  if (!Array.isArray(j.values)) throw new Error(j.message ?? 'no data');
  return (j.values as any[]).map((v) => ({ t: Date.parse(v.datetime + 'Z'), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume ?? 0) })).reverse();
}

const cache = new Map<string, { at: number; res: CandleResponse }>();

export async function getCandles(req: CandleRequest): Promise<CandleResponse> {
  const limit = Math.min(Math.max(Number(req.limit) || 1000, 100), 3000);
  const tf = (req.tf || '60').toUpperCase().replace(/^D$/, '1D').replace(/^W$/, '1W');
  if (tfMinutes(tf) === null) throw new Error(`Unknown timeframe "${req.tf}"`);
  let candidates: SourceCandidate[] = resolveSource(req.symbol, req.assetClass);
  if (req.ticker && req.source && req.source !== 'auto') {
    const t = req.ticker.toUpperCase().replace(/^[A-Z]+:/, '');
    const known = [...candidates, ...resolveSource(t)].find((c) => c.source === req.source && c.ticker === t);
    candidates = [known ?? cand(req.source, t, 'custom ticker')];
  }
  else if (req.source && req.source !== 'auto') candidates = candidates.filter((c) => c.source === req.source);
  const key = JSON.stringify([candidates.map((c) => c.source + c.ticker), tf, limit]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.res;
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const bars = c.source === 'binance' ? await binance(c.ticker, tf, limit) : c.source === 'binancef' ? await binanceFutures(c.ticker, tf, limit) : c.source === 'yahoo' ? await yahoo(c.ticker, tf, limit) : await twelvedata(c.ticker, tf, limit);
      if (bars.length < 50) throw new Error(`only ${bars.length} bars`);
      const res: CandleResponse = { bars, source: c.source, ticker: c.ticker, tf, note: c.note, label: c.label, isProxy: c.isProxy, qtyStep: c.source === 'binance' || /-USD$/.test(c.ticker) ? 0.0001 : c.source === 'binancef' ? 0.001 : 1 };
      cache.set(key, { at: Date.now(), res });
      return res;
    } catch (e) {
      errors.push(`${c.source} ${c.ticker}: ${(e as Error).message}`);
    }
  }
  throw new Error(`No candle data (${errors.join('; ')}). Try another source, or upload a CSV exported from TradingView.`);
}
