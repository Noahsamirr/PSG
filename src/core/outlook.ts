// Next entry points: at which closing prices of the candle that is forming now would a strategy fire a BUY or SELL?
// Found by replaying the strategy's own rules on the real history plus one hypothetical next candle (its real
// open/high/low so far, with the close varied over ±2.5 ATR), then narrowing each edge by bisection.
import { runSimulation, type Bar } from './sim/engine';
import * as T from './sim/series';
import type { StrategySpec } from './types';

export interface Trigger {
  action: 'BUY' | 'SELL';
  /** Close price range that fires the signal. `from` null = any close at or below `to`; `to` null = at or above `from`. */
  from: number | null;
  to: number | null;
  /** Levels the strategy would use if it fired at the edge price. */
  stop: number | null;
  targets: number[];
  /** Fires, but the strategy would not enter (e.g. a position is already open); the reason is given. */
  blockedReason: string | null;
}

export interface TriggerScan {
  triggers: Trigger[];
  /** Price range that was searched. */
  searched: { low: number; high: number };
  /** Bars of history used (fewer bars = faster; enough for every indicator to warm up). */
  barsUsed: number;
}

type Hit = { dir: 1 | -1; blocked: string | null; stop: number | null; targets: number[] } | null;

/** Simulates one hypothetical close and reports whether a BUY/SELL fires on that candle. */
function probe(spec: StrategySpec, base: Bar[], next: Bar, tf: string, qtyStep?: number): { buy: Hit; sell: Hit } {
  const bars = [...base, next];
  const i = bars.length - 1;
  const res = runSimulation(spec, bars, { chartTf: tf, qtyStep, showEvents: false });
  const at = res.markers.filter((m) => m.bar === i && (m.kind === 'entry' || m.kind === 'strong' || m.kind === 'blocked'));
  const hit = (dir: 1 | -1): Hit => {
    const m = at.find((x) => x.dir === dir);
    if (!m) return null;
    const opened = res.open && res.open.signalBar === i && res.open.dir === dir ? res.open : null;
    return { dir, blocked: m.kind === 'blocked' ? m.detail.replace(/^(Long|Short) signal not traded: /, '') : null, stop: opened?.stop ?? null, targets: opened?.targets ?? [] };
  };
  return { buy: hit(1), sell: hit(-1) };
}

export function scanTriggers(spec: StrategySpec, history: Bar[], forming: Bar | null, tf: string, opts: { qtyStep?: number; barsUsed?: number; steps?: number } = {}): TriggerScan {
  const base = history.slice(-(opts.barsUsed ?? 600));
  const last = base[base.length - 1];
  const atr = T.atr(base, 14)[base.length - 1];
  const barMs = base.length > 1 ? base[base.length - 1].t - base[base.length - 2].t : 60000;
  // The candle that will close next: the real forming candle when we have it, otherwise a new one opening at the last close.
  const o = forming?.o ?? last.c;
  const hi0 = forming?.h ?? o;
  const lo0 = forming?.l ?? o;
  const t = forming?.t ?? last.t + barMs;
  const v = forming?.v ?? base.slice(-20).reduce((a, b) => a + b.v, 0) / 20;
  const make = (c: number): Bar => ({ t, o, h: Math.max(hi0, c), l: Math.min(lo0, c), c, v });
  const span = 2.5 * (Number.isFinite(atr) && atr > 0 ? atr : last.c * 0.002);
  const low = o - span;
  const high = o + span;
  const n = opts.steps ?? 15;
  const grid = Array.from({ length: n }, (_, k) => low + ((high - low) * k) / (n - 1));
  const results = grid.map((c) => probe(spec, base, make(c), tf, opts.qtyStep));
  const triggers: Trigger[] = [];
  for (const side of ['buy', 'sell'] as const) {
    // Contiguous runs of grid prices where this side fires.
    let k = 0;
    while (k < n) {
      if (!results[k][side]) {
        k++;
        continue;
      }
      const startK = k;
      while (k + 1 < n && results[k + 1][side]) k++;
      const endK = k;
      // Refine each inner edge between a non-firing and a firing price.
      const refine = (outside: number, inside: number) => {
        let a = outside;
        let b = inside;
        let hitB = results[grid.indexOf(inside)]?.[side] ?? null;
        for (let it = 0; it < 4; it++) {
          const m = (a + b) / 2;
          const r = probe(spec, base, make(m), tf, opts.qtyStep)[side];
          if (r) {
            b = m;
            hitB = r;
          } else a = m;
        }
        return { price: b, hit: hitB };
      };
      const lowerOpen = startK === 0;
      const upperOpen = endK === n - 1;
      const lo = lowerOpen ? null : refine(grid[startK - 1], grid[startK]);
      const up = upperOpen ? null : refine(grid[endK + 1], grid[endK]);
      // Levels at the edge closest to the current price (where the signal would fire first).
      const edgeHit = side === 'buy' ? (lo?.hit ?? up?.hit ?? results[startK][side]) : (up?.hit ?? lo?.hit ?? results[endK][side]);
      triggers.push({
        action: side === 'buy' ? 'BUY' : 'SELL',
        from: lo ? lo.price : null,
        to: up ? up.price : null,
        stop: edgeHit?.stop ?? null,
        targets: edgeHit?.targets ?? [],
        blockedReason: edgeHit?.blocked ?? null,
      });
      k++;
    }
  }
  return { triggers, searched: { low, high }, barsUsed: base.length };
}
