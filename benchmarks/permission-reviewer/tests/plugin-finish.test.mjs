import assert from "node:assert/strict";
import test from "node:test";
import { decision } from "./helpers.mjs";
import {
  adapter,
  bashInput,
  core,
  replay,
  textModel,
} from "./plugin-fixtures.mjs";

const gates = await core(
  "src/modules/review/services/decision/decision-gates.ts",
);
const escalation = await core(
  "src/modules/review/services/decision/escalation.ts",
);
const systemOne = await core("src/modules/reviewer/services/review.ts");
const invalid = "Reviewer returned missing, invalid or ambiguous output.";

test("finish gates a parsed decision, a System One review, or a failure-safe escalation, then replays the core", async () => {
  const prepared = await adapter.prepare(bashInput(), textModel);
  const parsed = decision("deny");
  const review = { decision: decision("allow"), difficultReason: "Hard." };
  const expected = [
    [
      [parsed],
      {
        ...gates.enforceDecision(parsed, prepared.config),
        decisionSource: "llm-reviewer",
      },
    ],
    [
      [parsed, undefined, review],
      {
        ...systemOne.enforceParsedSystemOneReview(review, prepared.config),
        decisionSource: "system-one-reviewer",
      },
    ],
  ];
  for (const [errorKind, reason, category] of [
    ["transport", "Benchmark provider request failed.", "reviewer-failure"],
    ["format", invalid, "invalid-decision"],
    [undefined, invalid, "invalid-decision"],
  ])
    expected.push([
      [undefined, errorKind, review],
      escalation.applyEscalationDisposition(
        { kind: "escalate", reason, decisionSource: "failure-safe" },
        prepared.config,
        category,
      ),
    ]);
  const results = await Promise.all(
    expected.map(async ([args, gated]) => {
      const own = await adapter.prepare(bashInput(), textModel);
      const result = await adapter.finish(own, ...args);
      return { result, gated, effective: await replay(own, gated) };
    }),
  );
  for (const { result, gated, effective } of results) {
    assert.deepEqual(Object.keys(result), ["gated", "effective"]);
    assert.deepEqual(result.gated, gated);
    assert.deepEqual(result.effective, effective);
  }
});
