import { createHash } from "node:crypto";
import { elementAt } from "../element-at.ts";
import type { HeredocRecord } from "./capability-types.ts";
import { parseDelimiterWord } from "./heredoc-delimiter.ts";

/*
 * Heredoc extraction.
 *
 * Runs BEFORE the shell lexer used by the capability analyzer, so heredoc
 * bodies never become tokens the analyzer walks. The motivating case is:
 *
 *   cat > /tmp/x <<'EOF'
 *   ...arbitrary content...
 *   EOF
 *   bun /tmp/x
 *
 * The extractor returns the command with each heredoc body replaced by a
 * redacted placeholder, plus structured records (delimiter, expansion flag,
 * bounded+redacted body, sha256 of the full body, output target when a `> path`
 * precedes the heredoc, dynamic flag).
 *
 * NOTE: this protects the capability analyzer and evidence providers only.
 * The emergency brake operates on the RAW command independently and does NOT
 * use this extractor — heredoc bodies may still appear as tokens the brake
 * sees. This is a known conservative limitation (the brake may false-positive
 * on destructive text inside a heredoc body, but never false-negative).
 *
 * This is a bounded static parser, not a shell executor: it never expands the
 * body, never runs anything, and marks bodies with unresolvable expansions as
 * dynamic (partial analysis).
 */

/** Maximum body bytes retained (bounded + redacted for prompt/audit safety). */
const MAX_BODY_BYTES = 4096;

/** Result of extracting heredocs from a raw command. */
export interface HeredocExtraction {
  /** Command with heredoc bodies replaced by placeholder tokens. */
  sanitizedCommand: string;
  /** Structured heredoc records. */
  heredocs: HeredocRecord[];
  /** Whether any dynamic construct was detected inside a body. */
  hasDynamicConstructs: boolean;
}

/**
 * Extract every heredoc in `command`, replacing each body with a placeholder
 * `<HEREDOC:sha256:xxxxxxxx>` so the downstream lexer never sees the content.
 *
 * The scan is quote-aware: `<<` inside quoted strings or comments, and the
 * here-string operator `<<<`, are not heredoc starts. Several heredocs may
 * open on one line; their bodies follow in operator order, as in bash.
 */
export function extractHeredocs(command: string): HeredocExtraction {
  const scan: HeredocScan = {
    command,
    heredocs: [],
    hasDynamicConstructs: false,
    out: "",
    cursor: 0,
    i: 0,
    lineStart: 0,
    inSingle: false,
    inDouble: false,
    arithmeticDepth: 0,
    pending: [],
    pieces: [],
  };
  while (scan.i < command.length) scanCharacter(scan);
  if (scan.pending.length > 0) {
    appendText(scan, command.slice(scan.cursor, command.length));
    consumeBodies(scan, command.length, command.length);
    scan.cursor = command.length;
  }
  scan.out += command.slice(scan.cursor);
  return {
    sanitizedCommand: scan.out,
    heredocs: scan.heredocs,
    hasDynamicConstructs: scan.hasDynamicConstructs,
  };
}

/** A heredoc operator whose body has not been read yet. */
interface PendingStart {
  operator: string;
  delimiter: string;
  rawWord: string;
  quoted: boolean;
  resolved: boolean;
  opStart: number;
  wordEnd: number;
  lineStart: number;
}

/** The scanner's state. Text from `cursor` on has not been copied to `out`
 *  yet; `pieces` holds the current start line, with each pending operator in
 *  its place, until the line's bodies are read. */
interface HeredocScan {
  command: string;
  heredocs: HeredocRecord[];
  hasDynamicConstructs: boolean;
  out: string;
  cursor: number;
  i: number;
  lineStart: number;
  inSingle: boolean;
  inDouble: boolean;
  /** Depth of open arithmetic context: `$(( ... ))` anywhere, and
   *  `(( ... ))` at a command position. While open, `<<` is a shift
   *  operator, not a heredoc: treating `1 << 2` as a heredoc would swallow
   *  the rest of the command behind an unterminated "delimiter". */
  arithmeticDepth: number;
  pending: PendingStart[];
  pieces: Array<{ text: string } | { pendingIndex: number }>;
}

/** Advance the scan past the character at `scan.i` (or the construct that
 *  starts there). */
