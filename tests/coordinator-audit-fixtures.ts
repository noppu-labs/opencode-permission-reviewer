// Fixtures for the review audit writer suite: the writer's call shape, a
// registered attempt, and one fully populated evidence set with its record.

import type { ReviewAuditRecord } from "../src/audit-record.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { ReviewAttempt } from "../src/core/review-attempt.ts";
import { writeReviewAudit } from "../src/core/review-coordinator-support.ts";
import { probeCapabilities } from "../src/opencode/capability-detection.ts";
import type { RuntimeContext } from "../src/opencode/types.ts";
import type { PermissionRequest, ReviewExecutionResult } from "../src/types.ts";
import { decision, MockClient, request } from "./helpers.ts";
import { actor, capability } from "./policy-fixtures.ts";

export interface AuditCall {
  ctx: RuntimeContext;
  /** The attempts registered for the request (none or one). */
  attempts: ReviewAttempt[];
  superseded: boolean;
  result: ReviewExecutionResult;
  logs: unknown[][];
  supersededChecks: PermissionRequest[];
}

/** One place that knows the writer's call shape. */
export function writeAudit(
  call: AuditCall,
  pending = request(),
): Promise<void> {
  return writeReviewAudit(
    {
      ctx: call.ctx,
      config: DEFAULT_CONFIG,
      generation: "gen_1",
      attempts: new Map(call.attempts.map((attempt) => [pending.id, attempt])),
      isSuperseded: (checked: PermissionRequest): boolean => {
        call.supersededChecks.push(checked);
        return call.superseded;
      },
      log: (...entry: unknown[]): void => {
        call.logs.push(entry);
      },
    },
    pending,
    call.result,
    Date.now(),
  );
}

export function auditCall(
  ctx: RuntimeContext,
  attempts: ReviewAttempt[],
  result: ReviewExecutionResult,
): AuditCall {
  return {
    ctx,
    attempts,
    superseded: false,
    result,
    logs: [],
    supersededChecks: [],
  };
}

export function sinkContext(
  records: ReviewAuditRecord[],
  overrides: Pick<Partial<RuntimeContext>, "hostVersion" | "writeAudit"> = {},
): RuntimeContext {
  const client = new MockClient();
  return {
    client,
    capabilities: probeCapabilities(client),
    permissionReply: client.permissionReply,
    directory: "/workspace/project",
    worktree: "/workspace/project",
    writeAudit: async (record: ReviewAuditRecord): Promise<void> => {
      records.push(record);
    },
    ...overrides,
  };
}

export function attemptWith(
  evidence: ReviewAttempt["evidence"],
  application: ReviewAttempt["application"] = "reply-accepted",
): ReviewAttempt {
  const attempt = new ReviewAttempt("gen_1", 60_000, Date.now, () => "rev_1");
  attempt.application = application;
  Object.assign(attempt.evidence, evidence);
  attempt.close("finished");
  return attempt;
}

const ASK_DECISIONS = [1, 2, 3, 4, 5, 6].map((n) => ({
  at: n,
  question: `q${n}`,
  answer: `a${n}`,
}));

const POLICY_TRACE = {
  effectivePolicyHash: "policy_hash",
  matchedRules: [
    { id: "r1", source: "global", effect: "manual", reason: "why" },
  ],
  finalRoute: "manual" as const,
  mode: "observe" as const,
};

