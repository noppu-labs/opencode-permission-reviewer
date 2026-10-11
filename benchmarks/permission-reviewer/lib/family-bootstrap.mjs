import { coreMetrics } from "./core-metrics.mjs";
import { groupBy, quantile, rng } from "./sampling.mjs";
import { assert } from "./util.mjs";

/** One bootstrap draw: `groups.length` families sampled with replacement, renamed draw_0, draw_1, ... */
function familyDraw(groups, random) {
  const sampled = [];
  for (let j = 0; j < groups.length; j++)
    for (const r of groups[Math.floor(random() * groups.length)])
      sampled.push({ ...r, family: `draw_${j}` });
  return sampled;
}
export function bootstrapScore(
  rows,
  layer = "model",
  { iterations = 500, seed = 17 } = {},
) {
  const groups = [...groupBy(rows, "family").values()],
    random = rng(seed),
    scores = [];
  if (groups.length < 2 || iterations === 0) return null;
  for (let i = 0; i < iterations; i++) {
    const score = coreMetrics(familyDraw(groups, random), layer).primaryScore;
    if (score !== null) scores.push(score);
  }
  if (!scores.length) return null;
  return {
    method: "percentile bootstrap, resampling whole families with all repeats",
    iterations,
    validResamples: scores.length,
    seed,
    low: quantile(scores, 0.025),
    high: quantile(scores, 0.975),
    confidence: 0.95,
    warning:
      "Synthetic-family uncertainty only, not a production incident-rate guarantee.",
  };
}
function pairedIndex(left, right, layer) {
  assert(
    ["model", "effective"].includes(layer),
    "Comparison layer must be model or effective.",
  );
  const l = new Map(left.map((r) => [`${r.caseId}/${r.repeat}`, r])),
    rr = new Map(right.map((r) => [`${r.caseId}/${r.repeat}`, r]));
  assert(
    l.size === left.length && rr.size === right.length,
    "Compare expects exactly one model on each side and no duplicate attempts.",
  );
  assert(
    l.size === rr.size && [...l.keys()].every((k) => rr.has(k)),
    "Paired comparison requires exactly the same case IDs and repeat indexes.",
  );
  for (const [k, r] of l)
    assert(
      r.caseHash === rr.get(k).caseHash,
      `Gold/input changed between runs: ${k}`,
    );
  return { l, rr };
}
/** One paired draw: the same families on both sides, each right row matched to its left row. */
function pairedDraw(groups, random, rr) {
  const a = [],
    b = [];
  for (let j = 0; j < groups.length; j++)
    for (const row of groups[Math.floor(random() * groups.length)]) {
      a.push({ ...row, family: `draw_${j}` });
      b.push({
        ...rr.get(`${row.caseId}/${row.repeat}`),
        family: `draw_${j}`,
      });
    }
  return [a, b];
}
export function compareRows(
  left,
  right,
  { layer = "model", iterations = 1000, seed = 17 } = {},
) {
  const { l, rr } = pairedIndex(left, right, layer);
  const groups = [...groupBy([...l.values()], "family").values()],
    random = rng(seed),
    deltas = [];
  for (let i = 0; i < iterations; i++) {
    const [a, b] = pairedDraw(groups, random, rr);
    const sa = coreMetrics(a, layer).primaryScore,
      sb = coreMetrics(b, layer).primaryScore;
    if (sa !== null && sb !== null) deltas.push(sb - sa);
  }
  const sa = coreMetrics(left, layer).primaryScore,
    sb = coreMetrics(right, layer).primaryScore;
  return {
    layer,
    leftModel: left[0]?.modelId,
    rightModel: right[0]?.modelId,
    deltaRightMinusLeft: sa !== null && sb !== null ? sb - sa : null,
    ci95: { low: quantile(deltas, 0.025), high: quantile(deltas, 0.975) },
    iterations,
    validResamples: deltas.length,
    method:
      "paired cluster bootstrap by semantic family; shared repeat indices",
    warning:
      "Inspect safety counts before choosing by score. A CI crossing zero does not establish a winner.",
  };
}
