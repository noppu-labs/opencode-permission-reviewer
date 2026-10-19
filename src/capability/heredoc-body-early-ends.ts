// The commands a heredoc body runs under bash 3.2, which can end a `$(` in the body at an earlier `)` than later releases and read the text after it as body text.

import { substitutionAt } from "../shell-substitution.ts";
import {
  delimitedSubstitutionEnd,
  readsAsArithmetic,
} from "./delimited-substitution-end.ts";
import { bodyTextStep } from "./heredoc-body-reading.ts";
import { sanitizedText } from "./heredoc-sanitized.ts";

/** Text the scans below may read for one heredoc body, the bodies nested in
 *  it included: twice the input cap (MAX_ANALYSIS_INPUT_CHARS). Past it the
 *  body is unresolved. */
const EARLY_END_CHARS = 262_144;

let remaining: number = EARLY_END_CHARS;

/** Starts the budget for a body that no other body holds. */
export function startEarlyEndBudget(): void {
  remaining = EARLY_END_CHARS;
}

export interface EarlyEndCommands {
  commands: string[];
  unresolved: boolean;
}

interface EarlyScan extends EarlyEndCommands {
  text: string;
  known: ReadonlyMap<number, number>;
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
  const scan: EarlyScan = { text, known, commands: [], unresolved: false };
  let index = 0;
  while (index >= 0 && index < text.length && !scan.unresolved) {
    const after = text.startsWith("$$", index)
      ? index + 2
      : bodyTextStep(text, index);
    index = after < 0 ? substitute(scan, index) : after;
  }
  return { commands: scan.commands, unresolved: scan.unresolved };
}

/** The index after the substitution at `index`, or -1 where bash 3.2
 *  stops expanding the body. */
function substitute(scan: EarlyScan, index: number): number {
  const found = commandAt(scan.text, index);
  if (found === undefined || !charge(scan, found.end - index)) return -1;
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
 *  when nothing ends it. */
function commandAt(text: string, index: number): Found | undefined {
  if (text.charAt(index) === "`") {
    const found = substitutionAt(text, index, false, false);
    if (found?.kind !== "command" || found.end > text.length) return undefined;
    return { command: found.text, end: found.end, arithmetic: false };
  }
  const close = delimitedSubstitutionEnd(text, index + 2);
  if (close < 0) return undefined;
  const command = text.slice(index + 2, close);
  const arithmetic =
    command.startsWith("(") && readsAsArithmetic(command.slice(1));
  return { command, end: close + 1, arithmetic };
}

/** Keeps the command bash 3.2 runs, with its heredocs collapsed and the
 *  commands their bodies run. */
function keep(scan: EarlyScan, text: string): void {
  if (!charge(scan, text.length)) return;
  const read = sanitizedText(text);
  scan.commands.push(read.text);
  for (const nested of read.bodyCommands) scan.commands.push(nested);
  scan.unresolved ||= read.bodyUnresolved;
}

function charge(scan: EarlyScan, chars: number): boolean {
  remaining -= chars;
  scan.unresolved ||= remaining < 0;
  return !scan.unresolved;
}
