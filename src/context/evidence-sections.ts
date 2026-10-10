// Reviewer prompt section renderers: action purpose, ask decisions, policy summary and the actor-context sections.

import type {
  ActionPurpose,
  ActorContext,
  AskDecision,
  EvidenceCompleteness,
  IntentBlock,
  Provenanced,
  SessionLineage,
} from "../actor-context-types.ts";
import type { PolicyTrace, ReviewEnvelope, ReviewerConfig } from "../types.ts";
import { keepMostRecentBlocks, stableJson } from "./prompt-budget.ts";

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

function provValue<T>(p: Provenanced<T> | undefined): T | "unavailable" {
  return p === undefined ? "unavailable" : p.value;
}

function renderActor(actor: ActorContext, max: number): string {
  return stableJson(
    {
      agent: provValue(actor.agentName),
      mode: provValue(actor.mode),
      profile: provValue(actor.profile),
      identityCompleteness: actor.identityCompleteness,
      sessionID: actor.sessionID,
      parentSessionID: provValue(actor.parentSessionID),
      rootSessionID: provValue(actor.rootSessionID),
      delegationDepth: provValue(actor.delegationDepth),
    },
    max,
  );
}

function renderLineage(lineage: SessionLineage, max: number): string {
  return stableJson(
    {
      origin: lineage.origin ?? "unknown",
      depth: lineage.depth,
      rootSessionID: lineage.rootSessionID,
      cycleDetected: lineage.cycleDetected,
      truncated: lineage.truncated,
      missingParents: lineage.missingParents,
      chain: lineage.nodes.map((n) => ({
        sessionID: n.sessionID,
        ...(n.actorName === undefined ? {} : { actor: n.actorName }),
        ...(n.mode === undefined ? {} : { mode: n.mode }),
      })),
    },
    max,
  );
}

function renderIntentBlocks(
  blocks: IntentBlock[],
  max: number,
  limit = blocks.length,
): string {
  if (blocks.length === 0) return "<none />";
  const ordered = [...blocks].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
  const seen = new Set<string>();
  const distinct = ordered
    .reverse()
    .filter((block) => {
      const key = `${block.actor}:${block.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .reverse();
  return keepMostRecentBlocks(
    distinct.map(
      (block) =>
        `INTENT actor=${block.actor} session=${block.sessionID} message=${block.messageID}${block.createdAt === undefined ? "" : ` created=${block.createdAt}`}\n${block.text}`,
    ),
    max,
  );
}

function renderCompleteness(c: EvidenceCompleteness, max: number): string {
  return stableJson(
    {
      overall: c.overall,
      actor: c.actor,
      lineage: c.lineage,
      directUserIntent: c.directUserIntent,
      delegatedTask: c.delegatedTask,
      purpose: c.purpose,
      capability: c.capability,
      ...(c.reasons.length === 0 ? {} : { reasons: c.reasons }),
    },
    max,
  );
}

function renderCapability(
  cap: import("../capability/capability-types.ts").CapabilityAssessment,
  max: number,
): string {
  return stableJson(
    {
      actionClass: cap.actionClass.value,
      summary: cap.summary,
      executesCode: cap.executesCode.value,
      createsAdHocCode: cap.createsAdHocCode.value,
      invokesPackageLifecycleScripts: cap.invokesPackageLifecycleScripts.value,
      invokesExistingTestRunner: cap.invokesExistingTestRunner.value,
      writeEffects: {
        temporaryWrite: cap.writeEffects.temporaryWrite.value,
        workspaceWrite: cap.writeEffects.workspaceWrite.value,
        externalWrite: cap.writeEffects.externalWrite.value,
        deletion: cap.writeEffects.deletion.value,
      },
      network: {
        observed: cap.network.observed.value,
        possible: cap.network.possible.value,
        ...(cap.network.destinations.length === 0
          ? {}
          : { destinations: cap.network.destinations }),
      },
      process: {
        childProcesses: cap.process.childProcesses.value,
        persistence: cap.process.persistence.value,
        privilegeEscalation: cap.process.privilegeEscalation.value,
      },
      remote: {
        enabled: cap.remote.enabled.value,
        mutationHint: cap.remote.mutationHint.value,
      },
      git: { mutation: cap.git.possible.value },
      parserCompleteness: cap.parserCompleteness,
      ...(cap.analysisWarnings.length === 0
        ? {}
        : { warnings: cap.analysisWarnings }),
    },
    max,
  );
}

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
