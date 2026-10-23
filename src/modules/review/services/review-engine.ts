import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type {
  PolicyTrace,
  ReviewerConfig,
} from "../../../kernel/reviewer-config.ts";
import { emergencyBrakeReason } from "../../analysis/brake/emergency-brake.ts";
import type { ReviewEnvelope } from "../../context/models/review-envelope.ts";
import { evaluatePolicy } from "../../policy/policy-engine.ts";
import { applyEscalationDisposition } from "./decision/escalation.ts";
import { gateReviewedResult } from "./review-result-gates.ts";

export interface ReviewEnginePorts {
  collect(request: PermissionRequest): Promise<ReviewEnvelope>;
  review(envelope: ReviewEnvelope): Promise<ReviewExecutionResult>;
  active(): boolean;
  auxiliarySession(sessionID: string): boolean;
  observe(envelope: ReviewEnvelope): void;
}

/** Evaluate policy and evidence without applying a permission or publishing UI. */
export async function evaluateReview(
  request: PermissionRequest,
  config: ReviewerConfig,
  ports: ReviewEnginePorts,
): Promise<ReviewExecutionResult> {
  const early = beforeCollect(request, ports);
  if (early !== undefined) return early;
  const envelope = await ports.collect(request);
  const routed = beforeReview(envelope, config, ports);
  if (routed !== undefined) return routed;
  const result = await ports.review(envelope);
  if (!ports.active()) return superseded();
  return gateReviewedResult(request, config, envelope, result);
}

function superseded(): ReviewExecutionResult {
  return {
    kind: "escalate",
    reason: "Request already answered manually; automatic review superseded.",
    decisionSource: "manual-superseded",
  };
}

function deny(reason: string, emergency: boolean): ReviewExecutionResult {
  return {
    kind: "deny",
    reason,
    decision: {
      version: 2,
      outcome: "deny",
      risk_level: emergency ? "critical" : "high",
      user_authorization: "unknown",
      scope_alignment: "unknown",
      evidence_completeness: "unknown",
      rationale: reason,
      confidence: 1,
    },
    decisionSource: emergency ? "emergency-brake" : "deterministic-policy",
  };
}

function escalate(
  reason: string,
  config: ReviewerConfig,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    { kind: "escalate", reason, decisionSource: "deterministic-policy" },
    config,
    "general",
  );
}

/** The supersede, reviewer-session and emergency-brake checks that run before
 *  any evidence is collected. */
function beforeCollect(
  request: PermissionRequest,
  ports: ReviewEnginePorts,
): ReviewExecutionResult | undefined {
  if (!ports.active()) return superseded();
  if (ports.auxiliarySession(request.sessionID)) {
    return deny(
      "Automatic reviewer sessions may not request additional permissions.",
      true,
    );
  }
  const brake = emergencyBrakeReason(request);
  if (brake) return deny(brake, true);
  return undefined;
}

/** The preflight denial, the policy trace (observed before any route returns)
 *  and the static-analysis gate, in that order, before the model runs. */
function beforeReview(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
  ports: ReviewEnginePorts,
): ReviewExecutionResult | undefined {
  if (envelope.preflightDenial) return deny(envelope.preflightDenial, false);
  if (!ports.active()) return superseded();
  const trace = evaluatePolicy(
    envelope.capability,
    envelope.actor,
    config,
    config.policyRules,
  );
  envelope.policyTrace = trace;
  ports.observe(envelope);
  const routed = enforcedRoute(trace, config);
  if (routed !== undefined) return routed;
  if (!ports.active()) return superseded();
  // Static-analysis limits gate BEFORE the model runs: a command whose
  // structure could not be fully analyzed must not spend a review (and a
  // simulated model allow must not bypass the protection). The reviewer is
  // skipped entirely and the request escalates deterministically.
  if (envelope.parsedCommand?.analysisTruncated === true) {
    return escalate(
      "Automatic approval is blocked: the command structure exceeded the static analysis depth or expansion budget, so deterministic analysis only covered part of the action.",
      config,
    );
  }
  return undefined;
}

/** In enforce mode a deny or manual route is final; review and allow routes
 *  still go to the reviewer. */
function enforcedRoute(
  trace: PolicyTrace,
  config: ReviewerConfig,
): ReviewExecutionResult | undefined {
  if (config.enforcementMode !== "enforce") return undefined;
  if (trace.finalRoute === "deny") {
    return deny(
      `Declarative policy route: deny. ${trace.matchedRules.map((m) => m.reason).join("; ")}`,
      false,
    );
  }
  if (trace.finalRoute === "manual") {
    return escalate(
      `Declarative policy route: manual. ${trace.matchedRules.map((m) => m.reason).join("; ")}`,
      config,
    );
  }
  return undefined;
}