function scanCharacter(scan: HeredocScan): void {
  const { command } = scan;
  const c = command.charAt(scan.i);
  if (scanInsideQuotes(scan, c)) return;
  if (scanQuoteOrEscape(scan, c)) return;
  if (skipComment(scan, c)) return;
  if (scanArithmetic(scan, c)) return;
  if (c === "\n") {
    scanNewline(scan);
    return;
  }
  if (c === "<" && command[scan.i + 1] === "<") {
    scanHeredocOperator(scan);
    return;
  }
  scan.i += 1;
}

function scanInsideQuotes(scan: HeredocScan, c: string): boolean {
  if (scan.inSingle) {
    if (c === "'") scan.inSingle = false;
    scan.i += 1;
    return true;
  }
  if (scan.inDouble) {
    if (c === "\\") scan.i += 1;
    else if (c === '"') scan.inDouble = false;
    scan.i += 1;
    return true;
  }
  return false;
}

function scanQuoteOrEscape(scan: HeredocScan, c: string): boolean {
  if (c === "'") scan.inSingle = true;
  else if (c === '"') scan.inDouble = true;
  else if (c === "\\" && scan.i + 1 < scan.command.length) scan.i += 1;
  else return false;
  scan.i += 1;
  return true;
}

/** A comment hides the rest of its line from the shell, so it can hide no
 *  heredoc either. Stops at the newline. */
function skipComment(scan: HeredocScan, c: string): boolean {
  const { command } = scan;
  if (c !== "#" || !atCommandBoundary(command, scan.i)) return false;
  while (scan.i < command.length && command[scan.i] !== "\n") scan.i += 1;
  return true;
}

/** Whether the character at `i` starts a word at a command position. */
function atCommandBoundary(command: string, i: number): boolean {
  return i === 0 || /[\s;&|()]/.test(command.charAt(i - 1));
}

function scanArithmetic(scan: HeredocScan, c: string): boolean {
  if (scan.arithmeticDepth > 0) {
    if (c === "(") scan.arithmeticDepth += 1;
    else if (c === ")") scan.arithmeticDepth -= 1;
    scan.i += 1;
    return true;
  }
  if (!opensArithmetic(scan.command, scan.i, c)) return false;
  scan.arithmeticDepth = 2;
  scan.i += c === "$" ? 3 : 2;
  return true;
}

/** `$((` anywhere, or `((` at a command position. */
function opensArithmetic(command: string, i: number, c: string): boolean {
  return (
    (c === "$" && command[i + 1] === "(" && command[i + 2] === "(") ||
    (c === "(" && command[i + 1] === "(" && atCommandBoundary(command, i))
  );
}

function scanNewline(scan: HeredocScan): void {
  if (scan.pending.length === 0) {
    scan.lineStart = scan.i + 1;
    scan.i += 1;
    return;
  }
  appendText(scan, scan.command.slice(scan.cursor, scan.i));
  const resume = consumeBodies(scan, scan.i + 1, scan.i);
  scan.out += "\n";
  scan.cursor = resume;
  scan.i = resume;
  scan.lineStart = resume;
}

function scanHeredocOperator(scan: HeredocScan): void {
  const { command, i } = scan;
  let j = i + 2;
  const operator = command[j] === "-" ? "<<-" : "<<";
  if (operator === "<<-") j += 1;
  if (command[j] === "<") {
    // Here-string: the word is an inline argument, not a body.
    scan.i = j + 1;
    return;
  }
  while (j < command.length && (command[j] === " " || command[j] === "\t"))
    j += 1;
  const word = parseDelimiterWord(command, j);
  appendText(scan, command.slice(scan.cursor, i));
  scan.pending.push({
    operator,
    delimiter: word.delimiter,
    rawWord: command.slice(j, word.wordEnd),
    quoted: word.quoted,
    resolved: word.resolved,
    opStart: i,
    wordEnd: word.wordEnd,
    lineStart: scan.lineStart,
  });
  scan.pieces.push({ pendingIndex: scan.pending.length - 1 });
  scan.cursor = word.wordEnd;
  scan.i = word.wordEnd;
}

function appendText(scan: HeredocScan, text: string): void {
  if (text.length === 0) return;
  const last = scan.pieces.at(-1);
  if (last !== undefined && "text" in last) last.text += text;
  else scan.pieces.push({ text });
}

/** One read body, bounded for the record. */
interface BodyRecord {
  bounded: string;
  sha256: string;
  truncated: boolean;
  dynamic: boolean;
  outputTarget?: string;
}

