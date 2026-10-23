// The review engine's ports for one V2 review: evidence collection through
// the host connection, the backend review and the attempt's liveness.
import {
  assembleEvidence,
  defaultEvidenceProviders,
} from "../../../modules/context/services/evidence-assembler.ts";
import type { NormalizedReviewRequest } from "../../../modules/review/models/contracts.ts";
import type { ReviewEnginePorts } from "../../../modules/review/services/review-engine.ts";
import type { HandoffInfo } from "../../../modules/reviewer/services/backend.ts";
import { createServerUiStatus } from "../../../modules/status/services/ui-action-segments.ts";
import type { PermissionRequest, ReviewEnvelope } from "../../../types.ts";
import { createV2ContextReader } from "./context-reader.ts";
import type { V2HostApi } from "./host-api.ts";
import { reviewerVariant } from "./server-review-outcome.ts";
import type { ReviewRun } from "./server-state.ts";
import { notify, publishStatus, type ServerRuntime } from "./server-status.ts";

async function collectEvidence(
  server: ServerRuntime,
  run: ReviewRun,
  permission: NormalizedReviewRequest,
  client: V2HostApi,
): Promise<ReviewEnvelope> {
  const envelope = await assembleEvidence(
    permission.request,
    defaultEvidenceProviders(),
    {
      client: createV2ContextReader(client, run.attempt.signal),
      directory: server.directory,
      worktree: server.ctx.location.project.directory,
      config: server.config,
      scriptRegistry: server.scriptRegistry,
      ...(server.askDecisions ? { askDecisions: server.askDecisions } : {}),
    },
  );
  run.envelope = envelope;
  envelope.actionEvidenceComplete =
    envelope.actionEvidenceComplete !== false &&
    permission.actionEvidenceComplete;
  return envelope;
}

/** Keeps the first status's `emittedAt`, so a reloaded snapshot shows the total
 *  elapsed time across the hand-off. */
function publishHandoff(
  server: ServerRuntime,
  run: ReviewRun,
  request: PermissionRequest,
  handoff: HandoffInfo,
): void {
  const started = server.statuses.get(request.id)?.emittedAt;
  const status = createServerUiStatus(request, "reviewing", {
    model: handoff.to,
    variant: reviewerVariant(server, handoff.to),
    timeoutMs: run.budget,
    handoff,
    ...(started === undefined ? {} : { emittedAt: started }),
  });
  notify(server, () => publishStatus(server, status));
}

export function reviewPorts(
  server: ServerRuntime,
  run: ReviewRun,
  permission: NormalizedReviewRequest,
  client: V2HostApi,
): ReviewEnginePorts {
  return {
    active: () => !server.disposed && run.attempt.active(server.generation),
    auxiliarySession: (id: string) => server.backend.owns(id),
    collect: () => collectEvidence(server, run, permission, client),
    review: (evidence: ReviewEnvelope) =>
      server.backend.review(
        evidence,
        run.attempt,
        client,
        (handoff: HandoffInfo) =>
          publishHandoff(server, run, permission.request, handoff),
      ),
    observe: () => {},
  };
}
