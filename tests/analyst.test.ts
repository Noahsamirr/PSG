import { describe, expect, it } from 'vitest';
import { buildLevels, combinePanel, evidenceForPrompt, marketContextFrom, researchSymbolFor, ruleBasedDecision, validateAiDecision, type AiDecision, type AnalystDecision, type AnalystInput, type ContextReport } from '../src/core/analyst';
import type { StrategySignal } from '../src/core/signals';

const prob = (p: number, n: number) => ({ p, lo: Math.max(0, p - 0.15), hi: Math.min(1, p + 0.15), n });
const perf = (trades: number, exp: number) => ({ trades, wins: 0, losses: 0, breakEven: 0, winRate: null, avgWinR: null, avgLossR: null, breakEvenWinRate: null, expectancyR: exp, grossProfitR: 0, grossLossR: 0, profitFactor: null, totalR: 0, maxDrawdownR: 0, avgHoldBars: null, maxConsecWins: 0, maxConsecLosses: 0, ambiguous: 0 });

function sig(id: string, family: string, state: 'BUY' | 'SELL' | 'NO TRADE', o: Partial<StrategySignal> = {}): StrategySignal {
  const dir = state === 'BUY' ? 1 : -1;
  return {
    strategyId: id,
    strategyName: id,
    family,
    category: '',
    strategyVersion: 'v',
    state,
    stage: state === 'NO TRADE' ? 'none' : 'confirmed',
    isNew: false,
    reason: '',
    reasons: [],
    invalidation: [],
    ruleScore: null,
    setupDir: 0,
    signalTime: state === 'NO TRADE' ? null : '2026-10-27T10:00:00.000Z',
    barsSinceSignal: state === 'NO TRADE' ? null : 3,
    entry: state === 'NO TRADE' ? null : 4000,
    pendingFill: false,
    stop: state === 'NO TRADE' ? null : 4000 - dir * 10,
    stopMoved: false,
    targets: state === 'NO TRADE' ? [] : [4000 + dir * 10, 4000 + dir * 30],
    rewardRisk: 3,
    tfOk: true,
    tfNote: '',
    entryLogic: '',
    exitLogic: '',
    inSample: perf(0, 0),
    outOfSample: perf(10, 0.2),
    all: perf(40, 0.2),
    probability: { all: prob(0.45, 40), inSample: null, outOfSample: prob(0.5, 10) },
    splitTime: null,
    costNote: '',
    markers: [],
    exits: [],
    events: [],
    levels: null,
    indicators: [],
    issues: [],
    ...o,
  } as StrategySignal;
}

const input = (frames: AnalystInput['frames'], price = 4001, events: AnalystInput['events'] = []): AnalystInput => ({ ticker: 'XAUUSDT', price, change24hPct: 0.3, focusTf: '15', frames, events, now: Date.parse('2026-10-27T12:00:00Z') });
const agreeingBuy = (): AnalystInput['frames'] =>
  ['5', '15', '30', '60'].map((tf) => ({ tf, dataStatus: 'live', signals: [sig('ema_trend', 'trend', 'BUY'), sig('macd_trend', 'momentum', 'BUY'), sig('bb_meanrev', 'meanrev', 'NO TRADE')], triggers: [] }));

describe('rule-based analyst', () => {
  it('buys at the market when independent families agree on every timeframe and the price is near the entry', () => {
    const d = ruleBasedDecision(input(agreeingBuy()));
    expect(d.action).toBe('BUY');
    expect(d.entryType).toBe('market');
    expect(d.entry).toBe(4001);
    expect(d.stopLoss).toBe(3990);
    expect(d.takeProfits).toEqual([4010, 4030]);
    expect(d.confidence).toBe('high');
    expect(d.measuredChance).toEqual({ p: 0.45, n: 40 });
  });
  it('uses a limit order at the strategy entry when the price has already run ahead', () => {
    const d = ruleBasedDecision(input(agreeingBuy(), 4006));
    expect(d.action).toBe('BUY');
    expect(d.entryType).toBe('limit');
    expect(d.entry).toBe(4000);
    expect(d.waitFor).toMatch(/pullback to 4000/);
  });
  it('waits when timeframes disagree', () => {
    const frames = agreeingBuy();
    frames[2].signals = [sig('ema_trend', 'trend', 'SELL'), sig('macd_trend', 'momentum', 'SELL')];
    frames[3].signals = [sig('ema_trend', 'trend', 'SELL'), sig('macd_trend', 'momentum', 'SELL')];
    expect(ruleBasedDecision(input(frames)).action).toBe('WAIT');
  });
  it('waits when US high-impact news is less than an hour away', () => {
    const d = ruleBasedDecision(input(agreeingBuy(), 4001, [{ title: 'Non-Farm Payrolls', country: 'USD', time: Date.parse('2026-10-27T12:30:00Z'), impact: 'High' }]));
    expect(d.action).toBe('WAIT');
    expect(d.headline).toMatch(/news/);
  });
  it('waits when the price is already past the stop', () => {
    expect(ruleBasedDecision(input(agreeingBuy(), 3985)).action).toBe('WAIT');
  });
});

