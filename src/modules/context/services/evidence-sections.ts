// Reviewer prompt section renderers: action purpose, ask decisions, policy summary and the actor-context sections.

import type {
  ActionPurpose,
  AskDecision,
} from "../../../kernel/actor-context-types.ts";
import type {
  PolicyTrace,
  ReviewerConfig,
} from "../../../kernel/reviewer-config.ts";
import type { ReviewEnvelope } from "../models/review-envelope.ts";
import {
  renderActor,
  renderCompleteness,
  renderIntentBlocks,
  renderLineage,
} from "./actor-sections.ts";
import { renderCapability } from "./capability-section.ts";
import { stableJson } from "./prompt-budget.ts";

export function renderActionPurpose(
  purpose: ActionPurpose | undefined,
  max: number,
  intentReference = false,
): string {
  if (purpose === undefined) {
    return `ACTION_PURPOSE\n${stableJson({ source: "unavailable", confidence: "unknown" }, max)}`;
  }
  return `ACTION_PURPOSE\n${stableJson(
    {
      source: purpose.source,
      confidence: purpose.confidence,
      ...(purpose.text === undefined
        ? {}
        : {
            text:
              intentReference && purpose.source === "intent-derived"
                ? "<see literal intent sections>"
                : purpose.text,
          }),
    },
    max,
  )}`;
}

/** Compact rendering of ask decisions, one line each (UTC time, question,
 *  answer). `undefined` when there is nothing to show so the whole section is
 *  omitted rather than padded with a placeholder. */
export function renderAskDecisions(
  decisions: AskDecision[] | undefined,
): string | undefined {
  if (decisions === undefined || decisions.length === 0) return;
  const lines = [];
  for (const decision of decisions) {
    const time = new Date(decision.at).toISOString().slice(11, 19);
    lines.push(`[${time}Z] Q: ${decision.question} A: ${decision.answer}`);
  }
  // Keep the most recent lines when the block would exceed the budget.
  const maxChars = 1_500;
  while (lines.length > 1 && lines.join("\n").length > maxChars) lines.shift();
  const joined = lines.join("\n");
  return joined.length <= maxChars ? joined : joined.slice(0, maxChars);
}

// --- policy summary section -------------------------------------------------

export function renderPolicySummary(
  trace: PolicyTrace | undefined,
  max: number,
): string {
  if (trace === undefined)
    return "EFFECTIVE_POLICY_SUMMARY\n<no policy evaluation available />";
  return `EFFECTIVE_POLICY_SUMMARY\n${stableJson(
    {
      hash: trace.effectivePolicyHash,
      route: trace.finalRoute,
      mode: trace.mode,
      matches: trace.matchedRules.map((m) => ({
        id: m.id,
        effect: m.effect,
        reason: m.reason,
      })),
    },
    max,
  )}`;
}

// --- actor/lineage/intent prompt sections -----------------------------------

/** Render the actor-context prompt sections, or a single placeholder when
 *  resolution produced nothing (keeps the prompt compact for unknown actors). */
export function actorEvidenceSections(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
): string[] {
  const actor = envelope.actor;
  const lineage = envelope.lineage;
  const intent = envelope.intent;
  const completeness = envelope.evidenceCompleteness;
  if (actor === undefined || lineage === undefined || intent === undefined) {
    return ["ACTOR_CONTEXT\n<unavailable />"];
  }
  const cap = config.maxPartChars * 2;
  const sections = [
    `ACTOR_CONTEXT\n${renderActor(actor, cap)}`,
    `SESSION_LINEAGE\n${renderLineage(lineage, cap)}`,
    `DIRECT_USER_INTENT\n${renderIntentBlocks(intent.directUserIntent, config.maxIntentChars, config.intentMessages)}`,
    `DELEGATED_TASK\n${renderIntentBlocks(intent.delegatedTask, cap)}`,
    `LOCAL_SESSION_CONTEXT\n${lineage.origin === "human-root" ? "<see DIRECT_USER_INTENT />" : renderIntentBlocks(intent.localSessionIntent, cap, config.intentMessages)}`,
  ];
  if (envelope.capability !== undefined) {
    sections.push(
      `CAPABILITY_ASSESSMENT\n${renderCapability(envelope.capability, cap)}`,
    );
  }
  if (completeness !== undefined) {
    sections.push(
      `EVIDENCE_COMPLETENESS\n${renderCompleteness(completeness, cap)}`,
    );
  }
  return sections;
}
