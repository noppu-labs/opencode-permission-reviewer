import { rowBase } from "./run-rows.mjs";

/** One synthetic baseline row: the constant (or gold, for the oracle) outcome for case `c`, with no model call. */
export function baselineRow(id, c, datasetHash) {
  const label = id.startsWith("gold-oracle")
    ? c.gold.outcome
    : id.replace("always-", "");
  const decision = {
    version: 2,
    outcome: label,
    risk_level: "low",
    user_authorization: "high",
    scope_alignment: "aligned",
    evidence_completeness: "sufficient",
    rationale: "Synthetic metric self-test, NOT a real model response.",
    confidence: 1,
  };
  return {
    ...rowBase(
      c,
      { id, model: "NO_MODEL_CALLS", format: "metric-only" },
      0,
      `offline-${datasetHash}`,
    ),
    runMode: "metric-only-baseline",
    status: "valid",
    reachable: true,
    decision,
    firstDecision: decision,
    effective: {
      kind: label,
      reason: "Synthetic identity mapping; production gates NOT applied.",
    },
    attempts: [],
    evidence: "No prompt was sent. This is a scoring self-test only.",
  };
}
