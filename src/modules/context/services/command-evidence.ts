// Evidence derived from the pending bash command itself: the verified ssh script it runs, and its capability facts.

import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import { analyzeCapability } from "../../analysis/capability/bash-analyzer.ts";
import { parseCommand } from "../../analysis/capability/command-parser.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
} from "../../analysis/capability/models/capability-types.ts";
import { reviewedCommand } from "../../analysis/reviewed-command.ts";
import { collectVerifiedSshScript } from "../../evidence/ssh/verified-script-evidence.ts";
import type { VerifiedScriptCommand } from "../../evidence/ssh/verified-ssh-command.ts";
import {
  configFingerprint,
  ScriptAnalysisRegistry,
  type VerifiedScriptEvidence,
} from "../../evidence/ssh/verified-ssh-script.ts";
import type { ActorResolution } from "../models/unknown-resolution.ts";
import type { EvidenceAssemblyContext } from "./evidence-assembler.ts";
import { REVIEWER_PROMPT_VERSION } from "./prompt/policy.ts";

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
