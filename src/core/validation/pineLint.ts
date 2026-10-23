// Static analyzer for Pine Script v6 source. This is NOT a compiler: it catches the classes of
// mistakes a generator (or an LLM) typically makes, and reports exactly which checks ran.
import type { Diagnostic } from '../types';
import { BUILTIN_FUNCS, BUILTIN_VARS, GLOBAL_ONLY, KEYWORDS, LEGACY_GLOBALS, NAMED_PARAMS, NAMESPACES, STRICT_MEMBERS } from './builtins';

export type TokKind = 'id' | 'num' | 'str' | 'op' | 'color' | 'member';
export interface Tok {
  k: TokKind;
  v: string;
}

export const STATIC_CHECKS = [
  'version-annotation',
  'single-declaration',
  'bracket-balance',
  'string-termination',
  'indentation',
  'undeclared-identifiers',
  'builtin-members',
  'named-arguments',
  'duplicate-arguments',
  'legacy-v4-v5-syntax',
  'global-scope-only-calls',
  'bool-na (v6)',
  'history-on-literals (v6)',
  'linewidth (v6)',
  'lazy-and-or-evaluation (v6)',
  'request.security look-ahead',
  'plot-count-limit',
  'strategy-orders-present',
];

export function tokenize(line: string): { toks: Tok[]; error?: string } {
  const toks: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '"' || c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === c) {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return { toks, error: 'Unterminated string literal' };
      toks.push({ k: 'str', v: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === '#') {
      const m = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?/.exec(line.slice(i));
      if (m) {
        toks.push({ k: 'color', v: m[0] });
        i += m[0].length;
        continue;
      }
    }
    const num = /^(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(line.slice(i));
    if (num && (/\d/.test(c) || (c === '.' && /\d/.test(line[i + 1] ?? '')))) {
      toks.push({ k: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    if (c === '.' && /[A-Za-z_]/.test(line[i + 1] ?? '')) {
      const m = /^\.[A-Za-z_]\w*/.exec(line.slice(i))!;
      toks.push({ k: 'member', v: m[0] });
      i += m[0].length;
      continue;
    }
    const id = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*/.exec(line.slice(i));
    if (id) {
      toks.push({ k: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = /^(:=|==|!=|<=|>=|=>|\+=|-=|\*=|\/=|%=|[-+*/%<>=?:,()[\]{}!])/.exec(line.slice(i));
    if (op) {
      toks.push({ k: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    toks.push({ k: 'op', v: c });
    i++;
  }
  return { toks };
}

interface LogicalLine {
  no: number; // 1-based first physical line
  indent: number; // spaces
  text: string;
}

function logicalLines(src: string, diags: Diagnostic[]): LogicalLine[] {
  const out: LogicalLine[] = [];
  src.split(/\r?\n/).forEach((raw, idx) => {
    if (/\t/.test(raw.match(/^\s*/)?.[0] ?? '')) diags.push(d('indentation', 'warning', 'Tab indentation found — Pine expects 4 spaces (or one tab) per level; mixing can break blocks.', idx + 1));
    const stripped = raw.replace(/\s+$/, '');
    const body = stripped.trim();
    if (!body || body.startsWith('//')) return;
    const indent = stripped.length - stripped.trimStart().length;
    const prev = out[out.length - 1];
    if (prev && indent % 4 !== 0) {
      prev.text += ' ' + body; // line continuation
      return;
    }
    out.push({ no: idx + 1, indent, text: body });
  });
  return out;
}

function d(check: string, severity: Diagnostic['severity'], message: string, line?: number): Diagnostic {
  return { stage: 'static', check, severity, message, line };
}

const TYPE_RE = /^(?:(?:series|simple|const)\s+)?(?:int|float|bool|string|color|label|line|box|table|linefill|polyline|chart\.point|(?:array|matrix|map)<[^>]+>|[A-Z]\w*)\s+(?=[A-Za-z_]\w*\s*=(?!=))/;

function declaredNames(text: string): { names: string[]; isDecl: boolean; reassign?: string } {
  let t = text;
  const re = /^(\w+)\s*(:=|\+=|-=|\*=|\/=|%=)/.exec(t);
  if (re) return { names: [], isDecl: false, reassign: re[1] };
  t = t.replace(/^(var|varip)\s+/, '');
  t = t.replace(TYPE_RE, '');
  const tuple = /^\[([\w\s,]+)\]\s*=(?!=)/.exec(t);
  if (tuple) return { names: tuple[1].split(',').map((s) => s.trim()).filter(Boolean), isDecl: true };
  const single = /^([A-Za-z_]\w*)\s*=(?![=>])/.exec(t);
  if (single && !KEYWORDS.has(single[1])) return { names: [single[1]], isDecl: true };
  return { names: [], isDecl: false };
}

export interface LintResult {
  diagnostics: Diagnostic[];
  checksRun: string[];
  stats: { logicalLines: number; plotCalls: number; declaredGlobals: number };
}

export function lintPine(src: string): LintResult {
  const diags: Diagnostic[] = [];
  const lines = logicalLines(src, diags);

  // Version annotation
  const firstCode = src.split(/\r?\n/).findIndex((l) => /^\s*\/\/\s*@version\s*=\s*\d+/.test(l));
  if (firstCode < 0) diags.push(d('version-annotation', 'error', 'Missing //@version=6 annotation.'));
  else {
    const ver = /@version\s*=\s*(\d+)/.exec(src.split(/\r?\n/)[firstCode])![1];
    if (ver !== '6') diags.push(d('version-annotation', 'error', `Script declares //@version=${ver}; this generator targets v6.`, firstCode + 1));
  }

  // Declaration
  const decls = lines.filter((l) => l.indent === 0 && /^(indicator|strategy|library)\s*\(/.test(l.text));
  if (decls.length !== 1) diags.push(d('single-declaration', 'error', `Expected exactly one indicator()/strategy()/library() declaration, found ${decls.length}.`));
  const isStrategy = decls[0] ? decls[0].text.startsWith('strategy') : false;
  const st = decls[0] && /shorttitle\s*=\s*"([^"]*)"/.exec(decls[0].text);
  if (st && st[1].length > 10) diags.push(d('single-declaration', 'warning', `shorttitle "${st[1]}" is ${st[1].length} characters; TradingView recommends 10 or fewer.`, decls[0].no));

  const scopes: { level: number; names: Set<string> }[] = [{ level: 0, names: new Set() }];
  const isDeclared = (n: string, extra: Set<string>) => extra.has(n) || scopes.some((s) => s.names.has(n));
  const scopeAt = (level: number) => {
    let s = scopes.find((x) => x.level === level);
    if (!s) {
      s = { level, names: new Set() };
      scopes.push(s);
    }
    return s;
  };

  let plotCalls = 0;
  let prevLevel = 0;
  let prevOpensBlock = false;

  for (const ll of lines) {
    const level = Math.floor(ll.indent / 4);
    // Indentation
    if (level > prevLevel + 1) diags.push(d('indentation', 'error', `Indentation jumps ${level - prevLevel} levels.`, ll.no));
    else if (level === prevLevel + 1 && !prevOpensBlock) diags.push(d('indentation', 'error', 'Unexpected indentation (previous line does not open a block).', ll.no));
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].level > level) scopes.splice(i, 1);

    const { toks, error } = tokenize(ll.text);
    if (error) diags.push(d('string-termination', 'error', error, ll.no));

    // Brackets
    const stack: string[] = [];
    let bad = false;
    for (const t of toks) {
      if (t.k !== 'op') continue;
      if ('([{'.includes(t.v)) stack.push(t.v);
      else if (')]}'.includes(t.v)) {
        const open = stack.pop();
        if (!open || '([{'.indexOf(open) !== ')]}'.indexOf(t.v)) bad = true;
      }
    }
    if (bad || stack.length) diags.push(d('bracket-balance', 'error', 'Unbalanced brackets.', ll.no));

    const lineScope = new Set<string>();
    // Function definitions (global only) — params are visible in the body.
    const fn = /^(?:method\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>/.exec(ll.text);
    if (fn && level === 0) {
      scopeAt(0).names.add(fn[1]);
      const params = fn[2]
        .split(',')
        .map((p) => p.trim().split(/\s+/).pop()!.replace(/=.*/, '').trim())
        .filter(Boolean);
      const body = scopeAt(1);
      body.names.clear();
      params.forEach((p) => {
        body.names.add(p);
        lineScope.add(p);
      });
    }
    // Loops
    const forEq = /^for\s+([A-Za-z_]\w*)\s*=/.exec(ll.text);
    const forIn = /^for\s+(?:\[([\w\s,]+)\]|([A-Za-z_]\w*))\s+in\b/.exec(ll.text);
    if (forEq || forIn) {
      const s = scopeAt(level + 1);
      s.names.clear();
      const names = forEq ? [forEq[1]] : forIn![1] ? forIn![1].split(',').map((x) => x.trim()) : [forIn![2]];
      names.forEach((n) => s.names.add(n));
    }
    // Declarations / reassignments
    const dn = fn ? { names: [], isDecl: false } : declaredNames(ll.text);
    if (dn.reassign && !isDeclared(dn.reassign, lineScope)) diags.push(d('undeclared-identifiers', 'error', `Assignment to undeclared variable "${dn.reassign}" (use "=" to declare first).`, ll.no));
    const lhs = new Set(dn.names);
    if (dn.isDecl) {
      const cur = scopeAt(level);
      for (const n of dn.names) if (cur.names.has(n)) diags.push(d('undeclared-identifiers', 'error', `"${n}" is already declared in this scope.`, ll.no));
      if (/^(var\s+|varip\s+)?bool\s+\w+\s*=\s*na\b/.test(ll.text)) diags.push(d('bool-na (v6)', 'error', 'bool variables cannot be na in Pine v6.', ll.no));
    }

    // Token walk: references, named args, members.
    const eqIdx = dn.isDecl ? toks.findIndex((x) => x.k === 'op' && x.v === '=') : -1;
    const callStack: { name: string | null; named: Set<string> }[] = [];
    let seenAndOr = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const next = toks[i + 1];
      if (t.k === 'op') {
        if (t.v === '(') {
          const prev = toks[i - 1];
          callStack.push({ name: prev && prev.k === 'id' ? prev.v : null, named: new Set() });
        } else if (t.v === ')') callStack.pop();
        continue;
      }
      if (t.k !== 'id') continue;
      if (t.v === 'and' || t.v === 'or') seenAndOr = true;
      // Named argument
      if (next && next.k === 'op' && next.v === '=' && callStack.length) {
        const frame = callStack[callStack.length - 1];
        if (frame.name) {
          if (frame.named.has(t.v)) diags.push(d('duplicate-arguments', 'error', `Argument "${t.v}" passed twice to ${frame.name}() (error in v6).`, ll.no));
          frame.named.add(t.v);
          const allowed = NAMED_PARAMS[frame.name];
          if (t.v === 'when' && frame.name.startsWith('strategy.')) diags.push(d('legacy-v4-v5-syntax', 'error', `"when" was removed from ${frame.name}() in v6 — wrap the call in an if block.`, ll.no));
          else if (t.v === 'transp') diags.push(d('legacy-v4-v5-syntax', 'error', '"transp" was removed in v6 — use color.new(color, transparency).', ll.no));
          else if (allowed && !allowed.has(t.v)) diags.push(d('named-arguments', 'error', `${frame.name}() has no parameter "${t.v}".`, ll.no));
        }
        continue;
      }
      if (lhs.has(t.v) && i < eqIdx) continue; // declaration target
      if (dn.reassign === t.v && i === 0) continue; // already reported above
      if (KEYWORDS.has(t.v)) continue;
      const parts = t.v.split('.');
      const head = parts[0];
      const isCall = next && next.k === 'op' && next.v === '(';
      if (seenAndOr && isCall && (t.v.startsWith('ta.') || t.v.startsWith('request.'))) {
        diags.push(d('lazy-and-or-evaluation (v6)', 'warning', `${t.v}() appears after and/or — v6 evaluates and/or lazily, so it may not run on every bar. Hoist it to a global variable.`, ll.no));
      }
      if (parts.length > 1) {
        if (isDeclared(head, lineScope)) continue; // object member / method call
        if (!NAMESPACES.has(head)) {
          diags.push(d('undeclared-identifiers', 'error', `Unknown namespace or undeclared object "${head}".`, ll.no));
          continue;
        }
        for (let p = 1; p < parts.length; p++) {
          const nsKey = parts.slice(0, p).join('.');
          const members = STRICT_MEMBERS[nsKey];
          if (!members) break;
          if (!members.has(parts[p])) {
            diags.push(d('builtin-members', 'error', `"${nsKey}.${parts[p]}" is not a known Pine v6 built-in.`, ll.no));
            break;
          }
          if (!STRICT_MEMBERS[`${nsKey}.${parts[p]}`]) break;
        }
        if (GLOBAL_ONLY.has(t.v) && level > 0 && isCall) diags.push(d('global-scope-only-calls', 'error', `${t.v}() must be called in the global scope.`, ll.no));
        continue;
      }
      if (isDeclared(t.v, lineScope)) continue;
      if (BUILTIN_VARS.has(t.v) || BUILTIN_FUNCS.has(t.v)) {
        if (GLOBAL_ONLY.has(t.v) && isCall) {
          plotCalls += /^plot|^bgcolor|^fill|^barcolor/.test(t.v) ? 1 : 0;
          if (level > 0) diags.push(d('global-scope-only-calls', 'error', `${t.v}() cannot be called inside a local block.`, ll.no));
        }
        continue;
      }
      if (LEGACY_GLOBALS.has(t.v) && isCall) diags.push(d('legacy-v4-v5-syntax', 'error', `"${t.v}()" needs its namespace in v5+/v6 (e.g. ta.${t.v}() or math.${t.v}()).`, ll.no));
      else diags.push(d('undeclared-identifiers', 'error', `Undeclared identifier "${t.v}".`, ll.no));
    }

    // Literal history references and linewidth
    const noStr = ll.text.replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/g, '""');
    if (/(^|[^\w.])(\d+(\.\d+)?|true|false)\s*\[/.test(noStr)) diags.push(d('history-on-literals (v6)', 'error', 'History-referencing operator [] used on a literal (error in v6).', ll.no));
    if (/linewidth\s*=\s*0(?![.\d])/.test(noStr)) diags.push(d('linewidth (v6)', 'error', 'linewidth must be ≥ 1 in v6.', ll.no));
    // request.security look-ahead discipline
    if (/request\.security\s*\(/.test(noStr)) {
      const la = /lookahead\s*=\s*barmerge\.lookahead_on/.test(noStr);
      if (la && !/\[\s*1\s*\]/.test(noStr)) diags.push(d('request.security look-ahead', 'error', 'lookahead_on without a [1] offset leaks future higher-timeframe data into history.', ll.no));
      if (!la) diags.push(d('request.security look-ahead', 'warning', 'request.security without lookahead_on + [1]: higher-timeframe values will change on realtime bars (repainting).', ll.no));
    }
    if (/calc_on_every_tick\s*=\s*true/.test(noStr)) diags.push(d('strategy-orders-present', 'warning', 'calc_on_every_tick = true: realtime results will differ from history (orders can trigger intrabar).', ll.no));

    for (const n of dn.names) scopeAt(level).names.add(n);
    prevLevel = level;
    prevOpensBlock =
      /^(if|else|for|while|switch)\b/.test(ll.text) ||
      /=>\s*$/.test(ll.text) ||
      /(=|:=)\s*(switch|if)\b/.test(ll.text) ||
      /^type\s+\w+/.test(ll.text) ||
      /^enum\s+\w+/.test(ll.text);
  }

  if (plotCalls > 64) diags.push(d('plot-count-limit', 'error', `About ${plotCalls} plot-type calls; Pine allows 64 plot counts per script.`));
  else if (plotCalls > 52) diags.push(d('plot-count-limit', 'warning', `${plotCalls} plot-type calls — close to the 64 plot-count limit (dynamic colours count extra).`));

  if (isStrategy) {
    if (!/strategy\.entry\s*\(/.test(src)) diags.push(d('strategy-orders-present', 'error', 'strategy() script never calls strategy.entry().'));
    if (!/strategy\.(exit|close|close_all)\s*\(/.test(src)) diags.push(d('strategy-orders-present', 'warning', 'No strategy.exit()/strategy.close() — positions only close on reversal.'));
  }
  return { diagnostics: diags, checksRun: STATIC_CHECKS, stats: { logicalLines: lines.length, plotCalls, declaredGlobals: scopes[0].names.size } };
}
