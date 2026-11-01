import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { checkBars, confluence, evaluateOutcome, evaluateStrategy, evidenceOf, levelIssues, perf, probabilityOf, rankStrategies, specForTemplate, specHash, tradeResults } from '../src/core/signals';
import { scanTriggers } from '../src/core/outlook';
import { runSimulation } from '../src/core/sim/engine';
import { DISCOVERY } from '../src/core/discovery';
import { buildPlans, chanceText, pickAnswer, WHY, type TradePlan } from '../src/core/plans';
import type { StrategySignal } from '../src/core/signals';
import { CURATED, searchCatalog } from '../src/server/catalog';
import { TEMPLATES } from '../src/core/templates';
import type { Bar } from '../src/core/sim/series';
import type { SimTrade } from '../src/core/sim/engine';
import { createApp } from '../src/server/app';
import { Store } from '../src/server/db';
import { createProvider } from '../src/server/llm';

// Deterministic synthetic market (same generator as the sim tests), 15-minute bars.
function market(n = 1500, seed = 7, start = Date.UTC(2026, 0, 5)): Bar[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
  const bars: Bar[] = [];
  let p = 2000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 90) * 1.2 + Math.sin(i / 23) * 0.6;
    const o = p;
    const c = Math.max(1, o + drift + rnd() * 6);
    const h = Math.max(o, c) + Math.abs(rnd()) * 4;
    const l = Math.min(o, c) - Math.abs(rnd()) * 4;
    bars.push({ t: start + i * 15 * 60000, o, h, l, c, v: 1000 + Math.abs(rnd()) * 500 });
    p = c;
  }
  return bars;
}

describe('market data checks', () => {
  it('drops the still-forming bar and reports live data', () => {
    const bars = market(400);
    const last = bars[bars.length - 1];
    const { bars: out, check } = checkBars(bars, '15', last.t + 5 * 60000);
    expect(check.droppedFormingBar).toBe(true);
    expect(out.length).toBe(399);
    expect(check.status).toBe('live');
  });
  it('flags stale data but keeps it usable', () => {
    const bars = market(400);
    const { check } = checkBars(bars, '15', bars[bars.length - 1].t + 10 * 3600000);
    expect(check.status).toBe('stale');
    expect(check.ok).toBe(true);
  });
  it('refuses impossible OHLC, unordered timestamps and short history', () => {
    const bad = market(400);
    bad[100] = { ...bad[100], h: bad[100].l - 1 };
    expect(checkBars(bad, '15', Date.now()).check.status).toBe('invalid');
    const unordered = market(400);
    unordered[50] = { ...unordered[50], t: unordered[10].t };
    expect(checkBars(unordered, '15', Date.now()).bars).toEqual([]);
    expect(checkBars(market(100), '15', Date.now()).check.ok).toBe(false);
  });
});

