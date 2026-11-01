// Trade analyst: turns every strategy's signals on several timeframes into ONE entry decision.
// The AI (when configured) reasons over this evidence; it can only pick price levels by id from the candidate list
// below, and every decision — AI or rule-based — is validated here before it is shown.
import type { CalendarEvent, NewsItem, RegimeResult } from './research';
import type { StrategySignal } from './signals';
import type { Trigger } from './outlook';
import { WHY } from './plans';

export type Action = 'BUY' | 'SELL' | 'WAIT';

export interface Level {
  id: string;
  kind: 'entry' | 'stop' | 'target' | 'trigger' | 'market';
  price: number;
  dir: 1 | -1 | 0;
  tf: string;
  strategyId: string | null;
  note: string;
}

export interface FrameEvidence {
  tf: string;
  dataStatus: string;
  signals: StrategySignal[];
  triggers: { strategyId: string; strategyName: string; triggers: Trigger[] }[];
}

export interface AnalystInput {
  ticker: string;
  price: number;
  change24hPct: number | null;
  focusTf: string;
  frames: FrameEvidence[];
  events: CalendarEvent[];
  /** Daily background from the latest research report (optional; never supplies prices). */
  context?: MarketContext | null;
  now?: number;
}

/** The bigger picture: daily trend of the asset and its main drivers, plus recent headlines. */
export interface MarketContext {
  asOf: string;
  daily: { symbol: string; name: string; regime: string; volatility: string; change1dPct: number | null; change1wPct: number | null; rsi14: number | null; note: string }[];
  headlines: { title: string; source: string; hoursAgo: number | null }[];
  newsTone: number | null;
}

export interface AnalystDecision {
  action: Action;
  timeframe: string;
  entryType: 'market' | 'limit' | 'stop' | 'none';
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  rewardRisk: number | null;
  confidence: 'low' | 'medium' | 'high';
  headline: string;
  reasoning: string[];
  risks: string[];
  invalidation: string;
  waitFor: string;
  basedOn: string[];
  /** Measured chance of profit of the main strategy (share of its past trades here that made money). */
  measuredChance: { p: number; n: number } | null;
}

/** Raw shape the AI returns: levels are referenced by id, never typed in as numbers. */
export interface AiDecision {
  action: Action;
  timeframe: string;
  entryLevel: string;
  stopLevel: string;
  targetLevels: string[];
  confidence: 'low' | 'medium' | 'high';
  headline: string;
  reasoning: string[];
  risks: string[];
  invalidation: string;
  waitFor: string;
  basedOn: string[];
}

export const AI_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'timeframe', 'entryLevel', 'stopLevel', 'targetLevels', 'confidence', 'headline', 'reasoning', 'risks', 'invalidation', 'waitFor', 'basedOn'],
  properties: {
    action: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
    timeframe: { type: 'string', description: 'Chart timeframe the plan is for, e.g. "15" or "60".' },
    entryLevel: { type: 'string', description: 'Id of an entry/trigger level, "MARKET" to enter at the current price, or "" for WAIT.' },
    stopLevel: { type: 'string', description: 'Id of a stop level, or "" for WAIT.' },
    targetLevels: { type: 'array', items: { type: 'string' }, description: 'Ids of target levels, nearest first. Empty for WAIT.' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    headline: { type: 'string', description: 'One short sentence a beginner understands.' },
    reasoning: { type: 'array', items: { type: 'string' }, description: '3–6 short points citing the evidence (strategies, timeframes, measured numbers).' },
    risks: { type: 'array', items: { type: 'string' }, description: 'What could go wrong: opposing signals, news, small samples, late entry.' },
    invalidation: { type: 'string', description: 'What would cancel the idea, with a price.' },
    waitFor: { type: 'string', description: 'For WAIT (or a limit entry): the exact condition/price to wait for. Otherwise "".' },
    basedOn: { type: 'array', items: { type: 'string' }, description: 'Strategy ids that the decision relies on.' },
  },
} as const;

const TF_WEIGHT: Record<string, number> = { '1': 0.3, '3': 0.4, '5': 0.5, '15': 1, '30': 1.25, '60': 1.5, '120': 1.75, '240': 2, '1D': 2.5 };
const tfName = (tf: string) => (/^\d+$/.test(tf) ? (Number(tf) >= 60 && Number(tf) % 60 === 0 ? `${Number(tf) / 60}H` : `${tf}m`) : tf);
const round = (x: number) => Math.round(x * 100) / 100;