describe('AI decision validation', () => {
  const inp = input(agreeingBuy());
  const levels = buildLevels(inp);
  const e = levels.find((l) => l.kind === 'entry' && l.tf === '15')!;
  const k = e.id.slice(1);
  const base: AiDecision = { action: 'BUY', timeframe: '15', entryLevel: e.id, stopLevel: `S${k}`, targetLevels: [`T${k}a`, `T${k}b`], confidence: 'medium', headline: 'h', reasoning: ['r'], risks: [], invalidation: 'i', waitFor: '', basedOn: ['ema_trend', 'nope'] };
  it('gives every level a unique id and includes the current price', () => {
    expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length);
    expect(levels[0]).toMatchObject({ id: 'MARKET', price: 4001 });
    expect(evidenceForPrompt(inp, levels).levels).toHaveLength(levels.length);
  });
  it('turns level ids into real prices', () => {
    const v = validateAiDecision(base, levels, inp);
    expect(v.problems).toEqual([]);
    expect(v.decision).toMatchObject({ action: 'BUY', entry: 4000, stopLoss: 3990, takeProfits: [4010, 4030] });
    expect(v.decision!.basedOn).toEqual(['ema_trend']); // unknown strategy ids are dropped
  });
  it('rejects invented levels, wrong-direction levels and poor reward', () => {
    expect(validateAiDecision({ ...base, entryLevel: 'E999' }, levels, inp).decision).toBeNull();
    expect(validateAiDecision({ ...base, action: 'SELL' }, levels, inp).decision).toBeNull();
    expect(validateAiDecision({ ...base, stopLevel: `T${k}a` }, levels, inp).decision).toBeNull();
    expect(validateAiDecision({ ...base, targetLevels: [] }, levels, inp).decision).toBeNull();
  });
  it('replaces level ids in the text with real prices', () => {
    const v = validateAiDecision({ ...base, action: 'WAIT', entryLevel: '', stopLevel: '', targetLevels: [], waitFor: `Wait for a close above ${e.id} or below ${e.id} (4000)`, reasoning: [`MACD BUY (${e.id}) is fresh`, 'MARKET is 4001'] }, levels, inp);
    expect(v.decision!.waitFor).toBe('Wait for a close above 4000.00 or below 4000');
    expect(v.decision!.reasoning).toEqual(['MACD BUY (4000.00) is fresh', '4001.00 is 4001']);
  });
  it('accepts WAIT without levels', () => {
    const v = validateAiDecision({ ...base, action: 'WAIT', entryLevel: '', stopLevel: '', targetLevels: [], waitFor: 'x' }, levels, inp);
    expect(v.decision?.action).toBe('WAIT');
    expect(v.decision?.entry).toBeNull();
  });
});