describe('signal levels and performance', () => {
  it('rejects inconsistent levels', () => {
    expect(levelIssues(1, 100, 95, [105, 110])).toEqual([]);
    expect(levelIssues(1, 100, 105, [110])).toHaveLength(1);
    expect(levelIssues(-1, 100, 105, [95, 90])).toEqual([]);
    expect(levelIssues(-1, 100, 105, [90, 95])).toContain('Targets are not in order.');
    expect(levelIssues(1, NaN, 95, [105])).toHaveLength(1);
  });
  it('computes break-even win rate and expectancy in R', () => {
    const t = (r: number) => ({ r, holdBars: 3, ambiguous: false });
    const p = perf([t(2), t(-1), t(-1), t(2)]);
    expect(p.winRate).toBe(50);
    expect(p.breakEvenWinRate).toBeCloseTo(33.33, 1);
    expect(p.expectancyR).toBe(0.5);
    expect(p.profitFactor).toBe(2);
    expect(p.maxDrawdownR).toBe(2);
    expect(p.maxConsecLosses).toBe(2);
    expect(p.avgHoldBars).toBe(3);
  });
  it('excludes break-even trades from the win-rate denominator', () => {
    const t = (r: number) => ({ r, holdBars: 1, ambiguous: false });
    const p = perf([t(1), t(0.01), t(-1)]);
    expect(p.breakEven).toBe(1);
    expect(p.winRate).toBe(50);
    expect(p.trades).toBe(3);
  });
  it('charges commission and counts a stop+target candle as a stop', () => {
    const spec = specForTemplate('ema_trend', '60', 'X');
    spec.backtest.commissionType = 'percent';
    spec.backtest.commissionValue = 0.05;
    const bars: Bar[] = [0, 1, 2, 3].map((i) => ({ t: i, o: 100, h: 101, l: 99, c: 100, v: 1 }));
    bars[2] = { t: 2, o: 100, h: 111, l: 94, c: 105, v: 1 }; // touches TP (110) and stop (95)
    const base = { dir: 1 as const, signalBar: 0, entryBar: 1, entry: 100, stop: 95, initialStop: 95, risk: 5, qty: 1, strong: false };
    const ambiguous = { ...base, exitBar: 2, exitPrice: 110, reason: 'TP1', r: 2, pnl: 0, partials: [{ bar: 2, price: 110, frac: 1, label: 'TP1' }] } as SimTrade;
    const clean = { ...base, exitBar: 3, exitPrice: 110, reason: 'TP1', r: 2, pnl: 0, partials: [{ bar: 3, price: 110, frac: 1, label: 'TP1' }] } as SimTrade;
    const [a, c] = tradeResults([ambiguous, clean], bars, spec);
    expect(a.ambiguous).toBe(true);
    expect(a.r).toBeCloseTo(-1 - 0.0005 * 210 / 5, 6);
    expect(c.ambiguous).toBe(false);
    expect(c.r).toBeCloseTo(2 - 0.0005 * 210 / 5, 6);
    expect(c.holdBars).toBe(2);
  });
  it('ranks only well-evidenced strategies first', () => {
    const mk = (id: string, trades: number, oos: number, exp: number) => {
      const p = perf(Array.from({ length: trades }, (_, k) => ({ r: k % 2 ? exp + 1 : exp - 1, holdBars: 1, ambiguous: false })));
      const o = perf(Array.from({ length: oos }, () => ({ r: exp, holdBars: 1, ambiguous: false })));
      return { strategyId: id, strategyName: id, family: 'trend' as const, category: '', strategyVersion: '', all: p, outOfSample: o, evidence: evidenceOf(p, o, 30, 10), tfOk: true };
    };
    const ranked = rankStrategies([mk('lucky', 5, 2, 3), mk('solid', 40, 12, 0.2), mk('weak', 40, 12, -0.1)]);
    expect(ranked.map((r) => r.strategyId)).toEqual(['solid', 'weak', 'lucky']);
    expect(ranked[2].evidence).toBe('low');
  });
  it('every template gives a consistent, deterministic BUY/SELL/NO TRADE', () => {
    const bars = market(1500);
    for (const t of TEMPLATES) {
      const spec = specForTemplate(t.id, '15', 'XAUUSDT');
      const a = evaluateStrategy(spec, bars, '15', { templateId: t.id });
      const b = evaluateStrategy(spec, bars, '15', { templateId: t.id });
      expect(b).toEqual(a);
      expect(a.strategyVersion).toBe(specHash(spec));
      expect(['BUY', 'SELL', 'NO TRADE']).toContain(a.state);
      if (a.state === 'NO TRADE') expect(a.entry).toBeNull();
      else expect(levelIssues(a.state === 'BUY' ? 1 : -1, a.entry!, a.stop!, a.targets)).toEqual([]);
    }
  });
  it('sends everything the chart needs: indicators, structure events, trade levels, exits and entry reasons', () => {
    const bars = market(1500);
    const smc = evaluateStrategy(specForTemplate('smc_sweep_fvg', '15', 'XAUUSDT'), bars, '15', { templateId: 'smc_sweep_fvg' });
    const texts = new Set(smc.events.map((e) => e.text));
    for (const t of ['$', 'FVG']) expect(texts.has(t)).toBe(true);
    expect([...texts].some((t) => t === 'CHoCH' || t === 'BOS')).toBe(true);
    expect(smc.indicators.map((i) => i.name)).toEqual(expect.arrayContaining(['Bullish FVG top', 'Bearish FVG bottom', 'Equilibrium (premium above / discount below)']));
    for (const t of TEMPLATES) {
      const s = evaluateStrategy(specForTemplate(t.id, '15', 'XAUUSDT'), bars, '15', { templateId: t.id });
      expect(s.levels?.stop).toHaveLength(bars.length);
      for (const m of s.markers) expect(m.why.length).toBeGreaterThan(0);
      if (s.all.trades) expect(s.exits.length).toBeGreaterThanOrEqual(s.all.trades);
    }
    const lean = evaluateStrategy(specForTemplate('smc_sweep_fvg', '15', 'X'), bars, '15', { templateId: 'smc_sweep_fvg', withSeries: false });
    expect(lean.levels).toBeNull();
    expect(lean.events).toEqual([]);
  });
  it('produces no signal without valid data', () => {
    const s = evaluateStrategy(specForTemplate('ema_trend', '60', 'X'), [], '60', { templateId: 'ema_trend' });
    expect(s.state).toBe('NO TRADE');
    expect(s.issues).toContain('insufficient data');
  });
});