/** Every real price the plan may use, with a short id. */
export function buildLevels(input: AnalystInput): Level[] {
  const out: Level[] = [{ id: 'MARKET', kind: 'market', price: input.price, dir: 0, tf: input.focusTf, strategyId: null, note: 'current price' }];
  let n = 0;
  for (const f of input.frames) {
    for (const s of f.signals) {
      if ((s.state !== 'BUY' && s.state !== 'SELL') || s.entry === null || s.stop === null) continue;
      const dir = s.state === 'BUY' ? 1 : -1;
      const k = ++n;
      out.push({ id: `E${k}`, kind: 'entry', price: s.entry, dir, tf: f.tf, strategyId: s.strategyId, note: `${s.strategyName} ${s.state} entry on ${tfName(f.tf)}` });
      out.push({ id: `S${k}`, kind: 'stop', price: s.stop, dir, tf: f.tf, strategyId: s.strategyId, note: `${s.strategyName} stop on ${tfName(f.tf)}` });
      s.targets.forEach((t, j) => out.push({ id: `T${k}${'abc'[j] ?? j}`, kind: 'target', price: t, dir, tf: f.tf, strategyId: s.strategyId, note: `${s.strategyName} target ${j + 1} on ${tfName(f.tf)}` }));
    }
    for (const g of f.triggers) {
      for (const tr of g.triggers) {
        if (tr.blockedReason) continue;
        const edge = tr.action === 'BUY' ? (tr.from ?? tr.to) : (tr.to ?? tr.from);
        if (edge === null) continue;
        const dir = tr.action === 'BUY' ? 1 : -1;
        const k = ++n;
        out.push({ id: `X${k}`, kind: 'trigger', price: edge, dir, tf: f.tf, strategyId: g.strategyId, note: `${g.strategyName}: ${tr.action} if the ${tfName(f.tf)} candle closes ${dir === 1 ? 'at or above' : 'at or below'} this price` });
        if (tr.stop !== null) out.push({ id: `S${k}`, kind: 'stop', price: tr.stop, dir, tf: f.tf, strategyId: g.strategyId, note: `stop for trigger X${k}` });
        tr.targets.forEach((t, j) => out.push({ id: `T${k}${'abc'[j] ?? j}`, kind: 'target', price: t, dir, tf: f.tf, strategyId: g.strategyId, note: `target ${j + 1} for trigger X${k}` }));
      }
    }
  }
  return out;
}

/** Compact evidence for the AI prompt (and the UI): what each strategy says on each timeframe and how reliable it has been. */
export function evidenceForPrompt(input: AnalystInput, levels: Level[], opts: { compact?: boolean } = {}) {
  const now = input.now ?? Date.now();
  if (opts.compact) return compactEvidence(input, levels, now);
  return {
    instrument: input.ticker,
    currentPrice: input.price,
    change24hPct: input.change24hPct,
    focusTimeframe: tfName(input.focusTf),
    timeframes: input.frames.map((f) => ({
      timeframe: tfName(f.tf),
      tfCode: f.tf,
      dataStatus: f.dataStatus,
      strategies: f.signals.map((s) => ({
        id: s.strategyId,
        name: s.strategyName,
        family: s.family,
        designedForThisTimeframe: s.tfOk,
        state: s.state,
        stage: s.stage === 'setup' ? `setting up ${s.setupDir === 1 ? 'BUY' : 'SELL'}` : s.stage,
        signalAgeCandles: s.barsSinceSignal,
        entryLevel: s.state !== 'NO TRADE' ? levels.find((l) => l.kind === 'entry' && l.strategyId === s.strategyId && l.tf === f.tf)?.id ?? null : null,
        why: s.state !== 'NO TRADE' ? WHY[s.strategyId]?.(s.state === 'BUY' ? 1 : -1) ?? null : null,
        trackRecord: {
          pastTrades: s.all.trades,
          chanceOfProfit: s.probability.all ? round(s.probability.all.p) : null,
          chanceRange95: s.probability.all ? [round(s.probability.all.lo), round(s.probability.all.hi)] : null,
          recentChanceOfProfit: s.probability.outOfSample ? round(s.probability.outOfSample.p) : null,
          recentTrades: s.outOfSample.trades,
          avgResultPerTradeR: s.all.expectancyR !== null ? round(s.all.expectancyR) : null,
          recentAvgResultPerTradeR: s.outOfSample.expectancyR !== null ? round(s.outOfSample.expectancyR) : null,
        },
      })),
    })),
    upcomingHighImpactNews: input.events
      .filter((e) => e.impact === 'High' && e.time >= now - 3600_000 && e.time <= now + 36 * 3600_000)
      .slice(0, 8)
      .map((e) => ({ country: e.country, title: e.title, inHours: round((e.time - now) / 3600_000) })),
    levels: levels.map((l) => ({ id: l.id, kind: l.kind, price: l.price, direction: l.dir === 1 ? 'BUY' : l.dir === -1 ? 'SELL' : 'either', timeframe: tfName(l.tf), note: l.note })),
    marketContext: input.context ?? null,
  };
}

