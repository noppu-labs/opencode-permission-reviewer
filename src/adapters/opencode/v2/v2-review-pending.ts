import { z } from "zod";
import { buildEvidenceResult } from "../../../modules/context/services/prompt/context.ts";
import {
  buildReviewerPrompt,
  DEFAULT_TENANT_POLICY,
} from "../../../modules/context/services/prompt/policy.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import type {
  ReviewDecision,
  ReviewEnvelope,
  ReviewerConfig,
} from "../../../types.ts";

/** The tool a structured reviewer session returns its decision with. */
export const TOOL = "permission_reviewer_result";

/** The decision tool's input: one version 2 review decision. */
export const resultSchema = z
  .object({
    version: z.literal(2),
    outcome: z.enum(["allow", "deny", "escalate"]),
    risk_level: z.enum(["low", "medium", "high", "critical"]),
    user_authorization: z.enum(["high", "medium", "low", "unknown"]),
    scope_alignment: z.enum(["aligned", "partial", "misaligned", "unknown"]),
    evidence_completeness: z.enum([
      "sufficient",
      "partial",
      "insufficient",
      "unknown",
    ]),
    rationale: z.string().min(3).max(2000),
    confidence: z.number().min(0).max(1),
    script_analysis: z.string().min(20).max(1500).optional(),
  })
  .strict();

/** A review session's prompt and the decisions its reviewer has returned. */
export interface PendingGeneration {
  attempt: ReviewAttempt;
  prompt: string;
  structured: boolean;
  results: ReviewDecision[];
  closing?: boolean;
}

/** Build the review's prompt, folding its evidence completeness into the envelope. */
export function pendingGeneration(
  envelope: ReviewEnvelope,
  attempt: ReviewAttempt,
  config: ReviewerConfig,
): PendingGeneration {
  const evidence = buildEvidenceResult(envelope, config);
  envelope.actionEvidenceComplete =
    envelope.actionEvidenceComplete !== false &&
    evidence.actionEvidenceComplete;
  return {
    attempt,
    prompt: buildReviewerPrompt(
      config.policy ?? DEFAULT_TENANT_POLICY,
      evidence.text,
      config.outputFormat,
    ),
    structured: config.outputFormat === "json_schema",
    results: [],
  };
}
