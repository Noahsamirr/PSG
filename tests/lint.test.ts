import { describe, expect, it } from 'vitest';
import { lintPine } from '../src/core';

const codes = (src: string) => lintPine(src).diagnostics.map((d) => d.check);

describe('static analyzer catches common Pine v6 mistakes', () => {
  const head = '//@version=6\nstrategy("t", overlay = true)\n';
  it.each([
    ['unknown built-in', 'x = ta.emaa(close, 9)', 'builtin-members'],
    ['bool na', 'bool b = na', 'bool-na (v6)'],
    ['legacy global', 'x = sma(close, 5)', 'legacy-v4-v5-syntax'],
    ['removed when=', 'if true\n    strategy.entry("L", strategy.long, when = true)', 'legacy-v4-v5-syntax'],
    ['plot in local scope', 'if true\n    plot(close)', 'global-scope-only-calls'],
    ['undeclared reassignment', 'y := 5', 'undeclared-identifiers'],
    ['look-ahead leak', 'h = request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on)', 'request.security look-ahead'],
    ['transp', 'plot(close, transp = 50)', 'legacy-v4-v5-syntax'],
    ['history on literal', 'w = 5[1]', 'history-on-literals (v6)'],
    ['duplicate argument', 'label.new(bar_index, high, "a", text = "b", text = "c")', 'duplicate-arguments'],
    ['bad indentation', 'x = 1\n    y = 2', 'indentation'],
    ['unknown named arg', 'plot(close, colour = color.red)', 'named-arguments'],
    ['lazy and/or', 'z = close > open and ta.rsi(close, 14) > 50', 'lazy-and-or-evaluation (v6)'],
  ])('%s', (_name, body, check) => {
    expect(codes(head + body + '\n')).toContain(check);
  });
  it('accepts valid code', () => {
    const src = '//@version=6\nindicator("ok", overlay = true)\nlen = input.int(14, "Len")\nf(float x) =>\n    x * 2\nv = ta.rsi(close, len)\nvar float s = na\nif v > 50\n    s := f(v)\nplot(s, "S", color = color.new(color.blue, 0))\n';
    expect(lintPine(src).diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });
});
