import { createHash } from "node:crypto";
import { redactSecrets } from "./redact.ts";
import type { ReviewDecision } from "./types.ts";
import type { VerifiedScriptCommand } from "./verified-ssh-command.ts";

export const VERIFIED_SCRIPT_LIMIT = 64 * 1024;
const RECEIPT_LIFETIME_MS = 60 * 60 * 1000;
const RECEIPT_LIMIT = 64;

export interface VerifiedScriptEvidence {
  sha256: string;
  destination: string;
  port?: number;
  shell: "bash" | "sh";
  bytes?: number;
  status: "full" | "reused" | "unavailable";
  text: string;
  cacheKey?: string;
}

export class ScriptAnalysisRegistry {
  private readonly entries = new Map<
    string,
    { analysis: string; expires: number }
  >();

  key(
    scope: string,
    command: VerifiedScriptCommand,
    configHash: string,
  ): string {
    return JSON.stringify([
      scope,
      command.sha256,
      command.destination,
      command.port ?? 22,
      command.shell,
      configHash,
    ]);
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.expires <= Date.now()) return;
    this.entries.set(key, entry);
    return entry.analysis;
  }

  remember(key: string, analysis: string): void {
    if (
      analysis.length < 20 ||
      analysis.length > 1500 ||
      redactSecrets(analysis) !== analysis
    )
      return;
    this.entries.delete(key);
    this.entries.set(key, {
      analysis,
      expires: Date.now() + RECEIPT_LIFETIME_MS,
    });
    // Map keys iterate oldest first, and deleting the current key does not
    // disturb the iteration.
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= RECEIPT_LIMIT) break;
      this.entries.delete(oldest);
    }
  }

  rememberApproved(
    evidence: VerifiedScriptEvidence | undefined,
    decision: ReviewDecision | undefined,
  ): void {
    if (
      evidence?.status !== "full" ||
      evidence.cacheKey === undefined ||
      decision?.outcome !== "allow" ||
      decision.evidence_completeness !== "sufficient" ||
      decision.script_analysis === undefined
    )
      return;
    this.remember(evidence.cacheKey, decision.script_analysis);
  }
}

export function configFingerprint(config: unknown): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}
