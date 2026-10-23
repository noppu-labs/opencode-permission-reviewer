// The evidence reads the assembler starts: both transcript reads, every provider, and the lineage-scoped ask decisions.

import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type {
  EvidenceFragment,
  EvidenceProvider,
} from "../../evidence/providers/provider.ts";
import type { VerifiedScriptEvidence } from "../../evidence/ssh/verified-ssh-script.ts";
import type { MessageWithParts } from "../models/message.ts";
import type { ReviewEnvelope } from "../models/review-envelope.ts";
import type { ActorResolution } from "../models/unknown-resolution.ts";
import type { ContextReader } from "../ports.ts";
import type { EvidenceAssemblyContext } from "./evidence-assembler.ts";
import { normalizeMessages } from "./prompt/context.ts";

/** Both transcript reads, started together; `intentMessages` is optional on the reader. */
export function readTranscripts(
  reader: ContextReader,
  request: PermissionRequest,
  ctx: EvidenceAssemblyContext,
): Promise<[unknown, unknown]> {
  return Promise.all([
    reader.messages(
      request.sessionID,
      ctx.directory,
      Math.max(
        ctx.config.historyMessages,
        ctx.config.transcriptMessages * 2,
        20,
      ),
    ),
    reader.intentMessages?.(
      request.sessionID,
      ctx.directory,
      ctx.config.intentMessages,
    ),
  ]);
}

/** The operational messages, and the literal intent messages (the same list when the reader has no intent read). */
export function transcriptMessages([response, intentResponse]: [
  unknown,
  unknown,
]): { messages: MessageWithParts[]; intentMessages: MessageWithParts[] } {
  const messages = normalizeMessages(response);
  const intentMessages =
    intentResponse === undefined ? messages : normalizeMessages(intentResponse);
  return { messages, intentMessages };
}

/** Start every provider (the ssh one is replaced by a verified script). */
export function collectFragments(
  request: PermissionRequest,
  providers: EvidenceProvider[],
  verifiedScript: VerifiedScriptEvidence | undefined,
  ctx: EvidenceAssemblyContext,
): Promise<EvidenceFragment[]> {
  return Promise.all(
    providers
      .filter((provider) => !(verifiedScript && provider.id === "ssh"))
      .map((provider) =>
        provider.collect({
          request,
          directory: ctx.directory,
          worktree: ctx.worktree,
          maxChars: ctx.config.maxEnrichmentChars,
        }),
      ),
  );
}

/**
 * Ask decisions are visible only along the resolved ancestry: the requesting
 * session plus sessions the lineage walker actually reached. Sibling and
 * unrelated sessions are never in scope.
 */
export function scopedAskDecisions(
  request: PermissionRequest,
  actor: ActorResolution,
  ctx: EvidenceAssemblyContext,
): ReviewEnvelope["askDecisions"] {
  return ctx.config.askDecisions && ctx.askDecisions !== undefined
    ? ctx.askDecisions.recentFor([
        request.sessionID,
        ...(actor.lineage?.nodes.map((node) => node.sessionID) ?? []),
      ])
    : undefined;
}
