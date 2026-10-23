// The review envelope folded from the gathered evidence: enrichment text, ssh audit, purpose, transcript sections and completeness.

import type {
  MessageWithParts,
  PermissionRequest,
  ReviewEnvelope,
} from "../../../types.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
} from "../../analysis/capability/models/capability-types.ts";
import type { EvidenceFragment } from "../../evidence/providers/provider.ts";
import type { SshAuditSummary } from "../../evidence/ssh/ssh-evidence.ts";
import type { VerifiedScriptEvidence } from "../../evidence/ssh/verified-ssh-script.ts";
import type { ActorResolution } from "../models/unknown-resolution.ts";
import { resolveActionPurpose } from "./action-purpose.ts";
import type { EvidenceAssemblyContext } from "./evidence-assembler.ts";
import { actionCompleteness } from "./evidence-completeness.ts";
import { scopedAskDecisions } from "./evidence-sources.ts";
import { buildIntentHistory, buildTranscript } from "./prompt/context.ts";

export interface GatheredEvidence {
  request: PermissionRequest;
  ctx: EvidenceAssemblyContext;
  messages: MessageWithParts[];
  intentMessages: MessageWithParts[];
  actor: ActorResolution;
  verifiedScript: VerifiedScriptEvidence | undefined;
  parsed: ParsedCommand | undefined;
  capability: CapabilityAssessment | undefined;
  fragments: EvidenceFragment[];
  timings: Required<
    Pick<NonNullable<ReviewEnvelope["timings"]>, "contextMs" | "enrichmentMs">
  >;
}

export function envelopeFrom(gathered: GatheredEvidence): ReviewEnvelope {
  const { request, ctx, messages, actor, verifiedScript } = gathered;
  const { parsed, capability, fragments } = gathered;
  const enrichment = fragments
    .map((fragment) => fragment.text)
    .filter(Boolean)
    .join("\n\n");

  const sshAudit = sshAuditOf(verifiedScript, fragments);
  const preflightDenial = fragments.find(
    (fragment) => fragment.preflightDenial !== undefined,
  )?.preflightDenial;

  const actionPurpose = resolveActionPurpose(request, actor.intent, messages);
  const askDecisions = scopedAskDecisions(request, actor, ctx);

  const completeness = actionCompleteness(
    request,
    ctx.config,
    actor,
    actionPurpose,
    verifiedScript,
  );

  return {
    request,
    directory: ctx.directory,
    worktree: ctx.worktree,
    timings: gathered.timings,
    transcript: buildTranscript(
      messages,
      ctx.config,
      transcriptOptions(gathered),
    ),
    intentHistory: buildIntentHistory(gathered.intentMessages, ctx.config, {
      delegatedSession: actor.lineage.origin !== "human-root",
    }),
    enrichment,
    ...(verifiedScript === undefined ? {} : { verifiedScript }),
    sshAudit,
    ...(preflightDenial === undefined ? {} : { preflightDenial }),
    actor: actor.actor,
    lineage: actor.lineage,
    intent: actor.intent,
    actionPurpose,
    actionEvidenceComplete: completeness.actionEvidenceComplete,
    evidenceCompleteness: {
      ...actor.completeness,
      purpose: completeness.purposeOk,
      // Capability is computed by the assembler (not in the resolver), so
      // reflect whether the analyzer produced facts for this request.
      capability: capability !== undefined,
      reasons: completeness.reasons,
    },
    ...(parsed === undefined ? {} : { parsedCommand: parsed }),
    ...(capability === undefined ? {} : { capability }),
    ...(askDecisions === undefined || askDecisions.length === 0
      ? {}
      : { askDecisions }),
  };
}

function sshAuditOf(
  verifiedScript: VerifiedScriptEvidence | undefined,
  fragments: EvidenceFragment[],
): SshAuditSummary[] {
  const sshFragment = fragments.find((fragment) => fragment.kind === "ssh");
  return verifiedScript
    ? [
        {
          destination: verifiedScript.destination,
          ...(verifiedScript.port === undefined
            ? {}
            : { port: String(verifiedScript.port) }),
          stdinStatus: verifiedScript.status,
        },
      ]
    : (sshFragment?.audit ?? []);
}

function transcriptOptions({
  request,
  actor,
}: GatheredEvidence): Parameters<typeof buildTranscript>[2] {
  return {
    omitUserMessages:
      actor.lineage.origin === "human-root" &&
      actor.intent.directUserIntent.length > 0,
    ...(request.tool === undefined ? {} : { pendingTool: request.tool }),
  };
}