/**
 * About a third of the full evidence, for free tiers that allow only a few thousand tokens per minute:
 * quiet strategies are listed by name only and just the 8 trigger prices nearest to the market are kept.
 */
function compactEvidence(input: AnalystInput, levels: Level[], now: number) {
  const trig = levels.filter((l) => l.kind === 'trigger').sort((a, b) => Math.abs(a.price - input.price) - Math.abs(b.price - input.price));
  const keep = new Set(trig.slice(0, 8).map((l) => l.id.slice(1)));
  const kept = levels.filter((l) => {
    if (l.kind === 'market' || l.kind === 'entry') return true;
    const k = /^[STX](\d+)/.exec(l.id)?.[1];
    // Stops/targets of live signals share their number with an E level; trigger ones with an X level.
    return !!k && (levels.some((x) => x.id === `E${k}`) || keep.has(k));
  });
  return {
    legend: 'chance = share of past trades here that made money (chanceOfProfit); trades = number of past trades; avgR / recentAvgR = average result per trade in risk units (avgResultPerTrade), all / recent; fitsTf = strategy designed for this timeframe; age = candles since the signal; quiet = strategies with no signal.',
    instrument: input.ticker,
    currentPrice: input.price,
    change24hPct: input.change24hPct,
    focusTimeframe: tfName(input.focusTf),
    timeframes: input.frames.map((f) => ({
      timeframe: tfName(f.tf),
      tfCode: f.tf,
      dataStatus: f.dataStatus,
      active: f.signals
        .filter((s) => s.state !== 'NO TRADE' || s.stage === 'setup')
        .map((s) => ({
          id: s.strategyId,
          family: s.family,
          fitsTf: s.tfOk,
          state: s.state === 'NO TRADE' ? `setting up ${s.setupDir === 1 ? 'BUY' : 'SELL'}` : s.state,
          age: s.barsSinceSignal,
          entryLevel: s.state !== 'NO TRADE' ? levels.find((l) => l.kind === 'entry' && l.strategyId === s.strategyId && l.tf === f.tf)?.id ?? null : null,
          chance: s.probability.all ? round(s.probability.all.p) : null,
          trades: s.all.trades,
          avgR: s.all.expectancyR !== null ? round(s.all.expectancyR) : null,
          recentAvgR: s.outOfSample.expectancyR !== null ? round(s.outOfSample.expectancyR) : null,
        })),
      quiet: f.signals.filter((s) => s.state === 'NO TRADE' && s.stage !== 'setup').map((s) => s.strategyId),
    })),
    upcomingHighImpactNews: input.events
      .filter((e) => e.impact === 'High' && e.time >= now - 3600_000 && e.time <= now + 36 * 3600_000)
      .slice(0, 5)
      .map((e) => ({ country: e.country, title: e.title, inHours: round((e.time - now) / 3600_000) })),
    levels: kept.map((l) => ({ id: l.id, kind: l.kind, price: l.price, dir: l.dir === 1 ? 'BUY' : l.dir === -1 ? 'SELL' : 'either', tf: tfName(l.tf) })),
    marketContext: input.context ? { ...input.context, headlines: input.context.headlines.slice(0, 4) } : null,
  };
}

/** Research-report shape used for the market context (a subset of the server's ResearchReport). */
export interface ContextReport {
  createdAt: string;
  markets: { symbol: string; name: string; ok: boolean; regime?: RegimeResult }[];
  newsByAsset: Record<string, NewsItem[]>;
  overallTone: number | null;
}

