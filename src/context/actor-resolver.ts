import type {
  ActorContext,
  EvidenceCompleteness,
  IntentContext,
  Provenanced,
  SessionLineage,
} from "../actor-context-types.ts";
import type { ContextReader } from "../core/ports.ts";
import type { OpenCodeClientLike } from "../opencode/types.ts";
import { createV1ContextReader } from "../opencode/v1/context-reader.ts";
import type {
  ActorProfile,
  MessageWithParts,
  PermissionRequest,
  ReviewerConfig,
} from "../types.ts";
import { resolveIntent } from "./intent-extraction.ts";
import { prov } from "./provenance.ts";
import { walkLineage } from "./session-lineage.ts";

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

const UNKNOWN_STRING = prov<string | undefined>(
  undefined,
  "unavailable",
  "unknown",
);
const UNKNOWN_PROFILE = prov<ActorProfile>("unknown", "unavailable", "unknown");

// --- current-session actor (pure, from already-fetched messages) -----------

interface CurrentActor {
  agentName: string | undefined;
  mode: string | undefined;
  toolLocated: boolean;
}

/**
 * Locate the requesting tool call by `request.tool.messageID`/`callID` and read
 * the containing assistant message's `agent`/`mode`.
 * Operates on the message list already fetched by the evidence assembler, so it
 * adds no SDK round-trips.
 */
function resolveCurrentActor(
  request: PermissionRequest,
  messages: MessageWithParts[],
): CurrentActor {
  const tool = request.tool;
  if (!tool?.messageID)
    return { agentName: undefined, mode: undefined, toolLocated: false };
  const container = messages.find((m) => m.info.id === tool.messageID);
  if (!container)
    return { agentName: undefined, mode: undefined, toolLocated: false };
  const info = container.info as Record<string, unknown>;
  const agentName = typeof info.agent === "string" ? info.agent : undefined;
  const mode = typeof info.mode === "string" ? info.mode : undefined;
  // Confirm the specific tool call (callID) exists in the message parts.
  const toolLocated =
    typeof tool.callID === "string" &&
    (container.parts as Array<Record<string, unknown>>).some(
      (part) => part.type === "tool" && part.callID === tool.callID,
    );
  return { agentName, mode, toolLocated };
}

// --- actor context assembly -------------------------------------------------

function resolveProfile(
  agentName: string | undefined,
  config: ReviewerConfig,
): Provenanced<ActorProfile> {
  if (agentName !== undefined) {
    const mapped = config.actorProfiles[agentName];
    if (mapped !== undefined) {
      return prov<ActorProfile>(mapped, "global-config", "confirmed");
    }
  }
  return UNKNOWN_PROFILE;
}

function assembleActorContext(
  request: PermissionRequest,
  current: CurrentActor,
  lineage: SessionLineage,
  config: ReviewerConfig,
): ActorContext {
  const agentName =
    current.agentName !== undefined
      ? prov<string | undefined>(
          current.agentName,
          "tool-message",
          current.toolLocated ? "confirmed" : "high",
        )
      : UNKNOWN_STRING;
  const mode =
    current.mode !== undefined
      ? prov<string | undefined>(
          current.mode,
          "tool-message",
          current.toolLocated ? "confirmed" : "high",
        )
      : UNKNOWN_STRING;

  const parentID = lineage.nodes[0]?.parentID;
  const parentSessionID =
    parentID !== undefined
      ? prov<string | undefined>(parentID, "session-api", "confirmed")
      : prov<string | undefined>(undefined, "unavailable", "unknown");

  const identityCompleteness: ActorContext["identityCompleteness"] =
    current.agentName !== undefined && current.mode !== undefined
      ? "complete"
      : current.agentName !== undefined || current.mode !== undefined
        ? "partial"
        : "unknown";

  return {
    agentName,
    mode,
    profile: resolveProfile(current.agentName, config),
    sessionID: request.sessionID,
    parentSessionID,
    rootSessionID: prov<string>(
      lineage.rootSessionID,
      "session-api",
      lineage.depth > 0 ? "confirmed" : "unknown",
    ),
    delegationDepth: prov<number>(
      lineage.depth,
      "session-api",
      lineage.depth > 0 ? "confirmed" : "unknown",
    ),
    identityCompleteness,
  };
}

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