/** Consume the body of every pending heredoc in operator order, emit the
 *  sanitized start line, and return the index the scan continues from.
 *  `lineEnd` is the newline (or end of command) that closed the start
 *  line, so redirections after the operator stay visible. */
function consumeBodies(
  scan: HeredocScan,
  bodyStart: number,
  lineEnd: number,
): number {
  let position = bodyStart;
  const records: BodyRecord[] = [];
  for (const start of scan.pending) {
    const read = readBody(scan.command, position, start);
    position = read.position;
    const record = bodyRecord(scan.command, start, read, lineEnd);
    if (record.dynamic) scan.hasDynamicConstructs = true;
    records.push(record);
  }
  scan.out += sanitizedStartLine(scan, records);
  for (const [index, start] of scan.pending.entries())
    scan.heredocs.push(
      heredocRecord(start, elementAt(records, index, "records")),
    );
  scan.pending.length = 0;
  scan.pieces = [];
  return position;
}

/** Read one pending heredoc's body from `position`; returns it with the
 *  index just past its terminator line. */
function readBody(
  command: string,
  position: number,
  start: PendingStart,
): { body: string; truncated: boolean; position: number } {
  if (start.resolved) {
    const collected = collectBody(
      command,
      position,
      start.delimiter,
      start.operator === "<<-",
    );
    return {
      body: collected.body,
      truncated: collected.truncated,
      position: collected.endIndex + 1,
    };
  }
  // The terminator line cannot be known statically, so no line of the
  // remainder can be proven to be a command: it all becomes the body
  // instead of leaking into the analyzer as tokens.
  return {
    body: command.slice(position),
    truncated: true,
    position: command.length,
  };
}

function bodyRecord(
  command: string,
  start: PendingStart,
  read: { body: string; truncated: boolean },
  lineEnd: number,
): BodyRecord {
  const sha256hex = createHash("sha256").update(read.body).digest("hex");
  const dynamic = start.resolved
    ? containsDynamic(read.body, start.quoted)
    : true;
  const { bounded, wasTruncated } = boundBody(read.body, read.truncated);
  // The output target may sit before the operator (`cat > /tmp/x <<EOF`)
  // or after the delimiter word (`cat <<EOF > /tmp/x`); both positions
  // redirect the same command's output.
  const outputTarget =
    findOutputTarget(command.slice(start.lineStart, start.opStart)) ??
    findOutputTarget(command.slice(start.wordEnd, lineEnd));
  return {
    bounded,
    sha256: sha256hex,
    truncated: wasTruncated,
    dynamic,
    ...(outputTarget === undefined ? {} : { outputTarget }),
  };
}

/** The current start line with each operator and its word replaced by the
 *  placeholder for its body. */
function sanitizedStartLine(scan: HeredocScan, records: BodyRecord[]): string {
  let assembled = "";
  for (const piece of scan.pieces) {
    if ("text" in piece) {
      assembled += piece.text;
      continue;
    }
    const start = elementAt(scan.pending, piece.pendingIndex, "pending");
    const record = elementAt(records, piece.pendingIndex, "records");
    const shown = start.resolved ? start.delimiter : "<unresolved>";
    const safe = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(shown)
      ? shown
      : `'${shown.replace(/'/g, "'\\''")}'`;
    assembled += `${start.operator}${safe} <HEREDOC:sha256:${record.sha256.slice(0, 12)}>`;
  }
  return assembled;
}

function heredocRecord(start: PendingStart, record: BodyRecord): HeredocRecord {
  return {
    delimiter: start.resolved ? start.delimiter : start.rawWord,
    operator: start.operator,
    expansionDisabled: start.quoted,
    bodyBounded: record.bounded,
    bodySha256: record.sha256,
    truncated: record.truncated,
    ...(record.outputTarget === undefined
      ? {}
      : { outputTarget: record.outputTarget }),
    dynamic: record.dynamic,
  };
}

/** Scan the text before a heredoc operator for a trailing `> path` target. */
function findOutputTarget(beforeOperator: string): string | undefined {
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
function collectBody(
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

function boundBody(
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
function containsDynamic(body: string, expansionDisabled: boolean): boolean {
  if (expansionDisabled) return false;
  // With expansion enabled, `$VAR`, `$(...)`, and backticks are unresolvable.
  return /\$\(?|`/.test(body);
}
