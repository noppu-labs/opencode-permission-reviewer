// The commands a heredoc body runs under bash 3.2, which can end a `$(` in the body at an earlier `)` than later releases and read the text after it as body text.

import { substitutionAt } from "../../shell/shell-substitution.ts";
import {
  type ArithmeticReads,
  readsAsArithmeticAt,
} from "./delimited-arithmetic.ts";
import {
  type DelimitedCloses,
  delimitedSubstitutionEnd,
} from "./delimited-substitution-end.ts";
import { bodyTextStep } from "./heredoc-body-reading.ts";
import { sanitizedText } from "./heredoc-sanitized.ts";
import { chargeScan } from "./heredoc-scan-budget.ts";
import { keepBodyScripts } from "./heredoc-scripts.ts";

export interface EarlyEndCommands {
  commands: string[];
  unresolved: boolean;
  /** The scripts of the heredocs in those commands, by placeholder. */
  scripts?: Map<string, string[]>;
}

interface EarlyScan extends EarlyEndCommands, ArithmeticReads {
  known: ReadonlyMap<number, number>;
  /** The ends the delimited scans found, kept for the scans after them. */
  closes: DelimitedCloses;
}

/**
 * The commands an expanded body `text` runs under bash 3.2 that the scan of
 * later releases did not list. That scan listed a substitution for each
 * start in `known`, ending at the index it maps to. A substitution with the
 * same start and end adds nothing, and nor does one that ends earlier: its
 * command is the start of the listed one. The scan then goes on from the
 * earlier end, where the rest of the listed command is body text. A `$$` is
 * the shell's process id here, as in every release, so a `(` after it is
 * text.
 */
export function earlyEndCommands(
  text: string,
  known: ReadonlyMap<number, number>,
): EarlyEndCommands {
  const scan: EarlyScan = {
    text,
    known,
    commands: [],
    unresolved: false,
    closes: new Map(),
    counts: new Map(),
  };
  let index = 0;
  while (index >= 0 && index < text.length && !scan.unresolved) {
    const after = text.startsWith("$$", index)
      ? index + 2
      : bodyTextStep(text, index);
    index = after < 0 ? substitute(scan, index) : after;
  }
  const { commands, unresolved, scripts } = scan;
  return { commands, unresolved, ...(scripts && { scripts }) };
}

/** The index after the substitution at `index`, or -1 where bash 3.2
 *  stops expanding the body. */
function substitute(scan: EarlyScan, index: number): number {
  const found = commandAt(scan, index);
  if (found === undefined || scan.unresolved) return -1;
  if (found.arithmetic) return index + 3;
  const listed = scan.known.get(index);
  if (listed === undefined || found.end > listed) keep(scan, found.command);
  return found.end;
}

interface Found {
  command: string;
  end: number;
  arithmetic: boolean;
}

/** The command the backtick or `$(` at `index` runs and the index after it,
 *  or whether bash 3.2 reads the `$((` there as arithmetic; `undefined`
 *  when nothing ends it. Only text a scan reads for the first time is
 *  charged: the ends one scan finds are kept for the scans after it. */
function commandAt(scan: EarlyScan, index: number): Found | undefined {
  const { text } = scan;
  if (text.charAt(index) === "`") {
    const found = substitutionAt(text, index, false, false);
    if (found?.kind !== "command" || found.end > text.length) return undefined;
    charge(scan, found.end - index);
    return { command: found.text, end: found.end, arithmetic: false };
  }
  const fresh = !scan.closes.has(index + 2);
  const close = delimitedSubstitutionEnd(text, index + 2, scan.closes);
  if (fresh) charge(scan, (close < 0 ? text.length : close) - index);
  if (close < 0) return undefined;
  const arithmetic =
    text.charAt(index + 2) === "(" &&
    readsAsArithmeticAt(scan, index, close, (chars) => charge(scan, chars));
  const command = arithmetic ? "" : text.slice(index + 2, close);
  return { command, end: close + 1, arithmetic };
}

/** Keeps the command bash 3.2 runs, with its heredocs collapsed and the
 *  commands their bodies run. */
function keep(scan: EarlyScan, text: string): void {
  if (!charge(scan, text.length)) return;
  const read = sanitizedText(text);
  scan.commands.push(read.text);
  for (const nested of read.bodyCommands) scan.commands.push(nested);
  keepBodyScripts(scan, read.scripts);
  scan.unresolved ||= read.bodyUnresolved;
}

function charge(scan: EarlyScan, chars: number): boolean {
  scan.unresolved ||= !chargeScan(chars);
  return !scan.unresolved;
}
