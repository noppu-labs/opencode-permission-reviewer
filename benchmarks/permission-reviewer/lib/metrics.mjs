import { coreMetrics } from "./core-metrics.mjs";
import { bootstrapScore } from "./family-bootstrap.mjs";
import { pairMetrics } from "./pair-metrics.mjs";
import { calibration, operational } from "./run-diagnostics.mjs";
import { groupBy } from "./sampling.mjs";

const layerSummary = (rs, layer, { bootstrap, seed }) => ({
  ...coreMetrics(rs, layer),
  confidenceInterval: bootstrapScore(rs, layer, {
    iterations: bootstrap,
    seed,
  }),
  pairs: pairMetrics(rs, layer),
});
const slices = (rs) =>
  Object.fromEntries(
    ["category", "difficulty", "split", "origin"].map((key) => [
      key,
      Object.fromEntries(
        [...groupBy(rs, key)].map(([k, items]) => [
          k,
          {
            model: coreMetrics(items, "model"),
            effective: coreMetrics(items, "effective"),
          },
        ]),
      ),
    ]),
  );
const modelSummary = (rs, options) => ({
  mode: rs[0]?.runMode ?? "unknown",
  model: layerSummary(rs, "model", options),
  effective: layerSummary(rs, "effective", options),
  reachable: coreMetrics(
    rs.filter((r) => r.reachable),
    "model",
  ),
  deterministicallyBypassed: rs.filter((r) => r.reachable === false).length,
  operational: operational(rs),
  calibration: calibration(rs),
  slices: slices(rs),
  firstAttempt: coreMetrics(
    rs.map((r) => ({ ...r, decision: r.firstDecision ?? null })),
    "model",
  ),
});
export function summarize(rows, { bootstrap = 500, seed = 17 } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    rows: rows.length,
    models: Object.fromEntries(
      [...groupBy(rows, "modelId")].map(([id, rs]) => [
        id,
        modelSummary(rs, { bootstrap, seed }),
      ]),
    ),
    warning:
      "No single score certifies safe real-world use. Retain exact labels, counts, bypassed cases, model outcome, gate outcome, transport failures and rationale review separately.",
  };
}