describe('AI provider selection', () => {
  it('prefers a Gemini key, falls back to Anthropic, and honours LLM_PROVIDER', async () => {
    const { createProvider } = await import('../src/server/llm');
    expect(createProvider({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).status()).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash', configured: true });
    expect(createProvider({ GEMINI_API_KEY: ' g ', GEMINI_MODEL: 'gemini-x' }).status().model).toBe('gemini-x');
    expect(createProvider({ GEMINI_API_KEY: '', ANTHROPIC_API_KEY: 'a' }).status().provider).toBe('anthropic');
    expect(createProvider({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'anthropic' }).status().provider).toBe('anthropic');
    expect(createProvider({ LLM_PROVIDER: 'none', GEMINI_API_KEY: 'g' }).status().configured).toBe(false);
  });
});

describe('analyst panel', () => {
  const plan = (action: AnalystDecision['action'], o: Partial<AnalystDecision> = {}): AnalystDecision => ({
    action,
    timeframe: '15',
    entryType: action === 'WAIT' ? 'none' : 'market',
    entry: action === 'WAIT' ? null : 4000,
    stopLoss: action === 'WAIT' ? null : action === 'BUY' ? 3990 : 4010,
    takeProfits: action === 'WAIT' ? [] : [action === 'BUY' ? 4020 : 3980],
    rewardRisk: action === 'WAIT' ? null : 2,
    confidence: 'high',
    headline: `${action} headline`,
    reasoning: [],
    risks: [`${action} risk`],
    invalidation: '',
    waitFor: action === 'WAIT' ? 'close above 4010' : '',
    basedOn: [],
    measuredChance: null,
    ...o,
  });
  const v = (id: string, d: AnalystDecision | null) => ({ id, name: id, model: null, decision: d });

  it('trades when every analyst agrees, using the strongest analyst’s levels', () => {
    const r = combinePanel([v('rules', plan('BUY', { confidence: 'medium', rewardRisk: 1.5 })), v('a', plan('BUY', { rewardRisk: 3, entry: 3999 })), v('b', plan('BUY', { confidence: 'low' }))]);
    expect(r.action).toBe('BUY');
    expect(r.summary).toBe('3 of 3 analysts say BUY.');
    expect(r.chosenFrom).toBe('a');
    expect(r.decision.entry).toBe(3999);
    expect(r.decision.confidence).toBe('high');
  });
  it('trades on a majority with the rest waiting, at reduced confidence', () => {
    const r = combinePanel([v('rules', plan('WAIT')), v('a', plan('SELL')), v('b', plan('SELL'))]);
    expect(r.action).toBe('SELL');
    expect(r.decision.confidence).toBe('medium');
    expect(r.summary).toBe('2 of 3 analysts say SELL (2 say SELL, 1 says WAIT).');
  });
  it('waits when any of three analysts points the other way', () => {
    const r = combinePanel([v('rules', plan('BUY')), v('a', plan('BUY')), v('b', plan('SELL'))]);
    expect(r.action).toBe('WAIT');
    expect(r.decision.headline).toMatch(/opposite directions/);
    expect(r.decision.risks).toEqual(['BUY risk', 'SELL risk']);
  });
  it('tolerates one dissenter among four or more', () => {
    expect(combinePanel([v('r', plan('BUY')), v('a', plan('BUY')), v('b', plan('BUY')), v('c', plan('SELL'))]).action).toBe('BUY');
    expect(combinePanel([v('r', plan('BUY')), v('a', plan('BUY')), v('b', plan('SELL')), v('c', plan('SELL'))]).action).toBe('WAIT');
  });
  it('ignores failed analysts and needs a majority of the ones that answered', () => {
    const r = combinePanel([v('rules', plan('WAIT')), v('a', plan('BUY')), v('b', null), v('c', null)]);
    expect(r.counted).toBe(2);
    expect(r.action).toBe('WAIT');
    expect(r.waitFor).toEqual(['close above 4010']);
    expect(r.decision.reasoning).toEqual(['rules: WAIT — WAIT headline', 'a: BUY — BUY headline']);
  });
});

describe('market context and compact evidence', () => {
  const regime = (r: string, d1: number) => ({ last: 1, lastTime: 0, change: { d1, w1: 1.234, m1: null, m3: null }, aboveSma50: true, aboveSma200: true, efficiency20: 0.4, rsi14: 55.555, vol20Ann: 10, volPercentile: 50, regime: r, volatility: 'Normal', suggestedTemplates: [], rationale: '' });
  const report = (createdAt: string): ContextReport => ({
    createdAt,
    markets: [
      { symbol: 'XAUUSD', name: 'Gold', ok: true, regime: regime('Downtrend', -0.8) as never },
      { symbol: 'DXY', name: 'US Dollar Index', ok: true, regime: regime('Uptrend', 0.3) as never },
      { symbol: 'US10Y', name: 'US 10Y yield', ok: false },
      { symbol: 'EURUSD', name: 'EUR/USD', ok: true, regime: regime('Range', 0) as never },
    ],
    newsByAsset: { XAUUSD: [{ title: 'Gold slips as dollar firms', link: '', source: 'X', category: '', published: Date.parse('2026-10-27T10:00:00Z') }] },
    overallTone: 0.123,
  });
  it('maps gold tickers to the gold research entry', () => {
    for (const t of ['XAUUSDT', 'XAUUSD', 'PAXGUSDT', 'GC=F']) expect(researchSymbolFor(t)).toBe('XAUUSD');
    expect(researchSymbolFor('EUR/USD')).toBe('EURUSD');
    expect(researchSymbolFor('AAPL')).toBeNull();
  });
  it('takes the asset, the dollar and yields from a fresh report and skips a stale one', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    const c = marketContextFrom(report('2026-10-27T08:00:00Z'), 'XAUUSDT', now)!;
    expect(c.daily.map((d) => d.symbol)).toEqual(['XAUUSD', 'DXY']);
    expect(c.daily[0]).toMatchObject({ regime: 'Downtrend', change1dPct: -0.8, change1wPct: 1.23, rsi14: 55.56 });
    expect(c.headlines).toEqual([{ title: 'Gold slips as dollar firms', source: 'X', hoursAgo: 2 }]);
    expect(marketContextFrom(report('2026-10-25T08:00:00Z'), 'XAUUSDT', now)).toBeNull();
  });
  it('compact evidence keeps every live-signal level and only the nearest triggers', () => {
    const frames = agreeingBuy();
    frames[1].triggers = [{ strategyId: 'ema_trend', strategyName: 'EMA', triggers: Array.from({ length: 12 }, (_, i) => ({ action: 'BUY' as const, from: 4002 + i * 5, to: null, stop: 3990, targets: [4100], blockedReason: null })) }];
    const inp = input(frames);
    const levels = buildLevels(inp);
    const full = evidenceForPrompt(inp, levels);
    const small = evidenceForPrompt(inp, levels, { compact: true }) as { levels: { id: string }[]; timeframes: { active: unknown[]; quiet: string[] }[] };
    expect(full.levels.filter((l) => l.kind === 'trigger')).toHaveLength(12);
    expect(small.levels.filter((l) => l.id.startsWith('X'))).toHaveLength(8);
    expect(small.levels.filter((l) => l.id.startsWith('E'))).toHaveLength(full.levels.filter((l) => l.kind === 'entry').length);
    expect(small.timeframes[0].active).toHaveLength(2);
    expect(small.timeframes[0].quiet).toEqual(['bb_meanrev']);
    expect(JSON.stringify(small).length).toBeLessThan(JSON.stringify(full).length);
  });
});