describe('confluence', () => {
  it('counts strategies of the same family once', () => {
    const c = confluence([
      { family: 'trend', state: 'BUY' },
      { family: 'trend', state: 'BUY' },
      { family: 'trend', state: 'BUY' },
    ]);
    expect(c.state).toBe('NO TRADE');
    expect(c.buyFamilies).toEqual(['trend']);
  });
  it('needs two independent families and no opposition', () => {
    expect(confluence([{ family: 'trend', state: 'BUY' }, { family: 'momentum', state: 'BUY' }, { family: 'meanrev', state: 'NO TRADE' }]).state).toBe('BUY');
    expect(confluence([{ family: 'trend', state: 'SELL' }, { family: 'momentum', state: 'SELL' }, { family: 'structure', state: 'BUY' }]).state).toBe('NO TRADE');
    const split = confluence([{ family: 'trend', state: 'BUY' }, { family: 'trend', state: 'SELL' }, { family: 'momentum', state: 'BUY' }]);
    expect(split.splitFamilies).toEqual(['trend']);
    expect(split.state).toBe('NO TRADE');
    expect(split.disagreeing).toBeGreaterThan(0);
  });
  it('reports a score and how far apart active entries are', () => {
    const c = confluence([
      { family: 'trend', state: 'BUY', entry: 100, stop: 98 },
      { family: 'momentum', state: 'BUY', entry: 110, stop: 108 },
    ]);
    expect(c.score).toBe(100);
    expect(c.priceSpread).toBe(5);
    expect(c.explanation).toMatch(/not the same entry/);
  });
});

describe('instrument catalog and discovery', () => {
  it('finds every gold instrument as a separate product', () => {
    const r = searchCatalog(CURATED, 'gold');
    const ids = r.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['binancef:XAUUSDT', 'binance:PAXGUSDT', 'yahoo:GC=F', 'yahoo:GLD']));
    expect(new Set(r.map((x) => x.kind)).size).toBeGreaterThanOrEqual(4);
    expect(searchCatalog(CURATED, 'EURUSD')[0].ticker).toBe('EURUSD=X');
    expect(searchCatalog(CURATED, 'zzzz')).toEqual([]);
  });
  it('discovery profiles link to real templates and never claim originator results', () => {
    for (const p of DISCOVERY) {
      if (p.templateId) expect(TEMPLATES.some((t) => t.id === p.templateId)).toBe(true);
      else expect(p.fidelity).toBe('not-implemented');
      expect(p.verification).toMatch(/No verified trading record/);
      expect(JSON.stringify(p)).not.toMatch(/win rate of \d|returned \d+%/i);
    }
  });
});

