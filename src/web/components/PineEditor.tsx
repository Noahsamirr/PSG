import CodeMirror from '@uiw/react-codemirror';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useMemo, useRef } from 'react';

const KEYWORDS = new Set(['if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'var', 'varip', 'and', 'or', 'not', 'import', 'export', 'method', 'type', 'enum', 'break', 'continue']);
const TYPES = new Set(['int', 'float', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'array', 'matrix', 'map', 'series', 'simple', 'const']);
const ATOMS = new Set(['true', 'false', 'na']);
const NAMESPACES = /^(ta|math|str|request|input|strategy|timeframe|syminfo|barstate|color|label|line|box|table|array|matrix|map|plot|shape|location|size|position|format|alert|currency|display|extend|xloc|yloc|barmerge|text|font|session|dayofweek|order|runtime|ticker|chart|hline)\b/;

export const pineLanguage = StreamLanguage.define({
  name: 'pine',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return stream.string.includes('@version') ? 'meta' : 'comment';
    }
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      let esc = false;
      while (!stream.eol()) {
        const c = stream.next();
        if (c === ch && !esc) break;
        esc = c === '\\' && !esc;
      }
      return 'string';
    }
    if (stream.match(/^#[0-9a-fA-F]{6,8}\b/)) return 'atom';
    if (stream.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*/)) {
      const w = stream.current();
      if (KEYWORDS.has(w)) return 'keyword';
      if (TYPES.has(w)) return 'typeName';
      if (ATOMS.has(w)) return 'atom';
      if (NAMESPACES.test(w)) return stream.peek() === '(' ? 'function' : 'variableName.special';
      if (stream.peek() === '(') return 'function';
      return 'variableName';
    }
    if (stream.match(/^(:=|==|!=|<=|>=|=>|\+=|-=|\*=|\/=|[-+*/%<>=?:])/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '//' } },
});

const style = HighlightStyle.define([
  { tag: t.comment, color: 'var(--ink-3)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--accent-ink)', fontWeight: '600' },
  { tag: t.string, color: '#1baf7a' },
  { tag: t.number, color: '#eb6834' },
  { tag: t.atom, color: '#d55181' },
  { tag: t.keyword, color: '#9085e9', fontWeight: '600' },
  { tag: t.typeName, color: '#9085e9' },
  { tag: t.function(t.variableName), color: 'var(--accent-ink)' },
  { tag: t.special(t.variableName), color: '#c98500' },
  { tag: t.operator, color: 'var(--ink-2)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--ink-3)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'var(--mono)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent) !important' },
});

export const pineExtensions = [pineLanguage, syntaxHighlighting(style), theme, EditorView.lineWrapping];

export function PineEditor({ value, onChange, readOnly, height = '620px', gotoLine }: { value: string; onChange?: (v: string) => void; readOnly?: boolean; height?: string; gotoLine?: number | null }) {
  const ref = useRef<{ view?: EditorView } | null>(null);
  const extensions = useMemo(() => pineExtensions, []);
  useEffect(() => {
    const view = ref.current?.view;
    if (!view || !gotoLine) return;
    const line = view.state.doc.line(Math.min(Math.max(1, gotoLine), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    view.focus();
  }, [gotoLine]);
  return (
    <div className="cm-wrap">
      <CodeMirror ref={ref as never} value={value} height={height} extensions={extensions} editable={!readOnly} readOnly={readOnly} onChange={onChange} basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }} theme="none" />
    </div>
  );
}

export function PineDiff({ a, b }: { a: string; b: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const ext = [...pineExtensions, lineNumbers(), EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const mv = new MergeView({ a: { doc: a, extensions: ext }, b: { doc: b, extensions: ext }, parent: host.current, collapseUnchanged: { margin: 3, minSize: 6 }, gutter: true });
    return () => mv.destroy();
  }, [a, b]);
  return <div className="cm-wrap" ref={host} style={{ maxHeight: 640, overflow: 'auto' }} />;
}
