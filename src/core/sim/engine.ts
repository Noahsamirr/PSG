// Runs a StrategySpec over OHLCV bars in the app, mirroring the generated Pine script so users can
// check signals before copying the code. It is a preview, not TradingView: see `notes` in the result.
import { getComponent } from '../components';
import { resolvedParams } from '../spec';
import { tfInfo } from '../generator';
import { tfInRange, tfLabel } from '../timeframe';
import type { Family, StrategySpec, VoterSpec } from '../types';
import { inSession, SIMS, type CompEvent, type CompSim, type Overlay } from './components';
import * as T from './series';
import type { B, Bar, S } from './series';

export type { Bar } from './series';

export interface Marker {
  bar: number;
  kind: 'entry' | 'strong' | 'agreement' | 'fill' | 'setup' | 'invalid' | 'blocked' | 'tp' | 'exit' | 'event';
  dir: 1 | -1 | 0;
  side: 'above' | 'below';
  text: string;
  detail: string;
  /** For exits: true when the trade made money (in R). */
  good?: boolean;
}

export interface SimTrade {
  dir: 1 | -1;
  signalBar: number;
  entryBar: number;
  entry: number;
  stop: number;
  /** Stop at entry, before breakeven/trailing moves. */
  initialStop: number;
  risk: number;
  qty: number;
  exitBar: number | null;
  exitPrice: number | null;
  reason: string;
  r: number | null; // result in R (gross)
  pnl: number | null; // currency, after commission
  partials: { bar: number; price: number; frac: number; label: string }[];
  strong: boolean;
}

export interface BarInfo {
  scoreL: number;
  scoreS: number;
  conds: { label: string; role: string; L: boolean; S: boolean }[];
  votes?: { name: string; family: Family; vote: 1 | -1 | 0; barsAgo: number | null }[];
  agreeL?: number;
  agreeS?: number;
  readouts: { label: string; value: string }[];
}

export interface SimResult {
  markers: Marker[];
  trades: SimTrade[];
  overlays: Overlay[];
  levels: { entry: S; stop: S; tp1: S; tp2: S; final: S };
  info: (i: number) => BarInfo;
  stats: {
    signals: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    totalR: number;
    avgR: number | null;
    netPnl: number;
    profitFactor: number | null;
    maxDrawdownPct: number;
    blocked: number;
    strongSignals: number;
  };
  notes: string[];
  tfOk: boolean;
  /** Position still open on the last bar (not yet stopped out or fully at target). */
  open: (SimTrade & { targets: number[]; filled: boolean }) | null;
}

export interface SimOptions {
  chartTf: string;
  pointValue?: number;
  mintick?: number;
  /** Quantity step used when the spec leaves it on auto (TradingView uses the symbol type). */
  qtyStep?: number;
  showEvents?: boolean;
}

interface VoterOut {
  sigL: B;
  sigS: B;
  setupL: B;
  setupS: B;
  expL: B;
  expS: B;
  scoreL: S;
  scoreS: S;
  conds: { ref: string; label: string; role: string; L: B; S: B }[];
  exitL: B;
  exitS: B;
}

