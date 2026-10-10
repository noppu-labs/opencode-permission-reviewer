// Evidence derived from the pending bash command itself: the verified ssh script it runs, and its capability facts.

import { analyzeCapability } from "../capability/bash-analyzer.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
} from "../capability/capability-types.ts";
import { parseCommand } from "../capability/command-parser.ts";
import { REVIEWER_PROMPT_VERSION } from "../policy.ts";
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
 * Parse the bash command and derive capability facts. Only computed for bash
 * requests; non-bash permissions have no command surface to analyze. Wrapped in
 * try/catch so a parser bug can never block a review (capability degrades to
 * absent, never throws).
 */
export function analyzeBashCommand(
  request: PermissionRequest,
  ctx: { directory: string; worktree: string },
): {
  parsed?: ParsedCommand | undefined;
  capability?: CapabilityAssessment | undefined;
} {
  if (request.permission !== "bash") return {};
  const command =
    typeof request.metadata.command === "string"
      ? request.metadata.command
      : request.patterns.filter((p) => typeof p === "string").join("\n");
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
