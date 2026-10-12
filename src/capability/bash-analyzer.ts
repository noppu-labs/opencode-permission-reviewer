import { resolveActionClass } from "./action-class.ts";
import { hasWriteRedirect, redirectionWritesPath } from "./bash-mutation.ts";
import {
  type AnalysisRoots,
  type CapabilityFacts,
  newCapabilityFacts,
  recordWrite,
} from "./capability-facts.ts";
import { assessmentFrom } from "./capability-report.ts";
import type {
  CapabilityAssessment,
  HeredocRecord,
  ParsedCommand,
  Redirection,
} from "./capability-types.ts";
import { classifyEffectiveCommand } from "./effective-command-classifiers.ts";
import type { CommandContext } from "./execution-classifiers.ts";
import { classifySegmentHeads } from "./segment-heads.ts";
import { classifyCredentialReads } from "./sensitive-path-reads.ts";

/*
 * Bash capability analyzer.
 *
 * Walks a `ParsedCommand` and produces `CapabilityAssessment` facts — each one
 * `Provenanced<boolean | "unknown">` so the reviewer LLM and audit can weigh
 * claims by how reliably they were established. The analyzer never makes a
 * safety decision: it only describes what the action CAN do, what it APPEARS to
 * do, and how completely the command could be analyzed.
 *
 * Reuses the existing lexer's effective-command resolution (wrappers peeled,
 * command-string forms destructured) so privilege prefixes, absolute paths, and
 * `sh -c` bodies are handled consistently with the emergency brake.
 *
 * The passes run in a fixed order and accumulate into one `CapabilityFacts`
 * record. The action class depends on the order below: `claimClass` replaces
 * any earlier class, `claimUnsetClass` keeps the first claim, and
 * `resolveActionClass` fills the class only when no classifier claimed one.
 */

/** Analyze a parsed bash command and produce capability facts. */
export function analyzeCapability(
  parsed: ParsedCommand,
  directory: string,
  worktree: string,
): CapabilityAssessment {
  const facts = newCapabilityFacts();
  const context: CommandContext = {
    directory,
    worktree,
    heredocOutputs: new Set(
      parsed.heredocs.map((h) => h.outputTarget).filter(Boolean) as string[],
    ),
  };
  classifySegmentHeads(parsed.segments, facts);
  for (const cmd of parsed.effective)
    classifyEffectiveCommand(cmd, facts, context);
  classifyCredentialReads(parsed, facts);
  recordRedirectionWrites(parsed.redirections, facts, context);
  recordHeredocWrites(parsed.heredocs, facts, context);
  resolveActionClass(facts);
  return assessmentFrom(parsed, facts);
}

function recordRedirectionWrites(
  redirections: Redirection[][],
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): void {
  for (const segRedirects of redirections) {
    if (!hasWriteRedirect(segRedirects)) continue;
    for (const r of segRedirects) {
      if (redirectionWritesPath(r)) recordWrite(facts, r.target, roots);
    }
  }
}

function recordHeredocWrites(
  heredocs: HeredocRecord[],
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): void {
  for (const h of heredocs) {
    if (h.outputTarget !== undefined) recordWrite(facts, h.outputTarget, roots);
  }
}
