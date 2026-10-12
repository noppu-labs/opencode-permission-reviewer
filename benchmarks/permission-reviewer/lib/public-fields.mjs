const metricFields = [
  "count",
  "families",
  "primaryScore",
  "familyWeightedSafety",
  "familyRecallAllow",
  "familyRecallDeny",
  "familyRecallEscalate",
  "exactAccuracy",
  "acceptableAccuracy",
  "confusion",
  "invalidOrMissing",
  "dangerousApprovals",
  "unsupportedApprovals",
  "criticalApprovals",
  "criticalCases",
  "falseDenials",
  "unnecessaryEscalations",
  "benignAutoApprovalRate",
  "familiesWithAnyUnsafeApproval",
  "allMembersCorrectFamilyRate",
  "observedCriticalGate",
];

export const pick = (value, fields) =>
  Object.fromEntries(fields.map((key) => [key, value?.[key] ?? null]));

const operationalMetrics = (operational) => ({
  httpAttempts: operational?.httpAttempts ?? null,
  transportFailures: operational?.transportFailures ?? null,
  requestsRetried: operational?.requestsRetried ?? null,
  latencyMs: pick(operational?.latencyMs, ["p50", "p95", "mean"]),
  usage: pick(operational?.usage, [
    "inputTokens",
    "outputTokens",
    "attemptsWithMissingUsage",
    "complete",
  ]),
});
export const modelMetrics = (scored) => ({
  model: pick(scored.model, metricFields),
  reachable: pick(scored.reachable, metricFields),
  effective: pick(scored.effective, metricFields),
  firstAttempt: pick(scored.firstAttempt, metricFields),
  operational: operationalMetrics(scored.operational),
});
export const provenance = (run) => ({
  runFingerprint: run.fingerprint,
  datasetHash: run.datasetHash,
  pluginSourceSha256: run.source.sourceSha256,
  pinnedCommit: run.source.pinnedCommit,
  harnessSha256: run.harnessSha256,
  track: run.options?.track ?? null,
  repeats: run.options?.repeats ?? null,
  seed: run.options?.seed ?? null,
});
export const caseFields = (row) => ({
  caseId: row.caseId,
  family: row.family,
  category: row.category,
  split: row.split,
  modelId: row.modelId,
  repeat: row.repeat,
  expected: row.gold?.outcome ?? null,
  acceptable: row.gold?.acceptable ?? [],
  critical: row.gold?.critical ?? false,
  severity: row.gold?.severity ?? null,
  reachable: row.reachable,
  status: row.status,
});
export const decisionFields = (row) => ({
  firstOutcome: row.firstDecision?.outcome ?? null,
  modelOutcome: row.decision?.outcome ?? null,
  modelRisk: row.decision?.risk_level ?? null,
  modelAuthorization: row.decision?.user_authorization ?? null,
  modelScope: row.decision?.scope_alignment ?? null,
  modelEvidence: row.decision?.evidence_completeness ?? null,
  confidence: row.decision?.confidence ?? null,
  effectiveOutcome: row.effective?.kind ?? null,
});
