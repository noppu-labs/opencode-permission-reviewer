// Lexing entry points: per-request analysis budgets, the bounded lexing pass, and token-value segments for evidence consumers.

import type { BodyCommands } from "./capability/heredoc-body-commands.ts";
import {
  type HeredocReading,
  MAX_SUBSTITUTION_CHARS,
  type ShellQuoting,
  type SubstitutionBudget,
} from "./shell-lex-state.ts";
import { normalizeShellRedirections } from "./shell-redirections.ts";
import { lexSegments } from "./shell-scanner.ts";
import type { ShellSegment } from "./shell-token.ts";

/** Segments flattened to plain token values plus the separators around each
 *  segment. This is the shared surface evidence consumers (SSH, Git, local
 *  scripts) build on, so the brake's lexer stays the one tokenizer. */
export interface CommandSegment {
  tokens: string[];
  preceding?: string;
  endedBy?: string;
}

export function commandSegments(command: string): CommandSegment[] {
  const segments = lexSegments(command, {
    tokensRemaining: Number.POSITIVE_INFINITY,
    substitutions: "skip",
  });
  return segments.map((segment) => {
    const normalized = normalizeShellRedirections(segment.tokens);
    return {
      tokens: normalized.tokens.map((token) => token.value),
      ...(segment.precededBy === undefined
        ? {}
        : { preceding: segment.precededBy }),
      ...(segment.endedBy === undefined ? {} : { endedBy: segment.endedBy }),
    };
  });
}

/** Ceiling on collected effective commands. Command strings can expand
 *  combinatorially (a level duplicating its script doubles the output), so
 *  past this bound collection stops instead of exhausting time or memory on
 *  adversarial input. */
export const MAX_EFFECTIVE_COMMANDS = 4096;

/** Hard cap on the raw text a single lexing pass accepts, and on the tokens
 *  it may materialize, both checked BEFORE building large structures. */
export const MAX_ANALYSIS_INPUT_CHARS = 131_072;
const MAX_LEX_TOKENS = 16_384;
const MAX_REANALYSIS_CHARS = 262_144;

/** Per-request analysis budget: one instance covers a whole permission
 *  request (every segment, every nested command string), not a single
 *  segment. Without shared counters, an input made of thousands of small
 *  segments stayed under every per-call ceiling while the TOTAL work grew
 *  without bound. `remainingReanalysisChars` bounds the text re-lexed while
 *  destructuring command strings (`sh -c '…'`, `env -S …`). */
export interface AnalysisBudget {
  remainingCommands: number;
  remainingReanalysisChars: number;
  /** Heredoc reading for every command string and substitution this budget
   *  covers. Absent means the default reading. */
  reading?: HeredocReading;
  /** Quote reading for every command string and substitution this budget
   *  covers. Absent means bash's reading. */
  quoting?: ShellQuoting;
  /** Where the commands that heredoc bodies in the re-lexed command strings
   *  run are kept; a walk that does not judge them leaves it unset. */
  bodies?: BodyCommands;
}

export function newAnalysisBudget(
  reading: HeredocReading = "default",
  quoting: ShellQuoting = "bash",
  bodies?: BodyCommands,
): AnalysisBudget {
  const budget: AnalysisBudget = {
    remainingCommands: MAX_EFFECTIVE_COMMANDS,
    remainingReanalysisChars: MAX_REANALYSIS_CHARS,
    reading,
    quoting,
  };
  if (bodies !== undefined) budget.bodies = bodies;
  return budget;
}

function basename(exe: string): string {
  const slash = exe.lastIndexOf("/");
  return slash >= 0 ? exe.slice(slash + 1) : exe;
}

/** Bounded lexing pass: refuses oversized input up front and stops at the
 *  token cap, reporting `truncated` so no caller mistakes a prefix for the
 *  whole command. */
export interface LexAnalysis {
  segments: ShellSegment[];
  truncated: boolean;
  /** The commands the heredocs inside substitution bodies run, in source
   *  order, and whether one of those bodies could not be read to the end.
   *  They are kept beside the segments, which hold only the text as it was
   *  lexed. Empty under the previous release's heredoc reading. */
  bodyCommands: string[];
  bodyUnresolved: boolean;
}

export function lexSegmentsBounded(
  command: string,
  reading: HeredocReading = "default",
  quoting: ShellQuoting = "bash",
): LexAnalysis {
  if (command.length > MAX_ANALYSIS_INPUT_CHARS)
    return {
      segments: [],
      truncated: true,
      bodyCommands: [],
      bodyUnresolved: false,
    };
  const bodies: BodyCommands = { commands: [], unresolved: false };
  const state: SubstitutionBudget = {
    tokensRemaining: MAX_LEX_TOKENS,
    substitutions: "lex",
    substitutionCharsRemaining: MAX_SUBSTITUTION_CHARS,
    reading,
    quoting,
    bodies,
  };
  const segments = lexSegments(command, state);
  return {
    segments,
    truncated: state.tokensRemaining <= 0,
    bodyCommands: bodies.commands,
    bodyUnresolved: bodies.unresolved,
  };
}

export { basename as shellBasename };
