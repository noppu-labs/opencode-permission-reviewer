// One request's review inside its attempt: the reviewing phase, evidence
// collection with its audit bridge, the engine and model call, then the
// disposition and the approved-script memory.

import { createV1ContextReader } from "../../../adapters/opencode/v1/context-reader.ts";
import type {
  PermissionRequest,
  ReviewEnvelope,
  ReviewExecutionResult,
} from "../../../types.ts";
import { invariant } from "../../../utils/invariant.ts";
import { ATTEMPT_REGISTERED } from "../../audit/services/review-coordinator-support.ts";
import { assembleEvidence } from "../../context/services/evidence-assembler.ts";
import type { HandoffInfo } from "../../reviewer/services/backend.ts";
import { rememberEvidence } from "./attempt-evidence.ts";
import {
  type CoordinatorState,
  isSuperseded,
  supersedeResult,
} from "./coordinator-state.ts";
import { applyDisposition } from "./review-disposition.ts";
import { evaluateReview } from "./review-engine.ts";
import { publishHandoffStatus, publishReviewStatus } from "./review-status.ts";

export async function processRequest(
  state: CoordinatorState,
  request: PermissionRequest,
): Promise<ReviewExecutionResult> {
  const attempt = state.attempts.get(request.id);
  invariant(attempt, ATTEMPT_REGISTERED);
  await publishReviewStatus(state, request, "reviewing");
  const result = await evaluateReview(request, state.config, {
    collect: (pending: PermissionRequest) => collectEnvelope(state, pending),
    review: (envelope: ReviewEnvelope) => runReviewer(state, envelope),
    active: () => attempt.active() && !isSuperseded(state, request),
    auxiliarySession: (sessionID: string) => state.backend.owns(sessionID),
    observe: (envelope: ReviewEnvelope) => {
      if (envelope.policyTrace !== undefined) {
        rememberEvidence(state.attempts, request.id, {
          policyTrace: envelope.policyTrace,
        });
      }
    },
  });
  if (!attempt.active()) return supersedeResult();
  const applied = await applyDisposition(state, request, result);
  if (applied.kind === "allow")
    state.scriptRegistry.rememberApproved(
      state.attempts.get(request.id)?.evidence.verifiedScript,
      applied.decision,
    );
  return applied;
}

async function collectEnvelope(
  state: CoordinatorState,
  request: PermissionRequest,
): Promise<ReviewEnvelope> {
  const envelope = await assembleEvidence(request, state.providers, {
    client: createV1ContextReader(
      state.ctx.client,
      state.attempts.get(request.id)?.signal,
    ),
    directory: state.ctx.directory,
    worktree: state.ctx.worktree,
    config: state.config,
    scriptRegistry: state.scriptRegistry,
    ...(state.askDecisions === undefined
      ? {}
      : { askDecisions: state.askDecisions }),
  });
  if (!state.attempts.get(request.id)?.active()) return envelope;
  // Bridge the ssh audit summary from the envelope to the audit record. The
  // envelope carries sshAudit for the reviewer prompt; the audit is written
  // after the model call and reads the per-request bridge so both the success
  // and the error-path audits observe the same ssh summary.
  rememberEvidence(state.attempts, request.id, { sshAudit: envelope.sshAudit });
  if (envelope.actor !== undefined)
    rememberEvidence(state.attempts, request.id, { actor: envelope.actor });
  if (envelope.capability !== undefined) {
    rememberEvidence(state.attempts, request.id, {
      capability: envelope.capability,
    });
  }
  if (envelope.timings !== undefined)
    rememberEvidence(state.attempts, request.id, { timings: envelope.timings });
  if (envelope.evidenceCompleteness !== undefined) {
    rememberEvidence(state.attempts, request.id, {
      evidenceCompleteness: envelope.evidenceCompleteness,
    });
  }
  if (envelope.verifiedScript !== undefined)
    rememberEvidence(state.attempts, request.id, {
      verifiedScript: envelope.verifiedScript,
    });
  if (envelope.askDecisions !== undefined && envelope.askDecisions.length > 0) {
    rememberEvidence(state.attempts, request.id, {
      askDecisions: envelope.askDecisions,
    });
  }
  return envelope;
}

function runReviewer(
  state: CoordinatorState,
  envelope: ReviewEnvelope,
): Promise<ReviewExecutionResult> {
  const attempt = state.attempts.get(envelope.request.id);
  invariant(attempt, ATTEMPT_REGISTERED);
  return state.backend.review(envelope, attempt, (handoff: HandoffInfo) =>
    publishHandoffStatus(state, envelope.request, handoff),
  );
}
