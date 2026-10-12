/** Minimal JSONC (JSON with comments) parser with zero dependencies.
 *
 * Strips line comments, block comments, and trailing commas (all in a single
 * string-aware pass), then delegates to `JSON.parse`. String contents are
 * preserved verbatim — comment markers and trailing-comma patterns inside
 * strings are NOT stripped.
 *
 * Used by the config loader to read `~/.config/opencode/permission-reviewer.jsonc`
 * and `.opencode/permission-reviewer.jsonc`. Returns `{}` on parse failure so
 * a malformed config file degrades to defaults rather than crashing the plugin.
 */
export function parseJsonc(text: string): Record<string, unknown> {
  try {
    return parseJsoncStrict(text);
  } catch {
    return {};
  }
}

/** Strict variant used by the config loader: throws on a syntax error or on a
 *  top-level non-object so callers can distinguish a malformed config file
 *  (worth warning about) from a missing one (the common case). */
export function parseJsoncStrict(text: string): Record<string, unknown> {
  const stripped = stripCommentsAndTrailingCommas(text);
  const parsed: unknown = JSON.parse(stripped);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("top-level value is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** One strip pass: the text kept so far and the last non-whitespace
 *  character appended to it. When a `}` or `]` arrives right after a `,`, the
 *  comma is a trailing comma and is removed. */
interface StripState {
  out: string;
  lastReal: string;
}

function append(state: StripState, ch: string): void {
  state.out += ch;
  if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r")
    state.lastReal = ch;
}

/** Strip JSONC comments and trailing commas while preserving string contents.
 *  Trailing commas are handled in the same pass as comments (both are
 *  string-aware), so a `,}` inside a string value is never corrupted. */
export function stripCommentsAndTrailingCommas(input: string): string {
  const state: StripState = { out: "", lastReal: "" };
  let i = 0;
  while (i < input.length) i = stripAt(input, i, state);
  return state.out;
}

/** Handle the token starting at `i` and return the index after it. */
function stripAt(input: string, i: number, state: StripState): number {
  const ch = input.charAt(i);
  const next = input[i + 1];
  if (ch === '"') return copyString(input, i, state);
  if (ch === "/" && next === "/") return skipLineComment(input, i);
  if (ch === "/" && next === "*") return skipBlockComment(input, i);
  if ((ch === "}" || ch === "]") && state.lastReal === ",") {
    dropTrailingComma(state);
  }
  append(state, ch);
  return i + 1;
}

/** Copy a string literal verbatim through its closing quote. */
function copyString(input: string, start: number, state: StripState): number {
  append(state, input.charAt(start));
  let i = start + 1;
  while (i < input.length) {
    const c = input.charAt(i);
    append(state, c);
    if (c === "\\" && i + 1 < input.length) {
      append(state, input.charAt(i + 1));
      i += 2;
      continue;
    }
    i += 1;
    if (c === '"') break;
  }
  return i;
}

function skipLineComment(input: string, start: number): number {
  let i = start + 2;
  while (i < input.length && input[i] !== "\n") i += 1;
  return i;
}

function skipBlockComment(input: string, start: number): number {
  let i = start + 2;
  while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
    i += 1;
  }
  return i + 2;
}

/** Walk back over the comma (and any whitespace after it in `out`). */
function dropTrailingComma(state: StripState): void {
  let j = state.out.length - 1;
  while (j >= 0 && state.out[j] !== ",") j -= 1;
  if (j >= 0) state.out = state.out.slice(0, j);
  state.lastReal = "";
}
