import {
  caseFields,
  decisionFields,
  modelMetrics,
  pick,
  provenance,
} from "./public-fields.mjs";
import { assert } from "./util.mjs";

const syntheticOrigins = new Set(["authored-synthetic", "metamorphic-context"]);
function assertPublishable(run, summary, results) {
  assert(
    !(run?.models ?? []).some(
      (model) =>
        model.transport === "system-one" || model.format === "system_one",
    ),
    "System One evaluation runs are private and cannot be exported by this harness.",
  );
  assert(
    run?.options?.difficultSubset === undefined,
    "Runs derived from a private System One evaluation cannot be exported by this harness.",
  );
  assert(
    run?.fingerprint && run?.datasetHash && run?.source?.sourceSha256,
    "Missing run provenance.",
  );
  assert(
    run.source.match === true,
    "Public results require the pinned plugin source.",
  );
  assert(
    summary?.complete === true &&
      Array.isArray(results) &&
      results.length === summary.expectedRows,
    "Only complete runs can be published.",
  );
  assert(
    results.every(
      (row) =>
        syntheticOrigins.has(row.origin) &&
        row.runFingerprint === run.fingerprint,
    ),
    "Public results must contain only matching synthetic cases.",
  );
}
export function publicReport(document) {
  const { run, summary, results } = document;
  assertPublishable(run, summary, results);
  const models = (run.models ?? []).map((model) =>
    pick(model, ["id", "model", "format", "transport", "variant"]),
  );
  assert(models.length > 0, "Missing model provenance.");
  const metrics = Object.fromEntries(
    models.map((model) => {
      const scored = summary.models?.[model.id];
      assert(scored, `Missing metrics for ${model.id}.`);
      return [model.id, modelMetrics(scored)];
    }),
  );
  return {
    schemaVersion: 1,
    kind: "synthetic-permission-reviewer-benchmark",
    warning:
      "Single-author synthetic labels; not a production safety certification.",
    provenance: provenance(run),
    models,
    metrics,
    results: results.map((row) => ({
      ...caseFields(row),
      ...decisionFields(row),
    })),
  };
}
