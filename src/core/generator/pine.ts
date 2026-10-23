// Small helpers for emitting Pine Script source safely.

export function pStr(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

export function pNum(n: number, float = false): string {
  if (!Number.isFinite(n)) throw new Error(`Non-finite number ${n}`);
  if (float) {
    const s = String(n);
    return s.includes('.') || s.includes('e') ? s : `${s}.0`;
  }
  return String(Math.round(n));
}

export function pBool(b: boolean): string {
  return b ? 'true' : 'false';
}

const PINE_SOURCES = new Set(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume']);

export function pSource(s: string): string {
  return PINE_SOURCES.has(s) ? s : 'close';
}

export function pColor(hex: string): string {
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex) ? hex : '#888888';
}

/** Replace `$name` with `<id>_name` and `@name` with `i_<id>_name`. */
export function subst(code: string, id: string): string {
  return code.replace(/\$([A-Za-z_]\w*)/g, `${id}_$1`).replace(/@([A-Za-z_]\w*)/g, `i_${id}_$1`);
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'strategy';
}

export function ident(s: string): string {
  const v = s.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(v) ? `_${v}` : v;
}

export class Lines {
  readonly out: string[] = [];
  push(...l: string[]): this {
    this.out.push(...l);
    return this;
  }
  blank(): this {
    if (this.out.length && this.out[this.out.length - 1] !== '') this.out.push('');
    return this;
  }
  section(title: string): this {
    this.blank();
    this.out.push(`// ${'═'.repeat(3)} ${title} ${'═'.repeat(Math.max(3, 66 - title.length))}`);
    return this;
  }
  indent(lines: string[], n = 1): this {
    const pad = '    '.repeat(n);
    this.out.push(...lines.map((l) => (l ? pad + l : l)));
    return this;
  }
  toString(): string {
    return this.out.join('\n') + '\n';
  }
}