describe('saved opportunity outcome', () => {
  const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c, v: 1 });
  it('counts a bar touching stop and target as a stop (conservative)', () => {
    const r = evaluateOutcome({ dir: 1, entry: 100, stop: 95, targets: [110], savedAt: 0 }, [bar(1, 100, 111, 94, 100)]);
    expect(r.status).toBe('stopped');
    expect(r.r).toBe(-1);
  });
  it('tracks targets, open trades and ignores bars before saving', () => {
    expect(evaluateOutcome({ dir: -1, entry: 100, stop: 105, targets: [90], savedAt: 0 }, [bar(1, 100, 101, 89, 90)]).status).toBe('target');
    const open = evaluateOutcome({ dir: 1, entry: 100, stop: 95, targets: [110], savedAt: 10 }, [bar(5, 100, 120, 80, 100), bar(10, 100, 103, 99, 102)]);
    expect(open.status).toBe('open');
    expect(open.r).toBeCloseTo(0.4);
    expect(open.barsChecked).toBe(1);
    expect(evaluateOutcome({ dir: 1, entry: 100, stop: 95, targets: [110], savedAt: 99 }, [bar(5, 100, 101, 99, 100)]).status).toBe('pending');
  });
});

describe('dashboard API (offline parts)', () => {
  let server: Server;
  let base = '';
  const store = new Store(':memory:');
  const j = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  beforeAll(async () => {
    const { app } = createApp(store, createProvider({ LLM_PROVIDER: 'none' }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => server.close());

  it('lists GOLD first', async () => {
    const r = await j('GET', '/market/assets');
    expect(r.body[0].assetClass).toBe('metals');
    expect(r.body[0].ticker).toBe('XAUUSDT');
  });
  it('validates strategy requests', async () => {
    expect((await j('POST', '/signals', { symbol: 'XAUUSDT', tf: '60', strategies: [] })).status).toBe(400);
    expect((await j('POST', '/signals', { symbol: 'XAUUSDT', tf: '60', strategies: ['nope'] })).status).toBe(400);
  });
  it('saves opportunities immutably and refuses NO TRADE', async () => {
    const market = { symbol: 'XAUUSDT', source: 'binancef', ticker: 'XAUUSDT', instrument: 'Perpetual futures', tf: '60' };
    const signal = { strategyId: 'ema_trend', strategyName: 'EMA', family: 'trend', strategyVersion: 'abc123', state: 'BUY', signalTime: '2026-10-25T10:00:00.000Z', entry: 4000, stop: 3980, targets: [4040, 4060] };
    expect((await j('POST', '/opportunities', { signal: { ...signal, state: 'NO TRADE' }, market })).status).toBe(400);
    const saved = await j('POST', '/opportunities', { signal, market });
    expect(saved.status).toBe(200);
    expect(saved.body.direction).toBe(1);
    expect(saved.body.strategyVersion).toBe('abc123');
    const list = await j('GET', '/opportunities');
    expect(list.body).toHaveLength(1);
    expect(store.getOpportunity(saved.body.id)?.snapshot).toMatchObject({ signal: { entry: 4000 } });
    expect((await j('DELETE', `/opportunities/${saved.body.id}`)).body.deleted).toBe(true);
  });
  it('protects administrator endpoints', async () => {
    const prev = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    expect((await j('GET', '/admin/overview')).status).toBe(503);
    process.env.ADMIN_TOKEN = 'secret-token';
    expect((await j('GET', '/admin/overview')).status).toBe(401);
    const ok = await fetch(base + '/admin/overview', { headers: { 'x-admin-token': 'secret-token' } });
    expect(ok.status).toBe(200);
    const rv = await fetch(base + '/admin/strategies/ema_trend/review', { method: 'PUT', headers: { 'x-admin-token': 'secret-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
    expect(rv.status).toBe(400); // approval needs an evidence note
    const rv2 = await fetch(base + '/admin/strategies/ema_trend/review', { method: 'PUT', headers: { 'x-admin-token': 'secret-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'deprecated', note: 'test' }) });
    expect(rv2.status).toBe(200);
    expect((await j('GET', '/strategies')).body.find((s: any) => s.id === 'ema_trend').review.status).toBe('deprecated');
    if (prev === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = prev;
  });
  it('reuses an identical stored Pine script instead of generating a new one', async () => {
    const a = await j('POST', '/strategy-script', { strategyId: 'macd_trend', tf: '60', symbol: 'XAUUSDT' });
    const b = await j('POST', '/strategy-script', { strategyId: 'macd_trend', tf: '60', symbol: 'XAUUSDT' });
    expect(a.body.reused).toBe(false);
    expect(b.body.reused).toBe(true);
    expect(b.body.scriptId).toBe(a.body.scriptId);
    expect(a.body.validation.errorCount).toBe(0);
    expect(a.body.validation.compiled).toBe(false);
  });
});

describe('trade plans', () => {
  const sig = (id: string, family: string, state: 'BUY' | 'SELL' | 'NO TRADE', entry: number | null, stop: number | null) =>
    ({ strategyId: id, strategyName: id, family, state, stage: state === 'NO TRADE' ? 'none' : 'confirmed', setupDir: 0, isNew: false, signalTime: '2026-10-26T03:00:00.000Z', entry, stop, targets: entry === null ? [] : [entry + (state === 'BUY' ? 30 : -30)], rewardRisk: 3, reasons: [{ label: 'x', role: 'trigger', met: true }] }) as unknown as StrategySignal;
  it('has a plain-English reason for every strategy in both directions', () => {
    for (const t of TEMPLATES) for (const d of [1, -1] as const) expect(WHY[t.id]?.(d).length).toBeGreaterThan(40);
  });
  it('classifies agree / same direction far away / disagree and counts independent families', () => {
    const plans = buildPlans([
      sig('a', 'structure', 'BUY', 4015, 4005), // risk 10
      sig('b', 'trend', 'BUY', 4022, 4010), // 0.7 stop distances away → agrees
      sig('c', 'structure', 'BUY', 4019, 4009), // agrees, same family as a
      sig('d', 'trend', 'BUY', 4060, 4040), // 4.5 away → same direction, different entry
      sig('e', 'momentum', 'SELL', 4030, 4050), // disagrees
      sig('f', 'meanrev', 'NO TRADE', null, null),
    ]);
    expect(plans).toHaveLength(5);
    const a = plans.find((p) => p.strategyId === 'a')!;
    expect(a.agree.map((x) => x.strategyId)).toEqual(['b', 'c']);
    expect(a.agree.find((x) => x.strategyId === 'c')!.related).toBe(true);
    expect(a.independentAgree).toBe(1);
    expect(a.sameDirection.map((x) => x.strategyId)).toEqual(['d']);
    expect(a.disagree.map((x) => x.strategyId)).toEqual(['e']);
    expect(a.entry).toBe(4015);
    expect(a.stop).toBe(4005);
  });
});

describe('probability of profit, live candles and next entry triggers', () => {
  it('computes the share of profitable trades with a 95% Wilson range', () => {
    const r = (x: number) => ({ r: x, holdBars: 1, ambiguous: false });
    const p = probabilityOf([r(2), r(-1), r(-1), r(1.5), r(0.01)])!;
    expect(p.n).toBe(5);
    expect(p.p).toBeCloseTo(0.4); // break-even (0.01R) does not count as profit
    expect(p.lo).toBeGreaterThan(0.1);
    expect(p.hi).toBeLessThan(0.8);
    expect(probabilityOf([])).toBeNull();
    const big = probabilityOf(Array.from({ length: 400 }, (_, k) => r(k % 2 ? 1 : -1)))!;
    expect(big.hi - big.lo).toBeLessThan(0.11); // more trades → narrower range
  });
  it('keeps the forming candle only in live mode', () => {
    const bars = market(400);
    const now = bars[bars.length - 1].t + 5 * 60000;
    expect(checkBars(bars, '15', now).bars).toHaveLength(399);
    const live = checkBars(bars, '15', now, { live: true });
    expect(live.bars).toHaveLength(400);
    expect(live.check.liveCandle).toBe(true);
  });
  it('finds the closing prices that trigger entries, and replaying the strategy confirms each edge', () => {
    const bars = market(1500);
    const f = bars[bars.length - 1];
    let checked = 0;
    for (const id of ['donchian_turtle', 'ema_trend', 'supertrend_trend', 'macd_trend', 'squeeze_breakout', 'bb_meanrev', 'donchian_retest', 'stoch_pullback']) {
      const spec = specForTemplate(id, '15', 'XAUUSDT');
      const scan = scanTriggers(spec, bars.slice(0, -1), f, '15', { steps: 15 });
      expect(scan.searched.high).toBeGreaterThan(scan.searched.low);
      const width = scan.searched.high - scan.searched.low;
      const fires = (c: number, dir: 1 | -1) => {
        const next = { ...f, h: Math.max(f.h, c), l: Math.min(f.l, c), c };
        const res = runSimulation(spec, [...bars.slice(-601, -1), next], { chartTf: '15', showEvents: false });
        return res.markers.some((m) => m.bar === 600 && m.dir === dir && ['entry', 'strong', 'blocked'].includes(m.kind));
      };
      for (const tr of scan.triggers) {
        const dir = tr.action === 'BUY' ? 1 : -1;
        // Each finite edge: just inside fires, a little outside does not.
        if (tr.from !== null) {
          expect(fires(tr.from + 0.005 * width, dir), `${id} ${tr.action} inside from ${tr.from}`).toBe(true);
          expect(fires(tr.from - 0.05 * width, dir), `${id} ${tr.action} outside from ${tr.from}`).toBe(false);
          checked++;
        }
        if (tr.to !== null) {
          expect(fires(tr.to - 0.005 * width, dir), `${id} ${tr.action} inside to ${tr.to}`).toBe(true);
          expect(fires(tr.to + 0.05 * width, dir), `${id} ${tr.action} outside to ${tr.to}`).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('simple mode answer', () => {
  const plan = (id: string, over: Partial<TradePlan>): TradePlan =>
    ({ strategyId: id, strategyName: id, family: 'trend', action: 'BUY', isNew: false, tfOk: true, signalTime: '2026-10-26T03:00:00.000Z', entry: 100, stop: 95, targets: [110], rewardRisk: 2, probability: null, probabilityRecent: null, why: '', notMet: [], agree: [], sameDirection: [], disagree: [], developing: [], independentAgree: 0, summary: '', ...over }) as TradePlan;
  it('prefers independent agreement, ignores strategies not designed for the timeframe, then fewer opponents', () => {
    const peer = { strategyId: 'x', strategyName: 'x', family: 'momentum', action: 'BUY' as const, entry: 100, distanceR: 0.1, related: false, tfOk: true };
    const a = plan('a', { independentAgree: 1, agree: [peer] });
    const b = plan('b', { independentAgree: 0 });
    const offDesign = plan('c', { independentAgree: 3, tfOk: false });
    expect(pickAnswer([b, a, offDesign])?.strategyId).toBe('a');
    const c = plan('c2', { disagree: [{ ...peer, action: 'SELL' }] });
    expect(pickAnswer([c, b])?.strategyId).toBe('b');
    expect(pickAnswer([offDesign])).toBeNull();
  });
  it('explains the chance of profit in words and flags small samples', () => {
    expect(chanceText({ p: 0.33, lo: 0.1, hi: 0.7, n: 6 })).toEqual({ headline: '33%', detail: '2 of 6 past trades like this made money after costs.', rough: true });
    expect(chanceText({ p: 0.5, lo: 0.4, hi: 0.6, n: 40 }).rough).toBe(false);
    expect(chanceText(null).headline).toBe('Not measured yet');
  });
});
