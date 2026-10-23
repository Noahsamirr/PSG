import { describe, expect, it } from 'vitest';
import { resolveSource } from '../src/server/candles';

const first = (s: string, a?: string) => {
  const c = resolveSource(s, a)[0];
  return `${c.source}:${c.ticker}`;
};

describe('symbol → data source mapping', () => {
  it.each([
    ['gold usdt', 'binancef:XAUUSDT'],
    ['XAUUSDT', 'binancef:XAUUSDT'],
    ['BINANCE:XAUUSDT.P', 'binancef:XAUUSDT'],
    ['XAUUSD', 'yahoo:GC=F'],
    ['OANDA:XAUUSD', 'yahoo:GC=F'],
    ['TVC:GOLD', 'yahoo:GC=F'],
    ['XAGUSDT', 'binancef:XAGUSDT'],
    ['BTCUSDT', 'binance:BTCUSDT'],
    ['BINANCE:BTCUSDT.P', 'binancef:BTCUSDT'],
    ['bitcoin', 'binance:BTCUSDT'],
    ['ETHUSD', 'binance:ETHUSDT'],
    ['EURUSD', 'yahoo:EURUSD=X'],
    ['NAS100', 'yahoo:^NDX'],
    ['SP:SPX', 'yahoo:^GSPC'],
    ['COMEX:GC1!', 'yahoo:GC=F'],
    ['ES1!', 'yahoo:ES=F'],
    ['AAPL', 'yahoo:AAPL'],
  ])('%s → %s', (input, expected) => {
    expect(first(input)).toBe(expected);
  });
  it('offers gold-in-USDT alternatives for spot gold', () => {
    expect(resolveSource('XAUUSD').map((c) => c.ticker)).toEqual(expect.arrayContaining(['XAUUSDT', 'PAXGUSDT']));
  });
  it('labels proxies', () => {
    expect(resolveSource('XAUUSD').find((c) => c.ticker === 'PAXGUSDT')?.isProxy).toBe(true);
    expect(resolveSource('gold usdt')[0].isProxy).toBe(false);
  });
});
