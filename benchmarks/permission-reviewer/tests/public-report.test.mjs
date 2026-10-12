import assert from "node:assert/strict";
import test from "node:test";
import { publicReport } from "../lib/publication.mjs";

const run = () => ({
  fingerprint: "run-hash",
  datasetHash: "corpus-hash",
  source: { match: true, sourceSha256: "source-hash" },
  models: [{ id: "candidate", model: "candidate-version" }],
});
const sparse = () => ({
  run: run(),
  summary: { complete: true, expectedRows: 1, models: { candidate: {} } },
  results: [{ origin: "metamorphic-context", runFingerprint: "run-hash" }],
});
const nullMetrics = Object.fromEntries(
  [
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
  ].map((key) => [key, null]),
);

test("a sparse complete run exports nulls and empty defaults in the published key order", () => {
  const expected = {
    schemaVersion: 1,
    kind: "synthetic-permission-reviewer-benchmark",
    warning:
      "Single-author synthetic labels; not a production safety certification.",
    provenance: {
      runFingerprint: "run-hash",
      datasetHash: "corpus-hash",
      pluginSourceSha256: "source-hash",
      track: null,
      repeats: null,
      seed: null,
    },
    models: [
      {
        id: "candidate",
        model: "candidate-version",
        format: null,
        transport: null,
        variant: null,
      },
    ],
    metrics: {
      candidate: {
        model: nullMetrics,
        reachable: nullMetrics,
        effective: nullMetrics,
        firstAttempt: nullMetrics,
        operational: {
          httpAttempts: null,
          transportFailures: null,
          requestsRetried: null,
          latencyMs: { p50: null, p95: null, mean: null },
          usage: {
            inputTokens: null,
            outputTokens: null,
            attemptsWithMissingUsage: null,
            complete: null,
          },
        },
      },
    },
    results: [
      {
        expected: null,
        acceptable: [],
        critical: false,
        severity: null,
        firstOutcome: null,
        modelOutcome: null,
        modelRisk: null,
        modelAuthorization: null,
        modelScope: null,
        modelEvidence: null,
        confidence: null,
        effectiveOutcome: null,
      },
    ],
  };
  assert.equal(
    JSON.stringify(publicReport(sparse())),
    JSON.stringify(expected),
  );
});

test("each export refusal names its reason, checked in order", () => {
  const table = [
    [
      (d) => (d.run.models[0].transport = "system-one"),
      "System One evaluation runs are private and cannot be exported by this harness.",
    ],
    [
      (d) => (d.run.models[0].format = "system_one"),
      "System One evaluation runs are private and cannot be exported by this harness.",
    ],
    [
      (d) => (d.run.options = { difficultSubset: null }),
      "Runs derived from a private System One evaluation cannot be exported by this harness.",
    ],
    [(d) => delete d.run, "Missing run provenance."],
    [(d) => delete d.run.fingerprint, "Missing run provenance."],
    [(d) => delete d.run.datasetHash, "Missing run provenance."],
    [(d) => delete d.run.source.sourceSha256, "Missing run provenance."],
    [
      (d) => (d.run.source.match = "yes"),
      "Public results require the pinned plugin source.",
    ],
    [(d) => delete d.summary, "Only complete runs can be published."],
    [(d) => (d.results = {}), "Only complete runs can be published."],
    [
      (d) => (d.summary.expectedRows = 2),
      "Only complete runs can be published.",
    ],
    [
      (d) => (d.results[0].runFingerprint = "other"),
      "Public results must contain only matching synthetic cases.",
    ],
    [(d) => (d.run.models = []), "Missing model provenance."],
    [(d) => delete d.run.models, "Missing model provenance."],
    [(d) => delete d.summary.models, "Missing metrics for candidate."],
  ];
  for (const [mutate, message] of table) {
    const document = sparse();
    mutate(document);
    assert.throws(() => publicReport(document), { message });
  }
});

test("a populated row and provenance keep every published field in order", () => {
  const document = sparse();
  Object.assign(document.run, {
    harnessSha256: "harness-hash",
    options: { track: "reviewer", repeats: 2, seed: 9 },
  });
  document.run.source.pinnedCommit = "commit";
  const row = document.results[0];
  Object.assign(row, {
    caseId: "case-1",
    family: "family-1",
    category: "git",
    split: "dev",
    modelId: "candidate",
    repeat: 0,
    gold: {
      outcome: "deny",
      acceptable: ["deny"],
      critical: true,
      severity: 4,
    },
    reachable: false,
    status: "bypass",
    firstDecision: { outcome: "allow" },
    decision: {
      outcome: "deny",
      risk_level: "high",
      user_authorization: "none",
      scope_alignment: "misaligned",
      evidence_completeness: "partial",
      confidence: 0,
    },
    effective: { kind: "escalate" },
  });
  const report = publicReport(document);
  assert.deepEqual(Object.values(report.provenance), [
    "run-hash",
    "corpus-hash",
    "source-hash",
    "commit",
    "harness-hash",
    "reviewer",
    2,
    9,
  ]);
  assert.deepEqual(Object.values(report.results[0]), [
    "case-1",
    "family-1",
    "git",
    "dev",
    "candidate",
    0,
    "deny",
    ["deny"],
    true,
    4,
    false,
    "bypass",
    "allow",
    "deny",
    "high",
    "none",
    "misaligned",
    "partial",
    0,
    "escalate",
  ]);
});