describe('AI analyst registry', () => {
  it('adds one analyst per free key (two for Gemini) and never exposes keys', async () => {
    const { analystsFromEnv, analystCatalog } = await import('../src/server/llm');
    expect(analystsFromEnv({}).length).toBe(0);
    const env = { GEMINI_API_KEY: '"g"', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o', OLLAMA_MODEL: 'qwen3:8b', ANTHROPIC_API_KEY: 'a', AI_ANALYSTS_OFF: 'anthropic' };
    const m = analystsFromEnv(env);
    expect(m.map((x) => x.id)).toEqual(['gemini', 'gemini-2', 'groq', 'openrouter', 'ollama']);
    expect(m.map((x) => x.llm.status().model)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'auto', 'auto', 'qwen3:8b']);
    expect(analystsFromEnv({ GEMINI_API_KEY: 'g', GEMINI_SECOND_MODEL: 'off' }).length).toBe(1);
    const cat = analystCatalog(env);
    expect(cat.find((c) => c.id === 'groq')).toMatchObject({ configured: true, envKey: 'GROQ_API_KEY' });
    expect(cat.find((c) => c.id === 'mistral')?.configured).toBe(false);
    expect(cat.find((c) => c.id === 'anthropic')?.configured).toBe(false);
    expect(JSON.stringify(cat)).not.toMatch(/"g"|"q"/);
  });
  it('reads JSON after a reasoning model’s <think> block', async () => {
    const { extractJson } = await import('../src/server/llm');
    expect(extractJson<{ a: number }>('<think>maybe {x} or {y}</think>\n{"a": 1}')).toEqual({ a: 1 });
  });
});
