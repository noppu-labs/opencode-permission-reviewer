// The review engine's ports for one V2 review: evidence collection through
// the host connection, the backend review and the attempt's liveness.
import type { OpenCodeClient } from "@opencode/client";
import {
  assembleEvidence,
  defaultEvidenceProviders,
} from "../../context/evidence-assembler.ts";
import type { NormalizedReviewRequest } from "../../core/contracts.ts";
import type { ReviewEnginePorts } from "../../core/review-engine.ts";
import type { ReviewEnvelope } from "../../types.ts";
import { createV2ContextReader } from "./context-reader.ts";
import type { ReviewRun } from "./server-state.ts";
import type { ServerRuntime } from "./server-status.ts";

async function collectEvidence(
  server: ServerRuntime,
  run: ReviewRun,
  permission: NormalizedReviewRequest,
  client: OpenCodeClient,
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

export function reviewPorts(
  server: ServerRuntime,
  run: ReviewRun,
  permission: NormalizedReviewRequest,
  client: OpenCodeClient,
): ReviewEnginePorts {
  return {
    active: () => !server.disposed && run.attempt.active(server.generation),
    auxiliarySession: (id: string) => server.backend.owns(id),
    collect: () => collectEvidence(server, run, permission, client),
    review: (evidence: ReviewEnvelope) =>
      server.backend.review(evidence, run.attempt, client),
    observe: () => {},
  };
}