/** Which research-watchlist symbol an instrument belongs to (gold tickers → XAUUSD, etc.). */
export function researchSymbolFor(ticker: string): string | null {
  const t = ticker.toUpperCase();
  if (/XAU|PAXG|^GC|GOLD|GLD/.test(t)) return 'XAUUSD';
  if (/BTC/.test(t)) return 'BTCUSD';
  if (/ETH/.test(t)) return 'ETHUSD';
  for (const fx of ['EURUSD', 'GBPUSD', 'USDJPY']) if (t.replace(/[^A-Z]/g, '').includes(fx)) return fx;
  if (/SPX|SPY|ES1|US500/.test(t)) return 'SPX';
  if (/NDX|QQQ|NQ1|US100/.test(t)) return 'NDX';
  return null;
}

/** Daily background for the analysts from a research report no older than `maxAgeHours`. */
export function marketContextFrom(report: ContextReport | null | undefined, ticker: string, now = Date.now(), maxAgeHours = 24): MarketContext | null {
  if (!report || now - Date.parse(report.createdAt) > maxAgeHours * 3600_000) return null;
  const own = researchSymbolFor(ticker);
  // The asset itself plus what moves most dollar-priced assets: the dollar, US yields and fear (VIX).
  const wanted = [own, 'DXY', 'US10Y', 'VIX'].filter((x): x is string => !!x);
  const daily = wanted
    .map((sym) => report.markets.find((m) => m.symbol === sym && m.ok && m.regime && m.regime.regime !== 'Insufficient data'))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ symbol: m.symbol, name: m.name, regime: m.regime!.regime, volatility: m.regime!.volatility, change1dPct: m.regime!.change.d1 !== null ? round(m.regime!.change.d1) : null, change1wPct: m.regime!.change.w1 !== null ? round(m.regime!.change.w1) : null, rsi14: m.regime!.rsi14 !== null ? round(m.regime!.rsi14) : null, note: 'daily candles' }));
  const headlines = (own ? report.newsByAsset[own] ?? [] : [])
    .slice(0, 6)
    .map((n) => ({ title: n.title, source: n.source, hoursAgo: n.published ? round((now - n.published) / 3600_000) : null }));
  if (!daily.length && !headlines.length) return null;
  return { asOf: report.createdAt, daily, headlines, newsTone: report.overallTone !== null ? round(report.overallTone) : null };
}

export const ANALYST_SYSTEM = `You are a disciplined trading analyst inside a charting app. You receive the current output of several rule-based trading strategies on several timeframes for one instrument, each strategy's measured track record on this exact market and timeframe, the next trigger prices, upcoming high-impact news, and a numbered list of real price levels.

Decide ONE plan: BUY, SELL or WAIT.

Hard rules:
- Use only the evidence given. Never invent prices, indicators, news or statistics.
- Choose prices ONLY by level id from "levels" (or "MARKET" for the current price). Entry, stop and targets must belong to the same direction; for BUY stop < entry < targets, for SELL the opposite.
- WAIT is the right answer when evidence conflicts, signals are weak or old, the price has already moved far from the entry, or high-impact news is imminent. When you WAIT, say in waitFor exactly which price/condition would change your mind, using trigger levels when available.
- Weigh higher timeframes more than lower ones. Strategies of the same family are not independent confirmation. Strategies not designed for a timeframe count little.
- Treat chanceOfProfit together with avgResultPerTrade and the number of past trades: fewer than 20 trades is weak evidence. A low chance of profit can still be fine if wins are much larger than losses; a negative average result is a warning.
- Never promise profit. Confidence (low/medium/high) describes how strong and consistent the evidence is, not a probability.
- Write for a beginner: short, plain sentences. Cite the numbers you used.
- marketContext (when present) is the daily background: the asset's daily trend, the US dollar (DXY), US 10-year yields, VIX and recent headlines. Gold usually moves opposite to the dollar and to real yields. Use it to judge whether a short-term trade goes with or against the bigger picture (against it = lower confidence or WAIT). It never supplies entry, stop or target prices, and headlines are only titles: do not invent what they say.
- Level ids (E1, S1, T1a, X1, MARKET) are only for the entryLevel/stopLevel/targetLevels fields. In every text field write the price itself (e.g. "4017.62"), never a level id.`;

