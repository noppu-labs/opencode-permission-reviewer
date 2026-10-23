import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import {
  isProviderModelId,
  resolveEscalationReviewer,
} from "../../reviewer/services/reviewer-model.ts";
import { withSystemOneRoutingWarnings } from "../../reviewer/services/system-one-routing.ts";
import {
  isStringArray,
  nonEmptyStringOr,
  optional,
  resolveActorProfiles,
  resolveEscalationMode,
  resolveRepositoryTrust,
  systemOneRoutingFields,
  trimmedText,
} from "../models/config-fields.ts";
import {
  CONFIDENCE_FLOORS,
  CONTEXT_BUDGETS,
  integerKnobs,
  LINEAGE_LIMITS,
  numberKnobs,
  REVIEW_TIMEOUT,
  reviewBudgetKnob,
} from "../models/config-knobs.ts";
import { resolvePolicyRules } from "../models/config-policy-rules.ts";
import {
  DEFAULT_RISK_POLICY,
  resolveRiskPolicy,
} from "../models/config-risk-policy.ts";

export const DEFAULT_CONFIG: ReviewerConfig = {
  model: "openai/gpt-6-luna",
  variant: "medium",
  outputFormat: "json_schema",
  timeoutMs: 120_000,
  maxContextChars: 32_000,
  maxPartChars: 8_000,
  maxEnrichmentChars: 24_000,
  maxIntentChars: 8_000,
  transcriptMessages: 12,
  intentMessages: 8,
  historyMessages: 200,
  confidenceThreshold: 0.7,
  systemOneConfidenceThreshold: 0.4,
  systemOneReasoningThreshold: 0.38,
  systemOneEscalation: "standard",
  systemOneDenialReview: false,
  retainReviewSessions: false,
  audit: true,
  debug: false,
  enforcementMode: "observe",
  escalationMode: "manual",
  maxSessionDepth: 8,
  maxParentSessions: 8,
  actorProfiles: {},
  riskPolicy: DEFAULT_RISK_POLICY,
  repositoryTrust: "unknown",
  policyRules: [],
  askDecisions: true,
};

/** Total deadline for a review, shared by the server and TUI watchdog. */
export function reviewBudgetMs(config: ReviewerConfig): number {
  const escalationMs = config.escalationReviewer?.timeoutMs ?? config.timeoutMs;
  return (
    config.reviewBudgetMs ??
    config.timeoutMs + Math.max(config.timeoutMs, escalationMs) + 60_000
  );
}

type FlagKey = "retainReviewSessions" | "audit" | "debug" | "askDecisions";

function flag(source: Record<string, unknown>, key: FlagKey): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : DEFAULT_CONFIG[key];
}

export function resolveConfig(
  options: Record<string, unknown> | undefined,
): ReviewerConfig {
  const source = options ?? {};
  // Key order is part of the output: the server hashes the serialized config.
  const resolved: ReviewerConfig = {
    model: isProviderModelId(source.model)
      ? source.model
      : DEFAULT_CONFIG.model,
    variant: nonEmptyStringOr(source.variant, DEFAULT_CONFIG.variant),
    outputFormat: source.outputFormat === "text" ? "text" : "json_schema",
    ...optional(
      "escalationReviewer",
      resolveEscalationReviewer(source.escalationReviewer, DEFAULT_CONFIG),
    ),
    ...integerKnobs(source, REVIEW_TIMEOUT, DEFAULT_CONFIG),
    ...reviewBudgetKnob(source),
    ...integerKnobs(source, CONTEXT_BUDGETS, DEFAULT_CONFIG),
    ...numberKnobs(source, CONFIDENCE_FLOORS, DEFAULT_CONFIG),
    ...systemOneRoutingFields(source),
    retainReviewSessions: flag(source, "retainReviewSessions"),
    audit: flag(source, "audit"),
    ...optional("auditPath", trimmedText(source.auditPath)),
    ...optional("policy", trimmedText(source.policy)),
    debug: flag(source, "debug"),
    enforcementMode:
      source.enforcementMode === "enforce"
        ? "enforce"
        : DEFAULT_CONFIG.enforcementMode,
    escalationMode: resolveEscalationMode(source.escalationMode),
    ...integerKnobs(source, LINEAGE_LIMITS, DEFAULT_CONFIG),
    actorProfiles: resolveActorProfiles(source.actorProfiles),
    riskPolicy: resolveRiskPolicy(source.riskPolicy),
    repositoryTrust: resolveRepositoryTrust(source.repositoryTrust),
    policyRules: resolvePolicyRules(source.policyRules),
    askDecisions: flag(source, "askDecisions"),
    ...(isStringArray(source.configDegraded) && source.configDegraded.length > 0
      ? { configDegraded: source.configDegraded }
      : {}),
  };
  return withSystemOneRoutingWarnings(resolved, source);
}
