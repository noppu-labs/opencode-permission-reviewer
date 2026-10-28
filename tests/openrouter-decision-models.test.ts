import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decisionModelIds,
  pullRequestBody,
  renderDecisionModelsModule,
  updateDecisionModels,
} from "../scripts/openrouter-decision-models";
import {
  assertNoMassRemoval,
  formatWithBiome,
} from "../scripts/openrouter-decision-models-format";
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

const MODULE_PATH = join(
  ROOT,
  "src/modules/config/models/openrouter-decision-models.ts",
);
const LONG_ID = `vendor/${"m".repeat(53)}`;

test("a model that moves to incompatible while still listed is reported as removed", () => {
  const current = {
    models: { "a/one": { benchmarked: true }, "a/two": { benchmarked: false } },
    incompatible: { "a/one": "bad" },
  };
  const { next, removed } = updateDecisionModels(current, ["a/one", "a/two"]);
  expect(removed).toEqual(["a/one"]);
  expect(Object.keys(next.models)).toEqual(["a/two"]);
});

test("rows wider than the line width render the way Biome formats them", () => {
  expect(LONG_ID).toHaveLength(60);
  const text = renderDecisionModelsModule({
    models: { [LONG_ID]: { benchmarked: true }, "a/b": { benchmarked: false } },
    incompatible: { [LONG_ID]: "requires a different state shape" },
  });
  expect(text).toContain(
    `    "${LONG_ID}": {\n      benchmarked: true,\n    },`,
  );
  expect(text).toContain(
    `    "${LONG_ID}":\n      "requires a different state shape",`,
  );
  expect(text).toBe(formatWithBiome(text, MODULE_PATH));
});

test.each([
  ['says "no"', "double quotes only"],
  ["it's", "single quote only"],
  [`both "a" and 'b' and 'c'`, "more singles than doubles"],
  [`both "a" "b" and 'c'`, "more doubles than singles"],
  ['back\\slash "q" "r" \'x\'', "backslash and quotes"],
])(
  "a reason with quotes renders the way Biome quotes it: %s (%s)",
  (reason) => {
    const text = renderDecisionModelsModule({
      models: { "a/b": { benchmarked: false } },
      incompatible: { "a/b": reason },
    });
    expect(text).toBe(formatWithBiome(text, MODULE_PATH));
  },
);

test("a run that would drop over half of the listed models is refused", () => {
  expect(() => assertNoMassRemoval(4, ["a", "b", "c"], false)).toThrow(
    "OPENROUTER_MODELS_ALLOW_DROP=1",
  );
  expect(() => assertNoMassRemoval(4, ["a", "b"], false)).not.toThrow();
});

test("OPENROUTER_MODELS_ALLOW_DROP lets a mass removal through", () =>
  expect(() =>
    assertNoMassRemoval(4, ["a", "b", "c", "d"], true),
  ).not.toThrow());

test("prototype property names are ordinary ids", () => {
  const { next, added } = updateDecisionModels(
    { models: { "a/b": { benchmarked: true } }, incompatible: {} },
    ["a/b", "constructor", "toString"],
  );
  expect(Object.keys(next.models)).toEqual(["a/b", "constructor", "toString"]);
  expect(added).toEqual(["constructor", "toString"]);
});