/** Turns an AI reply into a validated decision, or returns the reasons it was rejected. */
export function validateAiDecision(ai: AiDecision, levels: Level[], input: AnalystInput): { decision: AnalystDecision | null; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map(levels.map((l) => [l.id, l]));
  const tfOk = input.frames.some((f) => f.tf === ai.timeframe || tfName(f.tf) === ai.timeframe);
  const tf = input.frames.find((f) => f.tf === ai.timeframe || tfName(f.tf) === ai.timeframe)?.tf ?? input.focusTf;
  if (!tfOk) problems.push(`Unknown timeframe "${ai.timeframe}".`);
  // Backstop: any level id left in the text is replaced by its price, so the reader sees numbers, not codes.
  const plain = (txt: string) => txt.replace(/\b(MARKET|[ESX]\d+|T\d+[a-z]?)\b(\s*\(([\d.,]+)\))?/g, (m, id: string, withPrice?: string) => {
    const l = byId.get(id);
    if (!l) return m;
    return withPrice ? withPrice.trim().replace(/^\(|\)$/g, '') : l.price.toFixed(2);
  });
  const base = { timeframe: tf, confidence: ai.confidence, headline: plain(ai.headline), reasoning: ai.reasoning.slice(0, 8).map(plain), risks: ai.risks.slice(0, 8).map(plain), invalidation: plain(ai.invalidation), waitFor: plain(ai.waitFor), basedOn: ai.basedOn.filter((id) => input.frames.some((f) => f.signals.some((s) => s.strategyId === id))) };
  if (ai.action === 'WAIT') return { decision: { ...base, action: 'WAIT', entryType: 'none', entry: null, stopLoss: null, takeProfits: [], rewardRisk: null, measuredChance: null }, problems };
  const dir = ai.action === 'BUY' ? 1 : -1;
  const entry = byId.get(ai.entryLevel);
  const stop = byId.get(ai.stopLevel);
  const targets = ai.targetLevels.map((id) => byId.get(id));
  if (!entry || !['entry', 'trigger', 'market'].includes(entry.kind)) problems.push(`Entry "${ai.entryLevel}" is not an entry level.`);
  if (!stop || stop.kind !== 'stop') problems.push(`Stop "${ai.stopLevel}" is not a stop level.`);
  if (!targets.length || targets.some((t) => !t || t.kind !== 'target')) problems.push('Targets must be target levels.');
  for (const l of [entry, stop, ...targets]) if (l && l.dir !== 0 && l.dir !== dir) problems.push(`Level ${l.id} belongs to the other direction.`);
  if (problems.length) return { decision: null, problems };
  const e = entry!.price;
  const sl = stop!.price;
  const tps = targets.map((t) => t!.price).sort((a, b) => dir * (a - b));
  if (dir * (e - sl) <= 0) problems.push('Stop is on the wrong side of the entry.');
  if (tps.some((t) => dir * (t - e) <= 0)) problems.push('A target is on the wrong side of the entry.');
  const rr = Math.abs(tps[tps.length - 1] - e) / Math.abs(e - sl);
  if (!(rr >= 1)) problems.push(`Reward is smaller than the risk (${rr.toFixed(2)}×).`);
  // A market entry must still be valid at the current price.
  if (entry!.kind === 'market' && dir * (input.price - sl) <= 0) problems.push('The price is already beyond the stop.');
  if (problems.length) return { decision: null, problems };
  const main = mainSignal(input, base.basedOn, dir, tf);
  return {
    decision: { ...base, action: ai.action, entryType: entry!.kind === 'market' ? 'market' : entry!.kind === 'trigger' ? 'stop' : dir * (input.price - e) > 0 ? 'limit' : 'market', entry: e, stopLoss: sl, takeProfits: tps, rewardRisk: rr, measuredChance: main?.probability.all ? { p: main.probability.all.p, n: main.probability.all.n } : null },
    problems,
  };
}

function mainSignal(input: AnalystInput, ids: string[], dir: 1 | -1, tf: string): StrategySignal | null {
  const sigs = input.frames.flatMap((f) => f.signals.map((s) => ({ s, tf: f.tf }))).filter((x) => ids.includes(x.s.strategyId) && x.s.state === (dir === 1 ? 'BUY' : 'SELL'));
  return (sigs.find((x) => x.tf === tf) ?? sigs[0])?.s ?? null;
}

/** Quality weight of one signal: track record, design fit and age. */
function quality(s: StrategySignal): number {
  let w = 1;
  const p = s.probability.all;
  const exp = s.all.expectancyR;
  if (p && p.n >= 20) w *= exp !== null && exp > 0 ? 1.5 : exp !== null && exp < 0 ? 0.5 : 1;
  if (!s.tfOk) w *= 0.3;
  if ((s.barsSinceSignal ?? 0) > 50) w *= 0.5;
  return w;
}

