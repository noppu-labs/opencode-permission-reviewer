// Evidence derived from the pending bash command itself: the verified ssh script it runs, and its capability facts.

import { analyzeCapability } from "../capability/bash-analyzer.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
} from "../capability/capability-types.ts";
import { parseCommand } from "../capability/command-parser.ts";
import { REVIEWER_PROMPT_VERSION } from "../policy.ts";
import { reviewedCommand } from "../reviewed-command.ts";
import type { PermissionRequest } from "../types.ts";
import { collectVerifiedSshScript } from "../verified-script-evidence.ts";
import type { VerifiedScriptCommand } from "../verified-ssh-command.ts";
import {
  configFingerprint,
  ScriptAnalysisRegistry,
  type VerifiedScriptEvidence,
} from "../verified-ssh-script.ts";
import type { EvidenceAssemblyContext } from "./evidence-assembler.ts";
import type { ActorResolution } from "./unknown-resolution.ts";

/** The verified script's evidence, cached per root session (per request session when the lineage is unknown). */
export function collectVerifiedScript(
  command: VerifiedScriptCommand,
  request: PermissionRequest,
  actor: ActorResolution,
  ctx: EvidenceAssemblyContext,
): Promise<VerifiedScriptEvidence> {
  return collectVerifiedSshScript(
    command,
    ctx.directory,
    ctx.worktree,
    actor.lineage.origin === "unknown"
      ? request.sessionID
      : actor.lineage.rootSessionID,
    configFingerprint({
      config: ctx.config,
      prompt: REVIEWER_PROMPT_VERSION,
    }),
    ctx.scriptRegistry ?? new ScriptAnalysisRegistry(),
  );
}

/**
 * Only bash requests have a command to analyze. A parser failure leaves
 * capability absent rather than failing the review.
 */
export function analyzeBashCommand(
  request: PermissionRequest,
  ctx: { directory: string; worktree: string },
): {
  parsed?: ParsedCommand | undefined;
  capability?: CapabilityAssessment | undefined;
} {
  if (request.permission !== "bash") return {};
  const command = reviewedCommand(request);
  if (!command.trim()) return {};
  let parsed: ParsedCommand | undefined;
  try {
    parsed = parseCommand(command);
    return {
      parsed,
      capability: analyzeCapability(parsed, ctx.directory, ctx.worktree),
    };
  } catch {
    // Static analysis is best-effort; absence is non-fatal.
    return { parsed };
  }
}
