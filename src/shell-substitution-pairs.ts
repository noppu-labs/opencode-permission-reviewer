// Where the shell's matched-pair reading closes each construct, for every start in a text, in one pass from the end.

import type { ProbeCache } from "./shell-lex-state.ts";
import {
  heredocBodyEnd,
  heredocDelimiter,
  keywordAt,
  type LineIndex,
  lineIndex,
} from "./shell-pair-text.ts";

/** What the pair reading is inside: an arithmetic group `(…)`, a `$(…)`
 *  body, `"…"`, a backtick body, `'…'`, `$'…'`, `${…}`, `$[…]`, and a
 *  `case … esac` in a `$(…)` body, whose patterns end with a `)`. */
const Kind = {
  Group: 0,
  Command: 1,
  Double: 2,
  Backtick: 3,
  Single: 4,
  Ansi: 5,
  Brace: 6,
  Bracket: 7,
  Case: 8,
} as const;
type Kind = (typeof Kind)[keyof typeof Kind];
const KINDS = 9;

/** Whether the `((` at `index` is arithmetic: the shell pairs the second
 *  `(` with a `)` that another `)` follows. Otherwise it is two subshells.
 *  The table holds, for each kind and index, the index that closes that
 *  kind when its reading is at that index (-1 when nothing does). Each
 *  entry reads only entries after it, so one pass from the end fills it and
 *  the answer depends on the text after the `((` alone. */
export function closesAsArithmetic(
  text: string,
  index: number,
  cache: ProbeCache,
): boolean {
  const table = pairTable(text, cache);
  const close = table[(index + 2) * KINDS + Kind.Group] ?? -1;
  return close >= 0 && text[close + 1] === ")";
}

function pairTable(text: string, cache: ProbeCache): Int32Array {
  const known = cache.pairTables?.get(text);
  if (known !== undefined) return known;
  const table = new Int32Array((text.length + 2) * KINDS).fill(-1);
  const read: Reader = { text, table, newline: -1 };
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] === "\n") read.newline = i;
    for (let kind = 0; kind < KINDS; kind += 1)
      table[i * KINDS + kind] = closeFrom(read, kind as Kind, i);
  }
  cache.pairTables ??= new Map();
  cache.pairTables.set(text, table);
  return table;
}

interface Reader {
  text: string;
  table: Int32Array;
  /** The first newline at or after the index being filled. */
  newline: number;
  /** The text's lines, once a heredoc needs them. */
  lines?: LineIndex;
}

function at(read: Reader, kind: Kind, index: number): number {
  if (index < 0 || index > read.text.length) return -1;
  return read.table[index * KINDS + kind] ?? -1;
}

/** The close of `kind` read on from just after a nested construct that
 *  closed at `close`. */
function after(read: Reader, kind: Kind, close: number): number {
  return close < 0 ? -1 : at(read, kind, close + 1);
}

function closeFrom(read: Reader, kind: Kind, i: number): number {
  const c = read.text[i];
  if (kind === Kind.Single) return c === "'" ? i : at(read, kind, i + 1);
  if (c === "\\") return at(read, kind, i + 2);
  if (kind === Kind.Ansi) return c === "'" ? i : at(read, kind, i + 1);
  if (kind === Kind.Backtick) return c === "`" ? i : at(read, kind, i + 1);
  if (kind === Kind.Double) return closeDouble(read, i);
  return closeGroup(read, kind, i);
}

function closeDouble(read: Reader, i: number): number {
  const c = read.text[i];
  if (c === '"') return i;
  if (c === "`")
    return after(read, Kind.Double, at(read, Kind.Backtick, i + 1));
  if (c === "$") return closeDollar(read, Kind.Double, i);
  return at(read, Kind.Double, i + 1);
}

const CLOSERS = [")", ")", "", "", "", "", "}", "]", ""];
const OPENERS = ["(", "(", "", "", "", "", "", "[", ""];

/** A grouping construct: quotes nest in it, and so does its own opener,
 *  except in `${…}`, which closes at its first `}`. */
function closeGroup(read: Reader, kind: Kind, i: number): number {
  const c = read.text[i] ?? "";
  if (c === CLOSERS[kind]) return i;
  if (c === OPENERS[kind]) return after(read, kind, at(read, kind, i + 1));
  if (c === "'") return after(read, kind, at(read, Kind.Single, i + 1));
  if (c === '"') return after(read, kind, at(read, Kind.Double, i + 1));
  if (c === "`") return after(read, kind, at(read, Kind.Backtick, i + 1));
  if (c === "$") return closeDollar(read, kind, i);
  if (kind === Kind.Command || kind === Kind.Case)
    return closeCommandText(read, kind, i);
  return at(read, kind, i + 1);
}

/** In a `$(…)` body a comment runs to the end of its line, a heredoc's
 *  body is skipped, and a `case` nests up to its `esac`. */
function closeCommandText(read: Reader, kind: Kind, i: number): number {
  const { text } = read;
  if (text[i] === "#" && /[\s;&|()<>]/.test(text.charAt(i - 1)))
    return at(read, kind, read.newline);
  if (text.startsWith("<<", i) && text[i + 2] !== "<")
    return closeHeredoc(read, kind, i);
  if (kind === Kind.Case && keywordAt(text, i, "esac")) return i + 3;
  if (keywordAt(text, i, "case"))
    return after(read, kind, at(read, Kind.Case, i + 4));
  return at(read, kind, i + 1);
}

/** A heredoc: the rest of its line reads on, and a `)` there closes; from
 *  the next newline its body is skipped. */
function closeHeredoc(read: Reader, kind: Kind, i: number): number {
  const { word, dash, end } = heredocDelimiter(read.text, i);
  const onLine = at(read, kind, end);
  if (word === "" || read.newline < 0) return onLine;
  if (onLine >= 0 && onLine < read.newline) return onLine;
  read.lines ??= lineIndex(read.text);
  const body = heredocBodyEnd(read.lines, read.newline, word, dash);
  return at(read, kind, body);
}

/** A `$` and what it opens: `$'…'`, a `$(…)` body (`$((…))` is one pair),
 *  `${…}` (in an arithmetic group only as a `${ command; }`) and `$[…]`
 *  (not in an arithmetic group). `$$` is one parameter. */
function closeDollar(read: Reader, kind: Kind, i: number): number {
  const next = read.text[i + 1];
  if (next === "$") return at(read, kind, i + 2);
  if (next === "'" && kind !== Kind.Double)
    return after(read, kind, at(read, Kind.Ansi, i + 2));
  if (next === "(") return after(read, kind, commandClose(read, i + 2));
  const arithmetic = kind === Kind.Group || kind === Kind.Bracket;
  if (next === "{" && (!arithmetic || /[\s|]/.test(read.text.charAt(i + 2))))
    return after(read, kind, at(read, Kind.Brace, i + 2));
  if (next === "[" && !arithmetic)
    return after(read, kind, at(read, Kind.Bracket, i + 2));
  return at(read, kind, i + 1);
}

/** The close of a `$(` body that starts at `start`: `$((` is one
 *  arithmetic pair, and a comment may start the body. */
function commandClose(read: Reader, start: number): number {
  const c = read.text[start];
  if (c === "(") return at(read, Kind.Group, start);
  if (c === "#") return at(read, Kind.Command, read.newline);
  return at(read, Kind.Command, start);
}