/**
 * Deterministic analyst used without an AI key (and as the fallback when an AI answer fails validation).
 * Families vote once per timeframe; higher timeframes weigh more; the direction needs a clear majority.
 */
export function ruleBasedDecision(input: AnalystInput): AnalystDecision {
  const now = input.now ?? Date.now();
  let net = 0;
  let total = 0;
  const perTf: { tf: string; score: number }[] = [];
  for (const f of input.frames) {
    const fam = new Map<string, number>();
    for (const s of f.signals) {
      const v = s.state === 'BUY' ? quality(s) : s.state === 'SELL' ? -quality(s) : s.stage === 'setup' ? 0.3 * s.setupDir : 0;
      if (!v) continue;
      const prev = fam.get(s.family) ?? 0;
      fam.set(s.family, Math.abs(v) > Math.abs(prev) ? v : prev);
    }
    const score = [...fam.values()].reduce((a, b) => a + b, 0);
    const w = TF_WEIGHT[f.tf] ?? 1;
    perTf.push({ tf: f.tf, score });
    net += score * w;
    total += [...fam.values()].reduce((a, b) => a + Math.abs(b), 0) * w;
  }
  const agreement = total > 0 ? Math.abs(net) / total : 0;
  const dir: 1 | -1 = net >= 0 ? 1 : -1;
  const side = dir === 1 ? 'BUY' : 'SELL';
  // Gold and most instruments here are priced in US dollars, so US high-impact news is what moves them most.
  const news = input.events.filter((e) => e.impact === 'High' && (e.country === 'USD' || e.country === 'All') && e.time >= now - 1800_000 && e.time <= now + 4 * 3600_000);
  const tfList = perTf.map((x) => `${tfName(x.tf)} ${x.score > 0.2 ? 'leans BUY' : x.score < -0.2 ? 'leans SELL' : 'neutral'}`).join(', ');
  const risks: string[] = [];
  if (news.length) risks.push(`High-impact news soon: ${news.map((e) => `${e.country} ${e.title} in ${Math.max(0, Math.round((e.time - now) / 60000))} min`).join('; ')}. Prices can jump past stops.`);
  const stale = input.frames.filter((f) => f.dataStatus !== 'live');
  if (stale.length) risks.push(`Data is not live on ${stale.map((f) => tfName(f.tf)).join(', ')}.`);

  // Candidate trades in the chosen direction, best first: focus timeframe and designed-for timeframes preferred.
  const cands = input.frames
    .flatMap((f) => f.signals.filter((s) => s.state === side && s.entry !== null && s.stop !== null).map((s) => ({ s, tf: f.tf })))
    .sort((a, b) => quality(b.s) + (b.tf === input.focusTf ? 0.5 : 0) + (TF_WEIGHT[b.tf] ?? 1) * 0.2 - (quality(a.s) + (a.tf === input.focusTf ? 0.5 : 0) + (TF_WEIGHT[a.tf] ?? 1) * 0.2));
  const best = cands[0];
  const nextTrig = input.frames
    .flatMap((f) => f.triggers.flatMap((g) => g.triggers.filter((t) => !t.blockedReason).map((t) => ({ t, f, g }))))
    .map((x) => ({ ...x, edge: (x.t.action === 'BUY' ? (x.t.from ?? x.t.to) : (x.t.to ?? x.t.from)) ?? NaN }))
    .filter((x) => Number.isFinite(x.edge))
    .sort((a, b) => Math.abs(a.edge - input.price) - Math.abs(b.edge - input.price))[0];
  const waitText = nextTrig ? `${nextTrig.t.action} if the ${tfName(nextTrig.f.tf)} candle closes ${nextTrig.t.action === 'BUY' ? 'above' : 'below'} ${nextTrig.edge.toFixed(2)} (${nextTrig.g.strategyName}).` : 'A new confirmed signal on 15m or higher.';

  const wait = (headline: string, why: string[]): AnalystDecision => ({
    action: 'WAIT',
    timeframe: input.focusTf,
    entryType: 'none',
    entry: null,
    stopLoss: null,
    takeProfits: [],
    rewardRisk: null,
    confidence: 'low',
    headline,
    reasoning: [`Timeframes: ${tfList}.`, ...why],
    risks,
    invalidation: '',
    waitFor: waitText,
    basedOn: [],
    measuredChance: null,
  });
  if (!best || Math.abs(net) < 1 || agreement < 0.6) return wait('No clear trade: the strategies do not agree strongly enough.', [`Agreement is ${Math.round(agreement * 100)}% (needs 60%+), net score ${net.toFixed(1)} (needs ±1).`]);
  if (news.some((e) => e.time - now < 60 * 60_000)) return wait('Wait: high-impact news is less than an hour away.', [`The strategies lean ${side}, but news can move the price past any stop.`]);

  const s = best.s;
  const e = s.entry as number;
  const sl = s.stop as number;
  const risk = Math.abs(e - sl);
  const moved = (dir * (input.price - e)) / risk; // >0 = price already in profit direction
  const final = s.targets[s.targets.length - 1];
  if (dir * (input.price - sl) <= 0) return wait('Wait: the price is already past this trade’s stop.', [`${s.strategyName} ${side} from ${e.toFixed(2)} is invalid at the current price.`]);
  if (dir * (final - input.price) <= 0) return wait('Wait: the price already reached the final target.', [`${s.strategyName} ${side} has played out.`]);
  const marketRR = Math.abs(final - input.price) / Math.abs(input.price - sl);
  const useMarket = moved <= 0.25 && marketRR >= 1.5;
  const entry = useMarket ? input.price : e;
  const rr = Math.abs(final - entry) / Math.abs(entry - sl);
  const famAgree = new Set(input.frames.flatMap((f) => f.signals.filter((x) => x.state === side && x.tfOk).map((x) => x.family))).size;
  const opp = input.frames.flatMap((f) => f.signals.filter((x) => x.state === (dir === 1 ? 'SELL' : 'BUY') && x.tfOk).map((x) => `${x.strategyName} on ${tfName(f.tf)}`));
  if (opp.length) risks.push(`Opposite signals: ${opp.slice(0, 4).join(', ')}.`);
  const p = s.probability.all;
  if (!p || p.n < 20) risks.push(`${s.strategyName} has only ${p?.n ?? 0} past trades here — its numbers are rough.`);
  if (moved > 0.25) risks.push(`The price has already moved ${moved.toFixed(1)}× the risk in the trade’s favour; chasing it now gives a worse deal.`);
  const confidence: AnalystDecision['confidence'] = agreement >= 0.8 && famAgree >= 2 && !opp.length && p && p.n >= 20 && (s.all.expectancyR ?? 0) > 0 ? 'high' : agreement >= 0.7 && famAgree >= 2 ? 'medium' : 'low';
  return {
    action: side,
    timeframe: best.tf,
    entryType: useMarket ? 'market' : 'limit',
    entry,
    stopLoss: sl,
    takeProfits: s.targets,
    rewardRisk: rr,
    confidence,
    headline: useMarket ? `${side} now near ${entry.toFixed(2)} — ${s.strategyName} on ${tfName(best.tf)}, supported by ${famAgree} strategy famil${famAgree === 1 ? 'y' : 'ies'}.` : `${side}, but wait for the price to come back to ${e.toFixed(2)} — it has run ahead of the entry.`,
    reasoning: [
      `Timeframes: ${tfList}. Overall agreement ${Math.round(agreement * 100)}% for ${side}.`,
      `${s.strategyName} (${tfName(best.tf)}): ${WHY[s.strategyId]?.(dir) ?? s.reason}`,
      p ? `Its record here: ${Math.round(p.p * 100)}% of ${p.n} past trades made money, average ${s.all.expectancyR !== null ? s.all.expectancyR.toFixed(2) : '—'}R per trade.` : 'No measured track record on this market yet.',
      `Reward is ${rr.toFixed(1)}× the risk from ${useMarket ? 'the current price' : 'the entry'}.`,
    ],
    risks,
    invalidation: `A candle trading ${dir === 1 ? 'at or below' : 'at or above'} ${sl.toFixed(2)} (the stop).`,
    waitFor: useMarket ? '' : `A pullback to ${e.toFixed(2)} (limit order). If the price reaches ${s.targets[0].toFixed(2)} first, skip this trade.`,
    basedOn: [s.strategyId],
    measuredChance: p ? { p: p.p, n: p.n } : null,
  };
}

