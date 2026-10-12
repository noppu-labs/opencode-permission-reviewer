import { sourceCommand } from "./evidence/source-command.ts";
import { plannedActions } from "./git-command-plan.ts";
import { verifiedInspection } from "./git-inspection-gate.ts";
import { sanitizeRemoteUrl } from "./git-remote-identity.ts";
import { stateRecord } from "./git-state-record.ts";
import type { PermissionRequest } from "./types.ts";

export interface GitEnrichmentResult {
  text: string;
}

function unavailable(
  reason: string,
  planned: unknown,
  maxChars: number,
): GitEnrichmentResult {
  return {
    text: `GIT_STATE_ANALYSIS\n${JSON.stringify(
      { status: "unavailable", reason, planned },
      null,
      2,
    ).slice(0, maxChars)}`,
  };
}

export async function enrichGitEvidence(
  request: PermissionRequest,
  directory: string,
  maxChars: number,
  worktree?: string,
): Promise<GitEnrichmentResult> {
  if (request.permission !== "bash") return { text: "" };
  const command = sourceCommand(request);
  const planned = plannedActions(command, directory);
  if (!planned.relevant) return { text: "" };
  const publicPlanned = {
    ...planned,
    remoteCandidates: planned.remoteCandidates.map(sanitizeRemoteUrl),
  };
  const inspection = await verifiedInspection(planned, directory, worktree);
  if (!inspection.ok)
    return unavailable(inspection.reason, publicPlanned, maxChars);
  const serialized = JSON.stringify(
    await stateRecord(planned, inspection),
    null,
    2,
  );
  const bounded =
    serialized.length <= maxChars
      ? serialized
      : `${serialized.slice(0, maxChars)}\n<git_enrichment_truncated characters="${serialized.length - maxChars}" />`;
  return { text: `GIT_STATE_ANALYSIS\n${bounded}` };
}
