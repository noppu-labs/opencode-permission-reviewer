// The reviewer evidence layout: the section order with PENDING_PERMISSION first, and the total evidence budget.

import type { ReviewEnvelope, ReviewerConfig } from "../../../types.ts";
import {
  actorEvidenceSections,
  renderActionPurpose,
  renderPolicySummary,
} from "./evidence-sections.ts";
import { stableJson } from "./prompt-budget.ts";

/** The evidence sections in prompt order. `askDecisions` is the rendered
 *  USER_ASK_DECISIONS body; the section is omitted entirely when it is
 *  undefined: absence of ask decisions carries no signal for the reviewer (the
 *  transcript remains the fallback source). */
export function evidenceSections(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
  pendingText: string,
  askDecisions: string | undefined,
): string[] {
  const canonicalIntent =
    envelope.intent !== undefined && envelope.lineage !== undefined;
  return [
    `PENDING_PERMISSION\n${pendingText}`,
    ...(envelope.verifiedScript === undefined
      ? []
      : [envelope.verifiedScript.text]),
    renderPolicySummary(envelope.policyTrace, config.maxPartChars * 2),
    `WORKING_DIRECTORY\n${envelope.directory}`,
    `WORKTREE\n${envelope.worktree}`,
    // Reserve the leading budget for the exact action before contextual sections.
    ...actorEvidenceSections(envelope, config),
    renderActionPurpose(
      envelope.actionPurpose,
      config.maxPartChars * 2,
      canonicalIntent,
    ),
    envelope.enrichment || "ACTION_ENRICHMENT\n<none />",
    `REPOSITORY_CONTEXT\n${stableJson(
      {
        trust: config.repositoryTrust,
        directory: envelope.directory,
        worktree: envelope.worktree,
      },
      config.maxPartChars * 2,
    )}`,
    `USER_INTENT_HISTORY\n${canonicalIntent ? "<see DIRECT_USER_INTENT />" : envelope.intentHistory || "<no user intent history available />"}`,
    ...(askDecisions === undefined
      ? []
      : [`USER_ASK_DECISIONS\n${askDecisions}`]),
    `RECENT_TRANSCRIPT\n${envelope.transcript || "<no transcript available />"}`,
  ];
}

export function evidenceBudget(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
): number {
  return (
    config.maxContextChars +
    config.maxPartChars * 2 +
    config.maxEnrichmentChars +
    config.maxIntentChars +
    (envelope.verifiedScript?.status === "full"
      ? envelope.verifiedScript.text.length
      : 0)
  );
}
