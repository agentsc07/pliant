// Small safe expression evaluator. No eval / Function.
// Grammar: or > and > not > comparison > primary
// primary: number | 'str' | "str" | true | false | null | path | ( expr )
// path: ident(.ident)*   — `count` on an array yields its length.

type Tok = { t: "num" | "str" | "id" | "op" | "("  | ")"; v: string };

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "!"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")") { out.push({ t: c, v: c }); i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) s += src[j++];
      if (j >= src.length) throw new Error(`Unterminated string in expression: ${src}`);
      out.push({ t: "str", v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: "num", v: src.slice(i, j) }); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) }); i = j; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: "op", v: op }); i += op.length; continue; }
    throw new Error(`Unexpected character '${c}' in expression: ${src}`);
  }
  return out;
}

export type Node =
  | { k: "lit"; v: unknown }
  | { k: "path"; p: string[] }
  | { k: "not"; e: Node }
  | { k: "bin"; op: string; l: Node; r: Node };

export function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isWord = (w: string, alt: string) => peek()?.t === "id" && (peek().v === w) || (peek()?.t === "op" && peek().v === alt);

  function or(): Node {
    let l = and();
    while (isWord("or", "||")) { pos++; l = { k: "bin", op: "or", l, r: and() }; }
    return l;
  }
  function and(): Node {
    let l = not();
    while (isWord("and", "&&")) { pos++; l = { k: "bin", op: "and", l, r: not() }; }
    return l;
  }
  function not(): Node {
    if (isWord("not", "!")) { pos++; return { k: "not", e: not() }; }
    return cmp();
  }
  function cmp(): Node {
    const l = primary();
    const p = peek();
    if (p?.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(p.v)) {
      pos++; return { k: "bin", op: p.v, l, r: primary() };
    }
    return l;
  }
  function primary(): Node {
    const t = toks[pos++];
    if (!t) throw new Error(`Unexpected end of expression: ${src}`);
    if (t.t === "num") return { k: "lit", v: Number(t.v) };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "(") { const e = or(); if (toks[pos++]?.t !== ")") throw new Error(`Missing ) in: ${src}`); return e; }
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      return { k: "path", p: t.v.split(".") };
    }
    throw new Error(`Unexpected token '${t.v}' in: ${src}`);
  }
  const n = or();
  if (pos < toks.length) throw new Error(`Unexpected token '${toks[pos].v}' in: ${src}`);
  return n;
}

const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);

export function lookup(ctx: Record<string, unknown>, p: string[]): unknown {
  let cur: unknown = ctx;
  for (const key of p) {
    if (BLOCKED.has(key)) return undefined;
    if (cur == null) return undefined;
    if (Array.isArray(cur) && key === "count") { cur = cur.length; continue; }
    if (typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function run(n: Node, ctx: Record<string, unknown>): unknown {
  switch (n.k) {
    case "lit": return n.v;
    case "path": return lookup(ctx, n.p);
    case "not": return !run(n.e, ctx);
    case "bin": {
      if (n.op === "and") return !!run(n.l, ctx) && !!run(n.r, ctx);
      if (n.op === "or") return !!run(n.l, ctx) || !!run(n.r, ctx);
      const l = run(n.l, ctx) as any, r = run(n.r, ctx) as any;
      switch (n.op) {
        case "==": return l === r;
        case "!=": return l !== r;
        case "<": return l < r;
        case "<=": return l <= r;
        case ">": return l > r;
        case ">=": return l >= r;
      }
    }
  }
  throw new Error("bad node");
}

export function evalExpr(src: string, ctx: Record<string, unknown>): unknown {
  return run(parseExpr(src), ctx);
}

export function evalBool(src: string, ctx: Record<string, unknown>): boolean {
  return !!evalExpr(src, ctx);
}

/** Does the expression parse? Returns error message or null. */
export function checkExpr(src: string): string | null {
  try { parseExpr(src); return null; } catch (e) { return (e as Error).message; }
}

const TEMPLATE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Resolve `{{expr}}` templates in strings, recursively through objects/arrays. */
export function resolveTemplate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (whole) return evalExpr(whole[1], ctx);
    return value.replace(TEMPLATE, (_, e) => String(evalExpr(e, ctx) ?? ""));
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, ctx));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTemplate(v, ctx)]));
  return value;
}

/** Collect all expressions embedded in templates in a value (for static checks). */
export function templateExprs(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(TEMPLATE)) out.push(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

export function isTemplated(v: unknown): boolean {
  return typeof v === "string" && /\{\{[^}]+\}\}/.test(v);
}