function evalVoter(v: VoterSpec, sims: Record<string, CompSim>, spec: StrategySpec, n: number, cons: boolean): VoterOut {
  const resolved = v.conditions
    .filter((c) => c.enabled && !(cons && c.role === 'exit'))
    .map((c) => {
      const [id, cid] = c.ref.split('.');
      const inst = spec.components.find((x) => x.id === id);
      const def = inst ? getComponent(inst.type).conditions.find((x) => x.id === cid) : undefined;
      const arr = sims[id]?.conds[cid];
      if (!inst || !def || !arr) throw new Error(`Cannot evaluate condition ${c.ref}`);
      return { c, def, L: arr.L, S: arr.S };
    });
  const trig = resolved.filter((x) => x.c.role === 'trigger');
  const rules = resolved.filter((x) => x.c.role === 'filter' || x.c.role === 'confirmation');
  const exits = resolved.filter((x) => x.c.role === 'exit');
  const groups = new Map<string, typeof rules>();
  rules.forEach((r, k) => {
    const key = v.confluence.dedupeFamilies ? r.def.family : `${r.def.family}#${k}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });
  const den = [...groups.values()].reduce((a, g) => a + Math.max(...g.map((r) => r.c.weight)), 0);
  const score = (side: 'L' | 'S', i: number) => (den > 0 ? (100 * [...groups.values()].reduce((a, g) => a + Math.max(...g.map((r) => (r[side][i] ? r.c.weight : 0))), 0)) / den : 100);
  const win = v.confluence.confirmWindowBars;
  const out: VoterOut = { sigL: [], sigS: [], setupL: [], setupS: [], expL: [], expS: [], scoreL: [], scoreS: [], conds: resolved.map((r) => ({ ref: r.c.ref, label: r.def.label, role: r.c.role, L: r.L, S: r.S })), exitL: [], exitS: [] };
  let armL = -1;
  let armS = -1;
  for (let i = 0; i < n; i++) {
    const trigL = trig.some((t) => t.L[i]);
    const trigS = trig.some((t) => t.S[i]);
    const sL = score('L', i);
    const sS = score('S', i);
    const qual = (side: 'L' | 'S', sc: number) => {
      const all = rules.every((r) => r[side][i]);
      const mand = rules.filter((r) => r.c.mandatory).every((r) => r[side][i]);
      return v.confluence.mode === 'strict' ? all : v.confluence.mode === 'hybrid' ? mand && sc >= v.confluence.minScore : sc >= v.confluence.minScore;
    };
    const qL = qual('L', sL);
    const qS = qual('S', sS);
    // Long side
    if (trigL) armL = i;
    if (trigS && !trigL) armL = -1;
    const liveL = armL >= 0 && i - armL <= win;
    const sigL = liveL && qL;
    const expL = win > 0 && armL >= 0 && i - armL > win;
    if (sigL || expL) armL = -1;
    // Short side
    if (trigS) armS = i;
    if (trigL && !trigS) armS = -1;
    const liveS = armS >= 0 && i - armS <= win;
    const sigS = liveS && qS;
    const expS = win > 0 && armS >= 0 && i - armS > win;
    if (sigS || expS) armS = -1;
    out.sigL.push(sigL);
    out.sigS.push(sigS);
    out.setupL.push(trigL && !qL);
    out.setupS.push(trigS && !qS);
    out.expL.push(expL);
    out.expS.push(expS);
    out.scoreL.push(sL);
    out.scoreS.push(sS);
    out.exitL.push(exits.some((x) => x.L[i]));
    out.exitS.push(exits.some((x) => x.S[i]));
  }
  return out;
}

function decimals(bars: Bar[]): number {
  let d = 0;
  for (const b of bars.slice(-200)) {
    const s = String(b.c);
    const k = s.includes('.') ? s.split('.')[1].length : 0;
    d = Math.max(d, Math.min(k, 8));
  }
  return d;
}

export function runSimulation(spec: StrategySpec, bars: Bar[], opts: SimOptions): SimResult {
  const n = bars.length;
  const notes: string[] = [];
  const isStrat = spec.output === 'strategy';
  const cons = spec.consensus.enabled && spec.strategies.length > 1;
  const voters = cons ? spec.strategies : spec.strategies.slice(0, 1);
  const r = spec.risk;
  const mintick = opts.mintick ?? 10 ** -decimals(bars);
  const pv = opts.pointValue ?? 1;

  // Components
  const ctx = { bars, chartTf: opts.chartTf };
  const sims: Record<string, CompSim> = {};
  for (const inst of spec.components) sims[inst.id] = SIMS[inst.type](ctx, resolvedParams(inst));
  const vo = voters.map((v) => evalVoter(v, sims, spec, n, cons));

  // Signal selection
  let longSignal: B, shortSignal: B, longSetup: B, shortSetup: B, longInvalid: B, shortInvalid: B, scoreL: S, scoreS: S;
  let strongL: B = T.fill(n, 0).map(() => false);
  let strongS: B = strongL.slice();
  let strongLFirst: B = strongL.slice();
  let strongSFirst: B = strongL.slice();
  let voteInfo: ((i: number) => BarInfo['votes']) | null = null;
  if (!cons) {
    const v = vo[0];
    [longSignal, shortSignal, longSetup, shortSetup, longInvalid, shortInvalid, scoreL, scoreS] = [v.sigL, v.sigS, v.setupL, v.setupS, v.expL, v.expS, v.scoreL, v.scoreS];
  } else {
    const cs = spec.consensus;
    const bsL = vo.map((v) => T.barssince(v.sigL));
    const bsS = vo.map((v) => T.barssince(v.sigS));
    const vote = (k: number, i: number): 1 | -1 | 0 => {
      const a = bsL[k][i];
      const b = bsS[k][i];
      const lastL = !Number.isNaN(a) && (Number.isNaN(b) || a < b);
      const lastS = !Number.isNaN(b) && (Number.isNaN(a) || b < a);
      if (lastL && (cs.voteWindowBars <= 0 || a <= cs.voteWindowBars)) return 1;
      if (lastS && (cs.voteWindowBars <= 0 || b <= cs.voteWindowBars)) return -1;
      return 0;
    };
    const fams = [...new Set(voters.map((v) => v.family))];
    const agree = (i: number, side: 1 | -1) => {
      if (cs.perFamily) {
        const parts = fams.map((f) => {
          const ks = voters.map((v, k) => (v.family === f ? k : -1)).filter((k) => k >= 0);
          return ks.filter((k) => vote(k, i) === side).length / ks.length;
        });
        return (100 * parts.reduce((a, b) => a + b, 0)) / fams.length;
      }
      return (100 * voters.filter((_, k) => vote(k, i) === side).length) / voters.length;
    };
    scoreL = bars.map((_, i) => agree(i, 1));
    scoreS = bars.map((_, i) => agree(i, -1));
    strongL = scoreL.map((x, i) => x >= cs.strongThreshold && (!cs.vetoOnOpposite || scoreS[i] === 0));
    strongS = scoreS.map((x, i) => x >= cs.strongThreshold && (!cs.vetoOnOpposite || scoreL[i] === 0));
    const stdL = scoreL.map((x, i) => x >= cs.threshold && x > scoreS[i]);
    const stdS = scoreS.map((x, i) => x >= cs.threshold && x > scoreL[i]);
    const first = (a: B) => a.map((x, i) => x && !(i > 0 && a[i - 1]));
    strongLFirst = first(strongL);
    strongSFirst = first(strongS);
    const stdLFirst = first(stdL);
    const stdSFirst = first(stdS);
    const strongOnly = cs.tradeOn === 'strong';
    longSignal = strongOnly ? strongLFirst : stdLFirst.map((x, i) => x || strongLFirst[i]);
    shortSignal = strongOnly ? strongSFirst : stdSFirst.map((x, i) => x || strongSFirst[i]);
    longSetup = stdLFirst.map((x, i) => strongOnly && x && !strongL[i]);
    shortSetup = stdSFirst.map((x, i) => strongOnly && x && !strongS[i]);
    longInvalid = [];
    shortInvalid = [];
    let pendL = false;
    let pendS = false;
    for (let i = 0; i < n; i++) {
      const il = pendL && !stdL[i] && !strongL[i];
      const is = pendS && !stdS[i] && !strongS[i];
      longInvalid.push(il);
      shortInvalid.push(is);
      if (longSetup[i]) pendL = true;
      if (strongL[i] || il) pendL = false;
      if (shortSetup[i]) pendS = true;
      if (strongS[i] || is) pendS = false;
    }
    voteInfo = (i) => voters.map((v, k) => ({ name: v.name, family: v.family, vote: vote(k, i), barsAgo: vote(k, i) === 1 ? bsL[k][i] : vote(k, i) === -1 ? bsS[k][i] : null }));
  }
  const exitRuleL = cons ? T.fill(n, 0).map(() => false) : vo[0].exitL;
  const exitRuleS = cons ? T.fill(n, 0).map(() => false) : vo[0].exitS;

  // Risk engine
  const atrR = T.atr(bars, r.atrLength);
  const swLow = T.lowest(
    bars.map((b) => b.l),
    r.swingLookback,
  );
  const swHigh = T.highest(
    bars.map((b) => b.h),
    r.swingLookback,
  );
  let structL: S = T.fill(n);
  let structS: S = T.fill(n);
  outer: for (let k = 0; k < voters.length; k++) {
    for (const c of voters[k].conditions.filter((x) => x.enabled && x.role === 'trigger')) {
      const id = c.ref.split('.')[0];
      if (sims[id]?.stop) {
        structL = sims[id].stop!.L;
        structS = sims[id].stop!.S;
        break outer;
      }
    }
  }
  const stopL = bars.map((b, i) =>
    r.stopMode === 'Structure' ? (Number.isNaN(structL[i]) ? swLow[i] : structL[i]) - r.structureBufferAtr * atrR[i] : r.stopMode === 'Percent' ? b.c * (1 - r.stopPercent / 100) : r.stopMode === 'Ticks' ? b.c - r.stopTicks * mintick : b.c - r.atrMult * atrR[i],
  );
  const stopS = bars.map((b, i) =>
    r.stopMode === 'Structure' ? (Number.isNaN(structS[i]) ? swHigh[i] : structS[i]) + r.structureBufferAtr * atrR[i] : r.stopMode === 'Percent' ? b.c * (1 + r.stopPercent / 100) : r.stopMode === 'Ticks' ? b.c + r.stopTicks * mintick : b.c + r.atrMult * atrR[i],
  );
  const stopOk = (i: number, d: 1 | -1) => {
    const risk = d === 1 ? bars[i].c - stopL[i] : stopS[i] - bars[i].c;
    return !Number.isNaN(risk) && risk > 0 && (r.maxStopAtr <= 0 || risk <= r.maxStopAtr * atrR[i]);
  };
  const p1 = r.tpCount === 1 ? 1 : r.tpQtyPct[0] / 100;
  const p2 = r.tpCount === 3 ? Math.min(r.tpQtyPct[1] / 100, 1 - p1) : 0;
  const plannedRR = r.tpCount === 1 ? r.tpR[0] : r.tpCount === 2 ? p1 * r.tpR[0] + (1 - p1) * r.tpR[1] : p1 * r.tpR[0] + p2 * r.tpR[1] + (1 - p1 - p2) * r.tpR[2];
  const rrOk = plannedRR >= r.minRR;
  if (!rrOk) notes.push(`Planned R:R ${plannedRR.toFixed(2)} is below the minimum ${r.minRR}, so — like the script — no entries are taken.`);

  // Filters
  const ti = tfInfo(spec);
  const tfOk = tfInRange(opts.chartTf, [ti.min, ti.max]) !== false;
  const tfAllowed = ti.guard !== 'Block entries' || tfOk;
  if (!tfOk) notes.push(`Chart timeframe ${tfLabel(opts.chartTf)} is outside the designed range — the script shows a warning banner${tfAllowed ? '' : ' and blocks entries'}.`);
  const f = spec.filters;
  const start = Date.parse(spec.backtest.dateRange.start);
  const end = Date.parse(spec.backtest.dateRange.end) + 86399999;

  // Trade simulation
  const markers: Marker[] = [];
  const trades: SimTrade[] = [];
  const lv = { entry: T.fill(n), stop: T.fill(n), tp1: T.fill(n), tp2: T.fill(n), final: T.fill(n) };
  let equity = spec.backtest.initialCapital;
  let peak = equity;
  let maxDD = 0;
  let cur: (SimTrade & { tp: [number, number, number]; remaining: number; beDone: boolean; trailOn: boolean; tp1Done: boolean; tp2Done: boolean; filled: boolean; netAtEntry: number }) | null = null;
  let pendingClose: string | null = null;
  let lastExitBar = -Infinity;
  let consLosses = 0;
  let dayStartEq = equity;
  let blocked = 0;
  const fee = (price: number, qty: number) => {
    const b = spec.backtest;
    if (b.commissionType === 'percent') return (price * qty * pv * b.commissionValue) / 100;
    if (b.commissionType === 'cash_per_contract') return qty * b.commissionValue;
    return b.commissionValue;
  };
  const slip = spec.backtest.slippageTicks * mintick;
  const qtyFor = (risk: number) => {
    const ru = risk * pv;
    let raw: number;
    switch (r.sizing.mode) {
      case 'Fixed quantity':
        raw = r.sizing.value;
        break;
      case 'Fixed cash risk':
        raw = ru > 0 ? r.sizing.value / ru : 0;
        break;
      case 'Percent of equity notional':
        raw = (equity * r.sizing.value) / 100 / ((cur ? cur.entry : 1) * pv);
        break;
      default:
        raw = ru > 0 ? (equity * r.sizing.value) / 100 / ru : 0;
    }
    const capRisk = r.sizing.maxRiskPct > 0 && ru > 0 ? (equity * r.sizing.maxRiskPct) / 100 / ru : raw;
    const step = r.sizing.qtyStep > 0 ? r.sizing.qtyStep : opts.qtyStep ?? (spec.market.assetClass === 'crypto' ? 0.0001 : 1);
    return Math.floor(Math.min(raw, capRisk, r.sizing.maxQty) / step + 1e-9) * step;
  };
  const closePart = (i: number, price: number, frac: number, label: string) => {
    if (!cur) return;
    const q = cur.qty * frac;
    const pnl = cur.dir * (price - cur.entry) * q * pv - fee(price, q);
    equity += pnl;
    cur.partials.push({ bar: i, price, frac, label });
    cur.remaining -= frac;
  };
  const finish = (i: number, reason: string) => {
    if (!cur) return;
    const gross = cur.partials.reduce((a, p) => a + p.frac * cur!.dir * (p.price - cur!.entry), 0);
    cur.r = cur.risk > 0 ? gross / cur.risk : 0;
    cur.exitBar = i;
    cur.exitPrice = cur.partials[cur.partials.length - 1]?.price ?? null;
    cur.reason = reason;
    cur.pnl = equity - cur.netAtEntry;
    if (cur.pnl < 0) consLosses++;
    else consLosses = 0;
    markers.push({ bar: i, kind: 'exit', dir: cur.dir, side: cur.dir === 1 ? 'above' : 'below', text: `EXIT ${reason}`, detail: `${reason} · ${cur.r >= 0 ? '+' : ''}${cur.r.toFixed(2)}R`, good: cur.r >= 0 });
    trades.push(cur);
    cur = null;
    lastExitBar = i;
    pendingClose = null;
  };

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (i > 0 && Math.floor(b.t / 86400000) !== Math.floor(bars[i - 1].t / 86400000)) {
      dayStartEq = equity;
      consLosses = 0;
    }
    // ── Broker emulation during bar i (orders placed at the previous close) ──
    if (cur && isStrat) {
      if (!cur.filled) {
        cur.entry = b.o + cur.dir * slip;
        cur.entryBar = i;
        cur.filled = true;
        cur.netAtEntry = equity;
        equity -= fee(cur.entry, cur.qty);
        markers.push({ bar: i, kind: 'fill', dir: cur.dir, side: cur.dir === 1 ? 'below' : 'above', text: '◆', detail: `Filled at ${cur.entry.toFixed(decimals(bars))} (next bar open)` });
      } else if (pendingClose) {
        closePart(i, b.o - cur.dir * slip, cur.remaining, pendingClose);
        finish(i, pendingClose);
      }
      if (cur) {
        // Gaps: a stop or target already crossed at the open fills at the open price.
        const tag0 = cur.trailOn ? 'Trail' : cur.beDone ? 'BE' : 'SL';
        if (cur.dir === 1 ? b.o <= cur.stop : b.o >= cur.stop) {
          closePart(i, b.o - cur.dir * slip, cur.remaining, tag0);
          finish(i, tag0);
        }
      }
      if (cur) {
        // Intrabar path: O→H→L→C when the high is nearer the open, else O→L→H→C.
        const upFirst = b.h - b.o <= b.o - b.l;
        const pts = upFirst ? [b.o, b.h, b.l, b.c] : [b.o, b.l, b.h, b.c];
        const tps = [cur.tp1Done ? NaN : cur.tp[0], cur.tp2Done ? NaN : cur.tp[1], cur.tp[2]];
        const fr = [p1, p2, 1 - p1 - p2];
        const dir = cur.dir;
        for (let s = 0; s < pts.length - 1 && cur; s++) {
          const a = pts[s];
          const z = pts[s + 1];
          const lo = Math.min(a, z);
          const hi = Math.max(a, z);
          // Gaps at the open are handled by the first segment starting at the open price.
          const stopHit = dir === 1 ? lo <= cur.stop : hi >= cur.stop;
          const ordered = (dir === 1) === z > a ? [0, 1, 2] : [];
          if ((dir === 1 && z < a) || (dir === -1 && z > a)) {
            if (stopHit) {
              const px = dir === 1 ? Math.min(a, cur.stop) : Math.max(a, cur.stop);
              const tag = cur.trailOn ? 'Trail' : cur.beDone ? 'BE' : 'SL';
              closePart(i, px - dir * slip, cur.remaining, tag);
              finish(i, tag);
              break;
            }
          } else {
            for (const k of ordered) {
              if (!cur || Number.isNaN(tps[k])) continue;
              if (k < 2 && r.tpCount < k + 2) continue;
              const tp = tps[k];
              const reached = dir === 1 ? hi >= tp : lo <= tp;
              if (!reached) continue;
              const px = dir === 1 ? Math.max(a, tp) : Math.min(a, tp);
              const isFinal = k === 2 || (k === 1 && r.tpCount === 2) || (k === 0 && r.tpCount === 1);
              if (isFinal) {
                const label = `TP${r.tpCount}`;
                closePart(i, px, cur.remaining, label);
                finish(i, label);
              } else {
                closePart(i, px, fr[k], `TP${k + 1}`);
                if (k === 0) cur.tp1Done = true;
                else cur.tp2Done = true;
                tps[k] = NaN;
                markers.push({ bar: i, kind: 'tp', dir, side: dir === 1 ? 'above' : 'below', text: `TP${k + 1}`, detail: `Partial exit ${Math.round(fr[k] * 100)}% at ${px.toFixed(decimals(bars))}` });
              }
            }
          }
        }
        if (cur && i === cur.entryBar && spec.backtest.anchorToFill) {
          cur.risk = Math.abs(cur.entry - cur.stop);
          cur.tp = [0, 1, 2].map((k) => cur!.entry + cur!.dir * r.tpR[k] * cur!.risk) as [number, number, number];
        }
      }
    } else if (cur && !isStrat && i > cur.entryBar) {
      // Indicator simulation: stop checked first, then targets (as the generated indicator does).
      const dir = cur.dir;
      if (dir === 1 ? b.l <= cur.stop : b.h >= cur.stop) {
        const tag = cur.trailOn ? 'Trail' : cur.beDone ? 'BE' : 'SL';
        closePart(i, cur.stop, cur.remaining, tag);
        finish(i, tag);
      } else {
        const hit = (x: number) => (dir === 1 ? b.h >= x : b.l <= x);
        if (r.tpCount >= 2 && !cur.tp1Done && hit(cur.tp[0])) {
          closePart(i, cur.tp[0], p1, 'TP1');
          cur.tp1Done = true;
          markers.push({ bar: i, kind: 'tp', dir, side: dir === 1 ? 'above' : 'below', text: 'TP1', detail: 'Target 1 reached' });
        }
        if (r.tpCount >= 3 && cur.tp1Done && !cur.tp2Done && hit(cur.tp[1])) {
          closePart(i, cur.tp[1], p2, 'TP2');
          cur.tp2Done = true;
          markers.push({ bar: i, kind: 'tp', dir, side: dir === 1 ? 'above' : 'below', text: 'TP2', detail: 'Target 2 reached' });
        }
        const fin = r.tpCount === 1 ? cur.tp[0] : r.tpCount === 2 ? cur.tp[1] : cur.tp[2];
        if (hit(fin)) {
          closePart(i, fin, cur.remaining, `TP${r.tpCount}`);
          finish(i, `TP${r.tpCount}`);
        }
      }
    }

    // ── Script logic at the close of bar i ──
    if (cur && (cur.filled || !isStrat)) {
      const dir = cur.dir;
      if (r.breakeven.enabled && !cur.beDone && (dir === 1 ? b.h >= cur.entry + r.breakeven.triggerR * cur.risk : b.l <= cur.entry - r.breakeven.triggerR * cur.risk)) {
        cur.stop = dir === 1 ? Math.max(cur.stop, cur.entry + r.breakeven.offsetTicks * mintick) : Math.min(cur.stop, cur.entry - r.breakeven.offsetTicks * mintick);
        cur.beDone = true;
      }
      if (r.trailing.enabled && (cur.trailOn || (dir === 1 ? b.h >= cur.entry + r.trailing.activateR * cur.risk : b.l <= cur.entry - r.trailing.activateR * cur.risk))) {
        cur.trailOn = true;
        cur.stop = dir === 1 ? Math.max(cur.stop, b.c - r.trailing.atrMult * atrR[i]) : Math.min(cur.stop, b.c + r.trailing.atrMult * atrR[i]);
      }
      const rule = dir === 1 ? exitRuleL[i] : exitRuleS[i];
      const opp = r.closeOnOpposite && (dir === 1 ? shortSignal[i] : longSignal[i]);
      const timeUp = r.timeExitBars > 0 && i - cur.entryBar >= r.timeExitBars;
      if (rule || opp || timeUp) {
        const reason = rule ? 'Rule exit' : opp ? 'Opposite signal' : 'Time exit';
        if (isStrat) pendingClose = reason;
        else {
          closePart(i, b.c, cur.remaining, reason);
          finish(i, reason);
        }
      }
    }
    const daily = isStrat && r.dailyLoss.enabled && dayStartEq - equity >= (dayStartEq * r.dailyLoss.percent) / 100;
    const streak = isStrat && r.maxConsecutiveLosses > 0 && consLosses >= r.maxConsecutiveLosses;
    const inSess = !f.session.enabled || inSession(b.t, f.session.session, f.session.timezone);
    const inBlk = f.blackout.enabled && inSession(b.t, f.blackout.session, f.blackout.timezone);
    const inDate = !spec.backtest.dateRange.enabled || (b.t >= start && b.t <= end);
    const cooldownOk: boolean = i - lastExitBar > r.cooldownBars;
    const canTrade: boolean = tfAllowed && inSess && !inBlk && inDate && !daily && !streak && rrOk && cooldownOk;
    const flat: boolean = !cur;
    const goL: boolean = longSignal[i] && f.direction !== 'short' && canTrade && flat && stopOk(i, 1);
    const goS: boolean = !goL && shortSignal[i] && f.direction !== 'long' && canTrade && flat && stopOk(i, -1);
    for (const [sig, go, d] of [
      [longSignal[i], goL, 1],
      [shortSignal[i], goS, -1],
    ] as const) {
      if (!sig || go) continue;
      blocked++;
      const why = !(d === 1 ? f.direction !== 'short' : f.direction !== 'long')
        ? 'direction filter'
        : !stopOk(i, d)
          ? 'invalid / too-wide stop'
          : !tfAllowed
            ? 'chart timeframe outside designed range'
            : !inSess
              ? 'outside session'
              : inBlk
                ? 'news blackout'
                : !inDate
                  ? 'outside date range'
                  : daily
                    ? 'daily loss limit'
                    : streak
                      ? 'loss-streak pause'
                      : !rrOk
                        ? 'target plan below min R:R'
                        : !cooldownOk
                          ? 'cooldown'
                          : 'position already open';
      markers.push({ bar: i, kind: 'blocked', dir: d, side: d === 1 ? 'below' : 'above', text: '⊘', detail: `${d === 1 ? 'Long' : 'Short'} signal not traded: ${why}` });
    }
    if (goL || goS) {
      const dir: 1 | -1 = goL ? 1 : -1;
      const stop = dir === 1 ? stopL[i] : stopS[i];
      const risk = Math.abs(b.c - stop);
      const entry = b.c;
      const strong = dir === 1 ? strongL[i] : strongS[i];
      cur = {
        dir,
        signalBar: i,
        entryBar: i,
        entry,
        stop,
        initialStop: stop,
        risk,
        qty: 0,
        exitBar: null,
        exitPrice: null,
        reason: '',
        r: null,
        pnl: null,
        partials: [],
        strong,
        tp: [0, 1, 2].map((k) => entry + dir * r.tpR[k] * risk) as [number, number, number],
        remaining: 1,
        beDone: false,
        trailOn: false,
        tp1Done: false,
        tp2Done: false,
        filled: !isStrat || spec.backtest.fillMode === 'on_close',
        netAtEntry: equity,
      };
      cur.qty = qtyFor(risk);
      if (cur.filled && isStrat) equity -= fee(entry, cur.qty);
      const word = cons && strong ? (dir === 1 ? 'STRONG BUY' : 'STRONG SELL') : dir === 1 ? 'BUY' : 'SELL';
      markers.push({ bar: i, kind: cons && strong ? 'strong' : 'entry', dir, side: dir === 1 ? 'below' : 'above', text: word, detail: `${word} at ${entry.toFixed(decimals(bars))} · stop ${stop.toFixed(decimals(bars))} · TPs ${cur.tp.slice(0, r.tpCount).map((x) => x.toFixed(decimals(bars))).join(' / ')}${isStrat ? ' · market order fills next bar' : ''}` });
    }
    if (cons && (strongLFirst[i] || strongSFirst[i]) && !(goL || goS)) {
      const d: 1 | -1 = strongLFirst[i] ? 1 : -1;
      markers.push({ bar: i, kind: 'agreement', dir: d, side: d === 1 ? 'below' : 'above', text: d === 1 ? 'ALL▲' : 'ALL▼', detail: 'Strong agreement (first bar) — no trade taken' });
    }
    if (longSetup[i]) markers.push({ bar: i, kind: 'setup', dir: 1, side: 'below', text: '△', detail: 'Potential long setup: trigger fired, confluence not met' });
    if (shortSetup[i]) markers.push({ bar: i, kind: 'setup', dir: -1, side: 'above', text: '▽', detail: 'Potential short setup: trigger fired, confluence not met' });
    if (longInvalid[i]) markers.push({ bar: i, kind: 'invalid', dir: 1, side: 'below', text: '✕', detail: 'Long setup invalidated' });
    if (shortInvalid[i]) markers.push({ bar: i, kind: 'invalid', dir: -1, side: 'above', text: '✕', detail: 'Short setup invalidated' });

    if (cur) {
      lv.entry[i] = cur.entry;
      lv.stop[i] = cur.stop;
      lv.tp1[i] = r.tpCount >= 2 && !cur.tp1Done ? cur.tp[0] : NaN;
      lv.tp2[i] = r.tpCount >= 3 && !cur.tp2Done ? cur.tp[1] : NaN;
      lv.final[i] = r.tpCount === 1 ? cur.tp[0] : r.tpCount === 2 ? cur.tp[1] : cur.tp[2];
    }
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak > 0 ? (100 * (peak - equity)) / peak : 0);
  }
  if (cur) notes.push('The last position is still open at the end of the data.');

  // Component events
  if (opts.showEvents !== false)
    for (const e of Object.values(sims).flatMap((s) => s.events))
      markers.push({ bar: e.bar, kind: 'event', dir: e.tone === 'bull' ? 1 : e.tone === 'bear' ? -1 : 0, side: e.side, text: e.text, detail: e.detail });

  const done = trades.filter((t) => t.r !== null);
  const wins = done.filter((t) => (t.r ?? 0) > 0);
  const gp = done.reduce((a, t) => a + Math.max(0, t.r ?? 0), 0);
  const gl = -done.reduce((a, t) => a + Math.min(0, t.r ?? 0), 0);
  if (done.some((t) => t.qty === 0)) notes.push('Some positions rounded to 0 units with the current sizing and quantity step, so their currency P&L is 0 (R results are still shown). Set the quantity step in Risk → sizing.');
  const totalR = done.reduce((a, t) => a + (t.r ?? 0), 0);
  notes.push(
    'Preview computed in the app from the same specification; TradingView remains the reference. Small differences come from data source, session/day boundaries, pivot tie-breaks and intrabar fill rules.',
    isStrat ? 'Strategy mode: market orders fill at the next bar open (+ slippage); stops/targets follow the Strategy Tester path assumption (open→high→low→close when the high is nearer the open).' : 'Indicator mode: entries at the signal close; within a bar the stop is assumed to be hit before targets.',
  );
  const allOverlays = Object.values(sims).flatMap((s) => s.overlays);
  const readouts = Object.values(sims)
    .map((s) => s.readout)
    .filter((x): x is NonNullable<CompSim['readout']> => !!x);
  return {
    markers: markers.sort((a, b) => a.bar - b.bar),
    trades,
    overlays: allOverlays,
    levels: lv,
    tfOk,
    open: cur ? { ...cur, partials: [...cur.partials], targets: cur.tp.slice(0, r.tpCount).filter((_, k) => !(k === 0 && cur!.tp1Done) && !(k === 1 && cur!.tp2Done)), filled: cur.filled } : null,
    info: (i) => ({
      scoreL: scoreL[i],
      scoreS: scoreS[i],
      conds: cons ? [] : vo[0].conds.map((c) => ({ label: c.label, role: c.role, L: c.L[i], S: c.S[i] })),
      votes: voteInfo ? voteInfo(i) : undefined,
      agreeL: cons ? scoreL[i] : undefined,
      agreeS: cons ? scoreS[i] : undefined,
      readouts: readouts.map((x) => ({ label: x.label, value: x.value(i) })),
    }),
    stats: {
      signals: longSignal.filter(Boolean).length + shortSignal.filter(Boolean).length,
      trades: done.length,
      wins: wins.length,
      losses: done.length - wins.length,
      winRate: done.length ? (100 * wins.length) / done.length : null,
      totalR,
      avgR: done.length ? totalR / done.length : null,
      netPnl: done.reduce((a, t) => a + (t.pnl ?? 0), 0),
      profitFactor: gl > 0 ? gp / gl : null,
      maxDrawdownPct: maxDD,
      blocked,
      strongSignals: strongLFirst.filter(Boolean).length + strongSFirst.filter(Boolean).length,
    },
    notes,
  };
}

export type { CompEvent, Overlay };