// ─── Analyst panel ───
// Several analysts (the rule-based one plus every configured AI) answer the same evidence; their validated answers
// are combined by vote. A trade needs a clear majority and almost no analyst pointing the other way.

export interface PanelVote {
  id: string;
  name: string;
  model: string | null;
  /** Validated decision, or null when the analyst failed (error) or its answer was rejected. */
  decision: AnalystDecision | null;
}

export interface PanelVerdict {
  action: Action;
  votes: Record<Action, number>;
  /** Analysts that gave a valid answer. */
  counted: number;
  /** Analysts behind the final action. */
  agree: number;
  /** One plain sentence, e.g. "3 of 4 analysts say BUY." */
  summary: string;
  /** The plan shown: levels from the strongest analyst on the winning side, or a WAIT. */
  decision: AnalystDecision;
  /** Which analyst's levels are shown. */
  chosenFrom: string | null;
  /** What each waiting analyst is watching for (deduplicated). */
  waitFor: string[];
}

const CONF: Record<AnalystDecision['confidence'], number> = { low: 1, medium: 2, high: 3 };
const CONF_NAME: AnalystDecision['confidence'][] = ['low', 'low', 'medium', 'high'];

export function combinePanel(votes: PanelVote[], focusTf = '15'): PanelVerdict {
  const valid = votes.filter((v): v is PanelVote & { decision: AnalystDecision } => !!v.decision);
  const n = valid.length;
  const count = (a: Action) => valid.filter((v) => v.decision.action === a).length;
  const tally: Record<Action, number> = { BUY: count('BUY'), SELL: count('SELL'), WAIT: count('WAIT') };
  const top: Action | null = tally.BUY > tally.SELL ? 'BUY' : tally.SELL > tally.BUY ? 'SELL' : null;
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const waitFor = uniq([...valid.filter((v) => v.decision.action === 'WAIT'), ...valid.filter((v) => v.decision.action !== 'WAIT')].map((v) => v.decision.waitFor)).slice(0, 4);
  const says = (a: Action) => `${tally[a]} say${tally[a] === 1 ? 's' : ''} ${a}`;
  const split = (['BUY', 'SELL', 'WAIT'] as Action[]).filter((a) => tally[a]).map(says).join(', ');

  if (top) {
    const opposite = tally[top === 'BUY' ? 'SELL' : 'BUY'];
    // Majority of all valid answers, and at most a quarter pointing the other way (with fewer than 4 analysts: none).
    if (tally[top] * 2 > n && opposite * 4 <= n) {
      const side = valid.filter((v) => v.decision.action === top);
      const best = [...side].sort((a, b) => CONF[b.decision.confidence] - CONF[a.decision.confidence] || (b.decision.timeframe === focusTf ? 1 : 0) - (a.decision.timeframe === focusTf ? 1 : 0) || (b.decision.rewardRisk ?? 0) - (a.decision.rewardRisk ?? 0))[0];
      const share = tally[top] / n;
      const panelConf = opposite ? 1 : share === 1 && n >= 3 ? 3 : share >= 2 / 3 ? 2 : 1;
      const confidence = CONF_NAME[Math.min(panelConf, CONF[best.decision.confidence])];
      return {
        action: top,
        votes: tally,
        counted: n,
        agree: tally[top],
        summary: `${tally[top]} of ${n} analysts say ${top}${tally[top] < n ? ` (${split})` : ''}.`,
        decision: { ...best.decision, confidence },
        chosenFrom: best.id,
        waitFor,
      };
    }
  }
  const conflict = tally.BUY > 0 && tally.SELL > 0;
  const headline = n === 0 ? 'No analyst could answer.' : conflict ? 'The analysts point in opposite directions, so there is no trade.' : tally.WAIT === n ? 'Every analyst says wait: there is no clear, agreed trade right now.' : tally.WAIT * 2 > n ? 'Most analysts say wait: there is no clear, agreed trade right now.' : 'No clear majority for a trade, so wait.';
  return {
    action: 'WAIT',
    votes: tally,
    counted: n,
    agree: tally.WAIT,
    summary: n ? `${tally.WAIT} of ${n} analysts say WAIT${tally.WAIT < n ? ` (${split})` : ''}.` : 'No analyst could answer.',
    decision: {
      action: 'WAIT',
      timeframe: focusTf,
      entryType: 'none',
      entry: null,
      stopLoss: null,
      takeProfits: [],
      rewardRisk: null,
      confidence: 'low',
      headline,
      reasoning: valid.map((v) => `${v.name}: ${v.decision.action} — ${v.decision.headline}`),
      risks: uniq(valid.flatMap((v) => v.decision.risks)).slice(0, 5),
      invalidation: '',
      waitFor: waitFor[0] ?? '',
      basedOn: uniq(valid.flatMap((v) => v.decision.basedOn)),
      measuredChance: null,
    },
    chosenFrom: null,
    waitFor,
  };
}
