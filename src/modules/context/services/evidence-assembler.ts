import { withTimeout } from "../../../adapters/opencode/transport.ts";
import type { OpenCodeClientLike } from "../../../adapters/opencode/types.ts";
import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { GitEvidenceProvider } from "../../evidence/providers/git-provider.ts";
import { LocalScriptEvidenceProvider } from "../../evidence/providers/local-script-provider.ts";
import { PackageScriptEvidenceProvider } from "../../evidence/providers/package-script-provider.ts";
import type { EvidenceProvider } from "../../evidence/providers/provider.ts";
import { SshEvidenceProvider } from "../../evidence/providers/ssh-provider.ts";
import { parseVerifiedSshScriptCommand } from "../../evidence/ssh/verified-ssh-command.ts";
import type { ScriptAnalysisRegistry } from "../../evidence/ssh/verified-ssh-script.ts";
import type { ContextReader } from "../../review/ports.ts";
import type { ReviewEnvelope } from "../models/review-envelope.ts";
import { resolveActorContext } from "./actor-resolver.ts";
import type { AskDecisionSource } from "./ask-decisions.ts";
import {
  analyzeBashCommand,
  collectVerifiedScript,
} from "./command-evidence.ts";
import { envelopeFrom } from "./evidence-envelope.ts";
import {
  collectFragments,
  contextReader,
  readTranscripts,
  transcriptMessages,
} from "./evidence-sources.ts";

export interface EvidenceAssemblyContext {
  client: OpenCodeClientLike | ContextReader;
  directory: string;
  worktree: string;
  config: ReviewerConfig;
  /** Live ask-decision capture, when enabled. Enrichment-only. */
  askDecisions?: AskDecisionSource;
  scriptRegistry?: ScriptAnalysisRegistry;
}

/**
 * Fetch the session transcript and run every evidence provider concurrently,
 * then fold the fragments into a single {@link ReviewEnvelope}. This is the
 * only place that decides which evidence text reaches the reviewer prompt and
 * which ssh audit summary reaches the audit record.
 */
export async function assembleEvidence(
  request: PermissionRequest,
  providers: EvidenceProvider[],
  ctx: EvidenceAssemblyContext,
): Promise<ReviewEnvelope> {
  const contextStart = performance.now();
  const reader = contextReader(ctx.client);
  // A transcript fetch that never settles would leave the review pending
  // forever; bound it well above any realistic fetch time.
  const responses = await withTimeout(
    readTranscripts(reader, request, ctx),
    Math.min(ctx.config.timeoutMs, 15_000),
  );
  const { messages, intentMessages } = transcriptMessages(responses);

  // Resolve actor/lineage/intent. The resolver is resilient — it never throws,
  // degrading to "unknown" — so this cannot block a review.
  const actor = await resolveActorContext(
    request,
    messages,
    reader,
    ctx.directory,
    ctx.config,
    intentMessages,
  );
  const verifiedCommand = parseVerifiedSshScriptCommand(request);
  const verifiedScript = verifiedCommand
    ? await collectVerifiedScript(verifiedCommand, request, actor, ctx)
    : undefined;
  const { parsed, capability } = analyzeBashCommand(request, ctx);

  const contextMs = performance.now() - contextStart;

  const enrichmentStart = performance.now();
  // The provider phase has per-call bounds (git timeouts, bounded reads) but
  // no global one of its own; a provider that hangs despite them (e.g. a
  // blocking filesystem edge case) must not leave the review pending forever.
  // On timeout the whole assembly fails into the fail-safe escalation path.
  const fragments = await withTimeout(
    collectFragments(request, providers, verifiedScript, ctx),
    Math.min(ctx.config.timeoutMs, 20_000),
  );
  const enrichmentMs = performance.now() - enrichmentStart;

  return envelopeFrom({
    request,
    ctx,
    messages,
    intentMessages,
    actor,
    verifiedScript,
    parsed,
    capability,
    fragments,
    timings: { contextMs, enrichmentMs },
  });
}

/** The default evidence bundle used when callers do not inject their own. */
export function defaultEvidenceProviders(): EvidenceProvider[] {
  return [
    new SshEvidenceProvider(),
    new LocalScriptEvidenceProvider(),
    new PackageScriptEvidenceProvider(),
    new GitEvidenceProvider(),
  ];
}
