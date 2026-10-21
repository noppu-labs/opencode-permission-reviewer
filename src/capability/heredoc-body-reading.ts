// How the shell reads an unquoted heredoc body before it expands it: line continuations, `<<-` tabs, and the escapes the expansion keeps.

/** The body as its expansion reads it. Its backslash-newline pairs go
 *  first; then, for a `<<-` body (`tabStripped`), every line loses its
 *  leading tabs, so a line that continues another keeps its own. */
export function expandedBody(body: string, tabStripped: boolean): string {
  const joined = joinContinuations(body);
  return tabStripped ? stripTabs(joined) : joined;
}

/** The body with the leading tabs of every line removed. */
export function stripTabs(body: string): string {
  return body
    .split("\n")
    .map((line) => line.replace(/^\t+/, ""))
    .join("\n");
}

/** An unquoted body as the shell hands it on: a backslash before `$`, a
 *  backtick or another backslash is dropped, and the character stays. */
export function unescapedBody(body: string): string {
  return body.includes("\\") ? body.replace(/\\([$`\\])/g, "$1") : body;
}

/** The body without its backslash-newline pairs; `\\` stays a pair. */
function joinContinuations(body: string): string {
  let joined = "";
  let from = 0;
  let at = body.indexOf("\\");
  while (at !== -1) {
    if (body[at + 1] === "\n") {
      joined += body.slice(from, at);
      from = at + 2;
    }
    at = body.indexOf("\\", at + 2);
  }
  return from === 0 ? body : joined + body.slice(from);
}

/** The index after the escape or character at `index` of an expanded body,
 *  or -1 where a `$(` or backtick starts a substitution. A backslash escapes
 *  only `$`, a backtick and another backslash; a `${` is stepped into. */
export function bodyTextStep(text: string, index: number): number {
  const c = text.charAt(index);
  const next = text.charAt(index + 1);
  if (c === "\\") return index + (next !== "" && "$`\\".includes(next) ? 2 : 1);
  if (c === "$" && next === "{") return index + 2;
  if (c === "`" || (c === "$" && next === "(")) return -1;
  return index + 1;
}
