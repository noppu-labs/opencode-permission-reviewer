import type { OpenCodeClientLike } from "../../../adapters/opencode/types.ts";
import { createV1ContextReader } from "../../../adapters/opencode/v1/context-reader.ts";
import type {
  MessageWithParts,
  PermissionRequest,
  ReviewerConfig,
} from "../../../types.ts";
import type { ContextReader } from "../../review/ports.ts";
import type {
  ActorContext,
  EvidenceCompleteness,
  IntentContext,
  SessionLineage,
} from "../models/actor-context-types.ts";
import {
  type ActorResolution,
  unknownResolution,
} from "../models/unknown-resolution.ts";
import { assembleActorContext, resolveCurrentActor } from "./actor-identity.ts";
import { resolveIntent } from "./intent-extraction.ts";
import { walkLineage } from "./session-lineage.ts";

function assessCompleteness(
  actor: ActorContext,
  lineage: SessionLineage,
  intent: IntentContext,
): EvidenceCompleteness {
  const reasons: string[] = [];
  if (actor.identityCompleteness === "unknown")
    reasons.push("actor identity unavailable");
  if (lineage.depth === 0) reasons.push("no parent lineage resolved");
  if (lineage.missingParents.length > 0)
    reasons.push(`missing parents: ${lineage.missingParents.join(", ")}`);
  if (intent.directUserIntent.length === 0)
    reasons.push("no direct user intent recovered");
  if (intent.delegatedTask.length === 0 && lineage.depth > 0)
    reasons.push("no delegation task located");

  const actorOk = actor.identityCompleteness !== "unknown";
  const lineageOk = lineage.depth > 0;
  const directOk = intent.directUserIntent.length > 0;
  const delegatedOk = intent.delegatedTask.length > 0;
  // purpose is filled later by the evidence assembler; default false here so
  // callers that only run the resolver still see an explicit flag.
  const purposeOk = false;
  const score = [true, actorOk, lineageOk, directOk, delegatedOk].filter(
    Boolean,
  ).length;
  const overall: EvidenceCompleteness["overall"] =
    score >= 4 ? "sufficient" : score >= 2 ? "partial" : "insufficient";

  return {
    permission: true,
    actor: actorOk,
    lineage: lineageOk,
    directUserIntent: directOk,
    delegatedTask: delegatedOk,
    purpose: purposeOk,
    capability: false, // no provider produces capability facts yet
    repositoryState: false, // git evidence exists only as enrichment text today
    referencedCode: false,
    reasons,
    overall,
  };
}

// --- public entry point (resilient) -----------------------------------------

/**
 * Resolve actor, lineage and intent for a permission request.
 * NEVER throws: on any failure it returns an "unknown" resolution so the review
 * proceeds. Callers thread the result into the prompt and audit as evidence.
 */
export async function resolveActorContext(
  request: PermissionRequest,
  messages: MessageWithParts[],
  client: OpenCodeClientLike | ContextReader,
  directory: string,
  config: ReviewerConfig,
  intentMessages = messages,
): Promise<ActorResolution> {
  try {
    const reader =
      "messages" in client ? client : createV1ContextReader(client);
    const current = resolveCurrentActor(request, messages);
    const lineage = await walkLineage(
      reader,
      request.sessionID,
      directory,
      config,
    );
    const intent = await resolveIntent(
      request,
      intentMessages,
      lineage,
      reader,
      directory,
      config,
    );
    const actor = assembleActorContext(request, current, lineage, config);
    const completeness = assessCompleteness(actor, lineage, intent);
    return { actor, lineage, intent, completeness };
  } catch (error) {
    return unknownResolution(request, error);
  }
}
