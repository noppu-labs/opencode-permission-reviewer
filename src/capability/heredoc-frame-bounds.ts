// Where a construct's text ends, for a heredoc body opened inside it: a
// backtick's closing backtick, and the matching `)` of a `$((` span the shell
// reads as a command substitution rather than as arithmetic.

/** For each index `p`, the index of the `)` that closes a `(` placed just
 *  before `p`: scanning from `p`, the first `)` that leaves no `(` open,
 *  skipping quotes and backslash escapes; `-1` when the text ends first.
 *  One right-to-left pass, so each `$((` reads its match in constant time. */
export function parenCloses(command: string): Int32Array {
  const closes = new Int32Array(command.length + 1).fill(-1);
  for (let p = command.length - 1; p >= 0; p -= 1)
    closes[p] = closeFrom(command, closes, p);
  return closes;
}

/** The `parenCloses` entry for `p`, given the entries after it. */
function closeFrom(command: string, closes: Int32Array, p: number): number {
  const next = skipQuotedOrEscape(command, p);
  if (next !== p) return closes[next] ?? -1;
  const c = command.charAt(p);
  if (c === ")") return p;
  if (c !== "(") return closes[p + 1] ?? -1;
  const inner = closes[p + 1] ?? -1;
  return inner === -1 ? -1 : (closes[inner + 1] ?? -1);
}

/** The index just past the quoted string or backslash escape starting at `i`,
 *  or `i` itself when none starts there. An unterminated quote runs to the
 *  end of the command. */
function skipQuotedOrEscape(command: string, i: number): number {
  const c = command.charAt(i);
  if (c === "\\") return Math.min(i + 2, command.length);
  if (c !== "'" && c !== '"') return i;
  let j = i + 1;
  while (j < command.length && command.charAt(j) !== c)
    j += c === '"' && command.charAt(j) === "\\" ? 2 : 1;
  return Math.min(j + 1, command.length);
}

/** Whether the `$((` opened at `open` is arithmetic: its matched span's
 *  content starts with `(` and ends with `)`. Otherwise bash reads the span as
 *  a command substitution that ends at the matched `)`. `closes` is the
 *  `parenCloses` table of `command`. */
export function isArithmeticSpan(
  command: string,
  open: number,
  closes: Int32Array,
): boolean {
  const close = closes[open + 2] ?? -1;
  if (close === -1) return true;
  return (
    close > open + 2 &&
    command.charAt(open + 2) === "(" &&
    command.charAt(close - 1) === ")"
  );
}

/** The index of the backtick that closes the backtick substitution opened
 *  before `from`: the next one not escaped by a backslash, or `undefined`. */
export function closingBacktick(
  command: string,
  from: number,
): number | undefined {
  for (let i = from; i < command.length; i += 1) {
    const c = command.charAt(i);
    if (c === "\\") i += 1;
    else if (c === "`") return i;
  }
  return undefined;
}

/** The closing index of the innermost frame that bounds a heredoc body, if
 *  any: a backtick, or a `$((` span bash reads as a command substitution. */
export function innermostLimit(
  frames: ReadonlyArray<{ limit?: number }>,
): number | undefined {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const limit = frames[i]?.limit;
    if (limit !== undefined) return limit;
  }
  return undefined;
}

/** Whether a heredoc opened now sits inside a substitution or backtick. A
 *  top-level group does not count. */
export function insideSubstitution(
  frames: ReadonlyArray<{ kind: string }>,
): boolean {
  return frames.some(
    (frame) => frame.kind === "substitution" || frame.kind === "backtick",
  );
}
