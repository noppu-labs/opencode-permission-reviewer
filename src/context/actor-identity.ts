// The requesting actor: agent and mode read from the tool message, the mapped profile, and the lineage-derived session facts.

import type {
  ActorContext,
  Provenanced,
  SessionLineage,
} from "../actor-context-types.ts";
import type {
  ActorProfile,
  MessageWithParts,
  PermissionRequest,
  ReviewerConfig,
} from "../types.ts";
import { prov } from "./provenance.ts";

export const UNKNOWN_STRING = prov<string | undefined>(
  undefined,
  "unavailable",
  "unknown",
);
export const UNKNOWN_PROFILE = prov<ActorProfile>(
  "unknown",
  "unavailable",
  "unknown",
);

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
export function resolveCurrentActor(
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

export function assembleActorContext(
  request: PermissionRequest,
  current: CurrentActor,
  lineage: SessionLineage,
  config: ReviewerConfig,
): ActorContext {
  const agentName = toolMessageFact(current.agentName, current.toolLocated);
  const mode = toolMessageFact(current.mode, current.toolLocated);

  const parentID = lineage.nodes[0]?.parentID;
  const parentSessionID =
    parentID !== undefined
      ? prov<string | undefined>(parentID, "session-api", "confirmed")
      : prov<string | undefined>(undefined, "unavailable", "unknown");

  const identityCompleteness = identityCompletenessOf(current);
  const lineageConfidence = lineage.depth > 0 ? "confirmed" : "unknown";

  return {
    agentName,
    mode,
    profile: resolveProfile(current.agentName, config),
    sessionID: request.sessionID,
    parentSessionID,
    rootSessionID: prov<string>(
      lineage.rootSessionID,
      "session-api",
      lineageConfidence,
    ),
    delegationDepth: prov<number>(
      lineage.depth,
      "session-api",
      lineageConfidence,
    ),
    identityCompleteness,
  };
}

/** A fact read from the tool message: confirmed when the call itself was located. */
function toolMessageFact(
  value: string | undefined,
  toolLocated: boolean,
): Provenanced<string | undefined> {
  return value !== undefined
    ? prov<string | undefined>(
        value,
        "tool-message",
        toolLocated ? "confirmed" : "high",
      )
    : UNKNOWN_STRING;
}

function identityCompletenessOf(
  current: CurrentActor,
): ActorContext["identityCompleteness"] {
  if (current.agentName !== undefined && current.mode !== undefined)
    return "complete";
  if (current.agentName !== undefined || current.mode !== undefined)
    return "partial";
  return "unknown";
}
