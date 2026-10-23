import { describe, expect, it } from 'vitest';
import { computeMetrics, costStress, monteCarlo, parseTradesCsv, robustnessFlags, splitInOut, stability, walkForward, type Trade } from '../src/core';

const TV = `Trade #,Type,Signal,Date/Time,Price USD,Contracts,Profit USD,Profit %,Cumulative profit USD
2,Exit short,SL,2024-01-04 10:00,110,2,"-30.00",-3,20
2,Entry short,SELL,2024-01-03 10:00,107,2,-30,-3,20
1,Exit long,TP1,2024-01-02 10:00,105,1,"1,050.50",5,50
1,Entry long,BUY,2024-01-01 10:00,100,1,50,5,50`;

describe('TradingView list-of-trades import', () => {
  it('groups entry/exit rows and parses numbers', () => {
    const r = parseTradesCsv(TV);
    expect(r.format).toBe('tradingview-list-of-trades');
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ id: 1, direction: 'long', entryPrice: 100, exitPrice: 105, profit: 1050.5 });
    expect(r.trades[1]).toMatchObject({ id: 2, direction: 'short', profit: -30 });
    expect(r.trades[0].exitTime! - r.trades[0].entryTime!).toBe(86400000);
  });
  it('accepts the generic date,profit format', () => {
    const r = parseTradesCsv('date,profit\n2024-01-01,10\n2024-01-02,-5\n');
    expect(r.trades.map((t) => t.profit)).toEqual([10, -5]);
  });
  it('reports a helpful error when no profit column exists', () => {
    expect(parseTradesCsv('a,b\n1,2').warnings[0]).toMatch(/profit/i);
  });
});

const mk = (profits: number[]): Trade[] => profits.map((p, i) => ({ id: i + 1, direction: 'long', entryTime: Date.UTC(2024, 0, 1 + i), exitTime: Date.UTC(2024, 0, 1 + i, 5), entryPrice: 100, exitPrice: 100, qty: 1, profit: p }));

describe('metrics', () => {
  const m = computeMetrics(mk([100, -50, 200, -50, -50]), 1000);
  it('computes standard statistics exactly', () => {
    expect(m.trades).toBe(5);
    expect(m.wins).toBe(2);
    expect(m.winRate).toBe(40);
    expect(m.grossProfit).toBe(300);
    expect(m.grossLoss).toBe(150);
    expect(m.profitFactor).toBe(2);
    expect(m.netProfit).toBe(150);
    expect(m.expectancy).toBe(30);
    expect(m.payoffRatio).toBe(3);
    expect(m.maxDrawdown).toBe(100);
    expect(m.maxConsecutiveLosses).toBe(2);
    expect(m.avgDurationHours).toBe(5);
  });
  it('splits chronologically and walks forward', () => {
    const t = mk(Array.from({ length: 20 }, (_, i) => (i % 2 ? -10 : 20)));
    const { inSample, outSample } = splitInOut(t, { ratio: 0.7 });
    expect(inSample).toHaveLength(14);
    expect(outSample).toHaveLength(6);
    expect(walkForward(t, 4).map((f) => f.metrics.trades)).toEqual([5, 5, 5, 5]);
  });
  it('stress-tests costs', () => {
    const s = costStress(mk([10, 10]), { cashPerTrade: 2 }, [0, 1, 3]);
    expect(s.map((x) => x.metrics.netProfit)).toEqual([20, 16, 8]);
  });
  it('Monte Carlo is deterministic for a seed', () => {
    const t = mk([5, -3, 8, -2, 4, -6, 7]);
    expect(monteCarlo(t, 200, 7)).toEqual(monteCarlo(t, 200, 7));
    expect(monteCarlo(mk([1, 2]), 10)).toBeNull();
  });
  it('flags small samples and outlier dependence', () => {
    const codes = robustnessFlags(mk([1000, -10, -10, -10, 5])).map((f) => f.code);
    expect(codes).toContain('sample-size');
    expect(codes).toContain('outlier-dependence');
  });
  it('assesses stability across runs', () => {
    const s = stability([{ label: 'a', kind: 'backtest', metrics: computeMetrics(mk([10])) }, { label: 'b', kind: 'backtest', metrics: computeMetrics(mk([-50])) }]);
    expect(s.allProfitable).toBe(false);
  });
});