export const FULL_EVIDENCE: ReviewAttempt["evidence"] = {
  sshAudit: [{ destination: "host.invalid", stdinStatus: "full" }],
  actor: actor("workspace"),
  capability: {
    ...capability({
      executesCode: true,
      createsAdHocCode: true,
      packageManagement: true,
      writesTemporary: true,
      writesWorkspace: true,
      writesExternal: true,
      deletion: true,
      networkObserved: true,
      credentialRead: true,
      privilegeEscalation: true,
      persistence: true,
      remoteEnabled: true,
      gitMutation: true,
    }),
    analysisWarnings: ["capability warning"],
  },
  policyTrace: POLICY_TRACE,
  timings: { contextMs: 1, reviewerMs: 2 },
  evidenceCompleteness: {
    permission: true,
    actor: true,
    lineage: true,
    directUserIntent: true,
    delegatedTask: false,
    purpose: true,
    capability: true,
    repositoryState: true,
    referencedCode: false,
    reasons: ["evidence reason"],
    overall: "partial",
  },
  verifiedScript: {
    sha256: "a".repeat(64),
    destination: "host.invalid",
    shell: "bash",
    bytes: 42,
    status: "full",
    text: "echo hi",
  },
  askDecisions: ASK_DECISIONS,
};

/** A result without a decision source, so the writer derives one. */
export const FULL_RESULT: ReviewExecutionResult = {
  kind: "deny",
  reason: "too broad",
  decision: decision("deny"),
  reviewerOutcome: "deny",
  escalationDisposition: "deny",
  reviewSessionID: "ses_review",
  reviewerModel: "openai/reasoner",
  reviewerEscalatedFrom: { model: "opencode/jev", reason: "hard" },
};

/** The record for FULL_EVIDENCE and FULL_RESULT, in the writer's key order,
 *  less the clock fields; `computed` supplies the hashes and versions. */
export function fullRecord(
  computed: Partial<ReviewAuditRecord>,
): Record<string, unknown> {
  const denied = decision("deny");
  return {
    schemaVersion: 3,
    reviewID: "rev_1",
    hostRequestID: "per_1",
    hostGeneration: "v1",
    hostVersion: "1.2.3",
    generation: "gen_1",
    directory: "/workspace/project",
    nativeAction: "bash",
    pluginVersion: computed.pluginVersion,
    effectiveConfigHash: computed.effectiveConfigHash,
    actionFingerprint: `v1:${computed.actionHash}`,
    application: "reply-accepted",
    decisionSchemaVersion: computed.decisionSchemaVersion,
    promptVersion: computed.promptVersion,
    decisionSource: "llm-reviewer",
    actionHash: computed.actionHash,
    reviewerModel: "openai/reasoner",
    reviewerEscalatedFrom: { model: "opencode/jev", reason: "hard" },
    requestID: "per_1",
    sessionID: "ses_main",
    permission: "bash",
    outcome: "deny",
    reason: "too broad",
    warnings: ["evidence reason", "capability warning"],
    timings: { contextMs: 1, reviewerMs: 2 },
    evidenceCompleteness: "partial",
    verifiedScript: { sha256: "a".repeat(64), status: "full", bytes: 42 },
    reviewerOutcome: "deny",
    escalationDisposition: "deny",
    riskLevel: denied.risk_level,
    userAuthorization: denied.user_authorization,
    scopeAlignment: denied.scope_alignment,
    confidence: denied.confidence,
    reviewerSessionID: "ses_review",
    rootSessionID: "ses_1",
    actor: {
      name: "test",
      mode: "build",
      profile: "workspace",
      identityCompleteness: "complete",
      identitySource: "static-analysis",
      confidence: "high",
      delegationDepth: 0,
    },
    ssh: [{ destination: "host.invalid", stdinStatus: "full" }],
    capability: {
      actionClass: "read-only",
      summary: "read-only",
      parserCompleteness: "complete-for-supported-form",
      executesCode: true,
      createsAdHocCode: true,
      invokesPackageLifecycleScripts: true,
      writeEffects: {
        temporaryWrite: true,
        workspaceWrite: true,
        externalWrite: true,
        deletion: true,
      },
      networkObserved: true,
      credentialRead: true,
      privilegeEscalation: true,
      persistence: true,
      remoteEnabled: true,
      gitMutation: true,
    },
    policyTrace: POLICY_TRACE,
    askDecisions: ASK_DECISIONS.slice(1),
  };
}
