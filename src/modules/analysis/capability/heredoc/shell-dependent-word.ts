import { ansiCShellDependent } from "./ansi-c-quoting.ts";

/** Index of the first `close` at or after `from` that no backslash escapes,
 *  or -1. */
function closingIndex(raw: string, from: number, close: string): number {
  for (let i = from; i < raw.length; i++) {
    if (raw[i] === "\\") i++;
    else if (raw[i] === close) return i;
  }
  return -1;
}

/** Index of the quote that ends a `'…'` or `"…"` region opened before `from`.
 *  Inside single quotes a backslash is literal. */
function quoteEnd(raw: string, from: number, quote: string): number {
  return quote === "'"
    ? raw.indexOf("'", from)
    : closingIndex(raw, from, quote);
}

const FOUND = -1;
const UNTERMINATED = -2;

/** Index where the scan resumes after the part at `i`, FOUND for a
 *  shell-dependent `$'…'`, or UNTERMINATED when a quote never closes. */
function step(raw: string, i: number): number {
  const ch = raw[i];
  if (ch === "\\") return i + 2;
  if (ch === "'" || ch === '"') {
    const close = quoteEnd(raw, i + 1, ch);
    return close < 0 ? UNTERMINATED : close + 1;
  }
  if (ch === "$" && raw[i + 1] === "'") {
    const close = closingIndex(raw, i + 2, "'");
    if (close < 0) return UNTERMINATED;
    return ansiCShellDependent(raw.slice(i + 2, close)) ? FOUND : close + 1;
  }
  return i + 1;
}

/** Whether a word has an unquoted `$'…'` part whose escapes the shells
 *  decode differently (`ansiCShellDependent`). One left-to-right pass: `'…'`,
 *  `"…"` and backslash pairs are skipped, so `"$'\q'"` doesn't count. */
export function hasShellDependentWord(raw: string): boolean {
  if (!raw.includes("\\")) return false;
  let i = 0;
  while (i >= 0 && i < raw.length) i = step(raw, i);
  return i === FOUND;
}
