// The words and heredocs the matched-pair reading of a `$(…)` body needs: keywords, delimiters, and the lines of a text, indexed once.

/** The lines of a text by their content: the start of each line, in order,
 *  under keys for the whole line and for a delimiter followed by a `)`, each
 *  also with leading tabs removed (for `<<-`); where each line ends, and
 *  where the `)` after a delimiter is. */
export interface LineIndex {
  starts: Map<string, number[]>;
  ends: Map<number, number>;
  parens: Map<number, number>;
}

export function lineIndex(text: string): LineIndex {
  const index: LineIndex = {
    starts: new Map(),
    ends: new Map(),
    parens: new Map(),
  };
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    index.ends.set(start, end);
    addLine(index, text.slice(start, end), start);
    if (newline < 0) break;
    start = newline + 1;
  }
  return index;
}

function addLine(index: LineIndex, line: string, start: number): void {
  const keys = [`=${line}`, `-${withoutTabs(line)}`];
  const paren = line.indexOf(")");
  if (paren >= 0) {
    let end = paren;
    while (line[end - 1] === " " || line[end - 1] === "\t") end -= 1;
    const word = line.slice(0, end);
    keys.push(`)${word}`, `]${withoutTabs(word)}`);
    index.parens.set(start, start + paren);
  }
  for (const key of keys) {
    const starts = index.starts.get(key) ?? [];
    if (starts.at(-1) !== start) starts.push(start);
    index.starts.set(key, starts);
  }
}

function withoutTabs(line: string): string {
  let start = 0;
  while (line[start] === "\t") start += 1;
  return line.slice(start);
}

/** The delimiter of the heredoc whose `<<` is at `at`, with its quotes and
 *  backslashes removed, whether it is `<<-`, and the index after it. */
export function heredocDelimiter(
  text: string,
  at: number,
): { word: string; dash: boolean; end: number } {
  let i = at + 2;
  const dash = text[i] === "-";
  if (dash) i += 1;
  while (text[i] === " " || text[i] === "\t") i += 1;
  let word = "";
  while (i < text.length && !/[\s;&|()<>]/.test(text.charAt(i))) {
    const [part, next] = delimiterPart(text, i);
    word += part;
    i = next;
  }
  return { word, dash, end: i };
}

/** One quoted string, escaped character or plain character of a
 *  delimiter, and the index after it. */
function delimiterPart(text: string, i: number): [string, number] {
  const c = text.charAt(i);
  if (c === "\\") return [text.charAt(i + 1), i + 2];
  if (c !== "'" && c !== '"') return [c, i + 1];
  const close = text.indexOf(c, i + 1);
  const stop = close < 0 ? text.length : close;
  return [text.slice(i + 1, stop), stop + 1];
}

/** The index the body of a heredoc that starts after the newline at
 *  `newline` ends at: the newline after its delimiter line, or the `)` that
 *  follows the delimiter on that line, which closes the substitution. -1
 *  when no line ends it. */
export function heredocBodyEnd(
  index: LineIndex,
  newline: number,
  word: string,
  dash: boolean,
): number {
  const { starts, ends, parens } = index;
  const line = firstAfter(starts.get(`${dash ? "-" : "="}${word}`), newline);
  const paren = firstAfter(starts.get(`${dash ? "]" : ")"}${word}`), newline);
  if (paren >= 0 && (line < 0 || paren <= line)) return parens.get(paren) ?? -1;
  return line < 0 ? -1 : (ends.get(line) ?? -1);
}

/** The first start in the sorted `starts` after `after`, or -1. */
function firstAfter(starts: number[] | undefined, after: number): number {
  if (starts === undefined) return -1;
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((starts[mid] ?? 0) > after) high = mid;
    else low = mid + 1;
  }
  return starts[low] ?? -1;
}

/** Whether `word` starts a command at `i`: after a separator or a keyword
 *  that a command follows, and before a blank (or a separator, for
 *  `esac`, which may also follow the `in` of an empty `case`). */
export function keywordAt(text: string, i: number, word: string): boolean {
  if (!text.startsWith(word, i)) return false;
  const next = text.charAt(i + word.length);
  const ends = word === "esac" ? /^$|[\s;&|)]/ : /\s/;
  if (!ends.test(next)) return false;
  let j = i - 1;
  while (text[j] === " " || text[j] === "\t") j -= 1;
  if (j < 0 || /[;&|(\n]/.test(text.charAt(j))) return true;
  const lead = text.slice(Math.max(0, j - 5), j + 1);
  return LEADS.test(lead) || (word === "esac" && /(?:^|\s)in$/.test(lead));
}

/** Keywords that a command follows. */
const LEADS = /(?:^|[\s;&|(])(?:then|do|else|elif|\{|!|time)$/;

/** Whether the heredoc extractor's placeholder follows a delimiter that ends
 *  at `end`: the body was already taken out of the text. */
export function collapsedAt(text: string, end: number): boolean {
  return COLLAPSED.test(text.slice(end, end + 32));
}

const COLLAPSED = /^ <HEREDOC:sha256:[0-9a-f]{12}>/;
