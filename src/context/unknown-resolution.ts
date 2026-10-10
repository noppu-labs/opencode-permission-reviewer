// The resolution result shape, and the "unknown" resolution returned when actor resolution fails outright.

import type {
  ActorContext,
  EvidenceCompleteness,
  IntentContext,
  SessionLineage,
} from "../actor-context-types.ts";
import type { PermissionRequest } from "../types.ts";
import { UNKNOWN_PROFILE, UNKNOWN_STRING } from "./actor-identity.ts";
import { prov } from "./provenance.ts";

/**
 * Result of actor/lineage resolution. All fields are populated
 * even when the SDK is unavailable: the resolver degrades honestly to
 * "unknown"/"unavailable" rather than throwing, so a review never fails because
 * actor metadata could not be fetched (unknown actors are first-class).
 */
export interface ActorResolution {
  actor: ActorContext;
  lineage: SessionLineage;
  intent: IntentContext;
  completeness: EvidenceCompleteness;
}

/** Fallback used when resolution fails outright. Exposed for tests. */
export function unknownResolution(
  request: PermissionRequest,
  error: unknown,
): ActorResolution {
  const message = error instanceof Error ? error.message : String(error);
  const lineage: SessionLineage = {
    origin: "unknown",
    nodes: [{ sessionID: request.sessionID }],
    rootSessionID: request.sessionID,
    depth: 0,
    cycleDetected: false,
    truncated: false,
    missingParents: [],
  };
  const actor: ActorContext = {
    agentName: UNKNOWN_STRING,
    mode: UNKNOWN_STRING,
    profile: UNKNOWN_PROFILE,
    sessionID: request.sessionID,
    parentSessionID: UNKNOWN_STRING,
    rootSessionID: prov<string>(request.sessionID, "unavailable", "unknown"),
    delegationDepth: prov<number>(0, "unavailable", "unknown"),
    identityCompleteness: "unknown",
  };
  const intent: IntentContext = {
    directUserIntent: [],
    delegatedTask: [],
    localSessionIntent: [],
    conflictingInstructions: [],
    completeness: "insufficient",
  };
  return {
    actor,
    lineage,
    intent,
    completeness: {
      permission: true,
      actor: false,
      lineage: false,
      directUserIntent: false,
      delegatedTask: false,
      purpose: false,
      capability: false,
      repositoryState: false,
      referencedCode: false,
      reasons: [`actor resolution failed: ${message}`],
      overall: "insufficient",
    },
  };
}
