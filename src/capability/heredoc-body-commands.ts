// The commands a heredoc body runs when its delimiter is unquoted: the shell expands the body, and each `$(…)` or backtick in it is a command.

import type { ProbeCache } from "../shell-lex-state.ts";
import {
  type FrameCloses,
  type SubstitutionBody,
  substitutionAt,
} from "../shell-substitution.ts";
import { earlyEndCommands } from "./heredoc-body-early-ends.ts";
import { bodyTextStep, expandedBody } from "./heredoc-body-reading.ts";
import { sanitizedText } from "./heredoc-sanitized.ts";
import { chargeScan, startScanBudget } from "./heredoc-scan-budget.ts";

/** How many bodies deep the scanner nests: a command found in a body may hold
 *  a heredoc of its own, whose body is scanned in turn. */
export const MAX_BODY_DEPTH = 8;

export interface BodyCommands {
  /** In source order, each as the text of the substitution that runs it. */
  commands: string[];
  /** The body has a `$(` or backtick with no end, or nests past the depth. */
  unresolved: boolean;
}

/** Adds commands to `into`, with whether their bodies were unresolved. A
 *  collector that is not there is a reading that keeps none. */
export function keepBodyCommands(
  into: BodyCommands | undefined,
  commands: string[],
  unresolved: boolean,
): void {
  if (into === undefined) return;
  for (const command of commands) into.commands.push(command);
  into.unresolved ||= unresolved;
}

/** Adds the commands of one unquoted body to `into`. */
export function addBodyCommands(
  into: BodyCommands,
  body: string,
  tabStripped: boolean,
): void {
  const found = heredocBodyCommands(body, tabStripped);
  keepBodyCommands(into, found.commands, found.unresolved);
}

/** Bodies the scanner is inside, across the calls that recurse into each
 *  other. */
let depth = 0;

/**
 * The commands the substitutions in one unquoted heredoc body run. The shell
 * reads a body like double-quoted text with its quotes literal: a backslash
 * escapes only `$`, a backtick, another backslash and a newline. A `$(`,
 * `$((` and `${` step inside and keep scanning, so substitutions nested in
 * them are found; a `$(` or backtick that `substitutionAt` ends is jumped.
 * `tabStripped` is a `<<-` body: a line that continues another keeps its tabs,
 * and every other line loses its leading ones. The commands bash 3.2 runs
 * where it ends a `$(` at an earlier `)` come after the others.
 */
export function heredocBodyCommands(
  body: string,
  tabStripped: boolean,
): BodyCommands {
  if (depth >= MAX_BODY_DEPTH) return { commands: [], unresolved: true };
  if (depth === 0) startScanBudget(body.length);
  depth += 1;
  try {
    return scanBody(expandedBody(body, tabStripped));
  } finally {
    depth -= 1;
  }
}

interface Scan {
  text: string;
  commands: string[];
  probes: ProbeCache;
  /** Where each frame closed that the probes which found arithmetic read,
   *  so a nested `$((` one of them settled is not probed again. A probe's
   *  text is charged to the request's scan budget (heredoc-scan-budget.ts);
   *  past it the body is unresolved. */
  closes: FrameCloses;
  unresolved: boolean;
  /** The index after each listed substitution, by the index it starts at. */
  ends: Map<number, number>;
}

function scanBody(text: string): BodyCommands {
  const scan: Scan = {
    text,
    commands: [],
    probes: {},
    closes: new Map(),
    unresolved: false,
    ends: new Map(),
  };
  let index = 0;
  while (index < text.length && !scan.unresolved) index = step(scan, index);
  if (scan.unresolved) return { commands: scan.commands, unresolved: true };
  const early = earlyEndCommands(text, scan.ends);
  const listed = new Set(scan.commands);
  const added = early.commands.filter((command) => !listed.has(command));
  return {
    commands: [...scan.commands, ...added],
    unresolved: early.unresolved,
  };
}

/** The index after the character or construct at `index`. */
function step(scan: Scan, index: number): number {
  const after = bodyTextStep(scan.text, index);
  return after < 0 ? substitute(scan, index) : after;
}

function substitute(scan: Scan, index: number): number {
  const { text } = scan;
  if (opensKnownArithmetic(text, index, scan.closes)) return index + 3;
  const backtick = text.charAt(index) === "`";
  const found = substitutionAt(
    text,
    index,
    !backtick,
    false,
    "default",
    "bash",
    scan.probes,
  );
  if (found === undefined || found.end > text.length) {
    scan.unresolved = true;
    return text.length;
  }
  if (found.kind === "command") {
    scan.ends.set(index, found.end);
    keepCommand(scan, found, backtick);
    return found.end;
  }
  if (found.kind !== "arithmetic") return index + 1;
  scan.unresolved = !chargeScan(found.end - index);
  for (const [opened, closed] of found.closes ?? [])
    scan.closes.set(opened, closed);
  return index + 3;
}

/** Whether the `$((` at `index` is one the end-finder already closed as
 *  arithmetic: its subshell frame closes right before its own. */
function opensKnownArithmetic(
  text: string,
  index: number,
  closes: FrameCloses,
): boolean {
  if (!text.startsWith("$((", index)) return false;
  const outer = closes.get(index) ?? closes.get(index + 1);
  const inner = closes.get(index + 2);
  return outer !== undefined && inner !== undefined && outer === inner + 1;
}

/** A command a substitution runs, then the commands that heredocs in it run.
 *  A backtick body in a heredoc keeps `\"` as written, which the double-quote
 *  reading of `substitutionAt` would drop, so a backtick is read as unquoted
 *  and its heredocs collapsed here. */
function keepCommand(
  scan: Scan,
  found: Extract<SubstitutionBody, { kind: "command" }>,
  backtick: boolean,
): void {
  const read = backtick ? sanitizedText(found.text) : found;
  scan.commands.push(read.text);
  for (const command of read.bodyCommands) scan.commands.push(command);
  scan.unresolved ||= read.bodyUnresolved;
}
