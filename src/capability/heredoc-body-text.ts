// Body text primitives: the terminator-line scan, the byte bound, the dynamic-content check and the output target.

/** Maximum body bytes retained (bounded + redacted for prompt/audit safety). */
const MAX_BODY_BYTES = 4096;

/** Scan the text before a heredoc operator for a trailing `> path` target. */
export function findOutputTarget(beforeOperator: string): string | undefined {
  // Match the last `>` / `>>` redirection target on the start line.
  const trimmed = beforeOperator.replace(/\s+$/, "");
  const match = />>?\s*([^\s|;&<>]+)\s*$/.exec(trimmed);
  const target = match?.[1];
  return target === undefined ? undefined : stripQuotes(target);
}

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const head = token[0];
    const tail = token[token.length - 1];
    if ((head === "'" || head === '"') && head === tail)
      return token.slice(1, -1);
  }
  return token;
}

/** Collect the heredoc body until the delimiter line. Returns the body text and
 *  the index just past the closing delimiter line. */
export function collectBody(
  source: string,
  start: number,
  delimiter: string,
  tabStripped: boolean,
): { body: string; endIndex: number; truncated: boolean } {
  let i = start;
  let body = "";
  let truncated = false;
  while (i < source.length) {
    let lineEnd = source.indexOf("\n", i);
    if (lineEnd === -1) lineEnd = source.length;
    const line = source.slice(i, lineEnd);
    const candidate = tabStripped ? line.replace(/^\t+/, "") : line;
    if (candidate === delimiter) {
      // Preserve the trailing newline in the stream so the lexer still splits
      // the command that follows the heredoc into its own segment.
      return { body, endIndex: lineEnd, truncated };
    }
    body += `${line}\n`;
    if (body.length > MAX_BODY_BYTES * 4) truncated = true;
    i = lineEnd + 1;
  }
  // Unterminated heredoc: treat the remainder as the body (partial).
  truncated = true;
  return { body, endIndex: source.length, truncated };
}

export function boundBody(
  fullBody: string,
  alreadyTruncated: boolean,
): { bounded: string; wasTruncated: boolean } {
  const bytes = Buffer.byteLength(fullBody, "utf8");
  if (bytes <= MAX_BODY_BYTES)
    return { bounded: fullBody, wasTruncated: alreadyTruncated };
  // Truncate by character count as a conservative approximation.
  let cut = 0;
  let len = 0;
  while (cut < fullBody.length && len < MAX_BODY_BYTES) {
    len += Buffer.byteLength(fullBody.charAt(cut), "utf8");
    cut += 1;
  }
  return {
    bounded: `${fullBody.slice(0, cut)}\n…[truncated]`,
    wasTruncated: true,
  };
}

/** Whether the body contains constructs that prevent static analysis. */
export function containsDynamic(
  body: string,
  expansionDisabled: boolean,
): boolean {
  if (expansionDisabled) return false;
  // With expansion enabled, `$VAR`, `$(...)`, and backticks are unresolvable.
  return /\$\(?|`/.test(body);
}
