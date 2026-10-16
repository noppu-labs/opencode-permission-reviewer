// Where a construct's text ends, for a heredoc body opened inside it: a
// backtick's closing backtick, and the matching `)` of a `$((` span the shell
// reads as a command substitution rather than as arithmetic.

/** The index of the `)` that closes the `$(` at `open` (the first `$` of
 *  `$((`), counting parentheses and skipping quotes and backslash escapes, or
 *  `undefined` when the text ends first. */
export function matchingParen(
  command: string,
  open: number,
): number | undefined {
  let depth = 0;
  for (let i = open + 1; i < command.length; i += 1) {
    const next = skipQuotedOrEscape(command, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    const c = command.charAt(i);
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return undefined;
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
 *  a command substitution that ends at the matched `)`. */
export function isArithmeticSpan(command: string, open: number): boolean {
  const close = matchingParen(command, open);
  if (close === undefined) return true;
  const content = command.slice(open + 2, close);
  return content.startsWith("(") && content.endsWith(")");
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
