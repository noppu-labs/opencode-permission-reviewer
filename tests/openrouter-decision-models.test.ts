import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decisionModelIds,
  pullRequestBody,
  renderDecisionModelsModule,
  updateDecisionModels,
} from "../scripts/openrouter-decision-models";
import { OPENROUTER_DECISION_MODELS } from "../src/modules/config/models/openrouter-decision-models";

const ROOT = join(import.meta.dir, "..");
const fixture: unknown = JSON.parse(
  readFileSync(
    join(ROOT, "tests/fixtures/openrouter-models-response.json"),
    "utf8",
  ),
);

test("keeps only decision models", () =>
  expect(decisionModelIds(fixture)).toEqual([
    "cloudflare/clef",
    "respan/span-01-lite:free",
    "typesafe/jev-1.14",
    "~typesafe/jev-latest",
  ]));

test.each([
  [null],
  [{}],
  [{ data: "x" }],
  [{ data: [{ id: 1 }] }],
  [{ data: [{ id: "a/b", architecture: { output_modalities: ["text"] } }] }],
])("rejects %p", (bad) => expect(() => decisionModelIds(bad)).toThrow());

test("adds new models unbenchmarked, removes vanished ones, leaves incompatible alone", () => {
  const current = {
    models: {
      "typesafe/jev-1.14": { benchmarked: true },
      "gone/model": { benchmarked: false },
    },
    incompatible: { "respan/span-01": "x" },
  };
  const { next, added, removed } = updateDecisionModels(current, [
    "typesafe/jev-1.14",
    "cloudflare/clef",
    "respan/span-01",
  ]);
  expect(next.models).toEqual({
    "cloudflare/clef": { benchmarked: false },
    "typesafe/jev-1.14": { benchmarked: true },
  });
  expect(next.incompatible).toEqual({ "respan/span-01": "x" });
  expect(added).toEqual(["cloudflare/clef"]);
  expect(removed).toEqual(["gone/model"]);
});

test("a run with no changes renders the same module", () =>
  expect(
    renderDecisionModelsModule(
      updateDecisionModels(
        OPENROUTER_DECISION_MODELS,
        Object.keys(OPENROUTER_DECISION_MODELS.models),
      ).next,
    ),
  ).toBe(
    readFileSync(
      join(ROOT, "src/modules/config/models/openrouter-decision-models.ts"),
      "utf8",
    ),
  ));

test("the PR body lists added and removed models", () => {
  const body = pullRequestBody(["cloudflare/clef"], ["gone/model"]);
  expect(body).toContain("`cloudflare/clef`");
  expect(body).toContain("`gone/model`");
  expect(body).toContain("benchmarked: false");
});
