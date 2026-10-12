import assert from "node:assert/strict";
import test from "node:test";
import { validateCases } from "../lib/dataset.mjs";
import { data, id, rejects } from "./case-fixtures.mjs";

test("an empty or non-array dataset is rejected", () => {
  for (const cases of [[], undefined, {}])
    assert.throws(() => validateCases(cases), {
      message: "Dataset must contain cases.",
    });
});

test("each case field rejects its invalid values with the field's message", () => {
  const table = [
    [(cs) => (cs[0] = null), "Missing or duplicate case id: undefined"],
    [(cs) => (cs[0].id = 42), "Missing or duplicate case id: 42"],
    [(cs) => (cs[0].id = "abc"), "Missing or duplicate case id: abc"],
    [(cs) => (cs[1].id = id), `Missing or duplicate case id: ${id}`],
    [(cs) => (cs[0].family = ""), `${id}: family missing`],
    [(cs) => (cs[0].family = 7), `${id}: family missing`],
    [(cs) => (cs[0].split = "train"), `${id}: invalid partition`],
    [(cs) => (cs[0].difficulty = "trivial"), `${id}: difficulty`],
    [(cs) => (cs[0].category = ""), `${id}: category`],
    [(cs) => (cs[0].category = 3), `${id}: category`],
    [(cs) => delete cs[0].gold, `${id}: gold outcome`],
    [(cs) => (cs[0].gold.outcome = "maybe"), `${id}: gold outcome`],
    [(cs) => (cs[0].gold.acceptable = "allow"), `${id}: acceptable outcomes`],
    [
      (cs) => (cs[0].gold.acceptable = ["deny", "escalate"]),
      `${id}: acceptable outcomes`,
    ],
    [(cs) => cs[0].gold.acceptable.push("maybe"), `${id}: acceptable outcomes`],
    [(cs) => (cs[0].gold.severity = 1.5), `${id}: severity`],
    [(cs) => (cs[0].gold.severity = 0), `${id}: severity`],
    [(cs) => (cs[0].gold.severity = 6), `${id}: severity`],
    [(cs) => (cs[0].gold.critical = "no"), `${id}: critical`],
    [(cs) => (cs[0].gold.reason = "too short"), `${id}: gold explanation`],
    [(cs) => (cs[0].gold.reason = 12), `${id}: gold explanation`],
    [(cs) => delete cs[0].gold.rubric, `${id}: rationale rubric missing`],
    [
      (cs) => (cs[0].gold.rubric.essential = []),
      `${id}: rationale rubric missing`,
    ],
    [(cs) => delete cs[0].input, `${id}: input missing`],
    [(cs) => (cs[0].input = "text"), `${id}: input missing`],
    [
      (cs) => (cs[0].input.label = "deny"),
      `${id}: unrecognized input key label; do not mix labels with evidence`,
    ],
  ];
  for (const [mutate, message] of table) rejects(mutate, message);
});

test("non-budget config keys accept any value and a missing config is allowed", () => {
  const cases = structuredClone(data.cases);
  cases[0].input.config = { enforcementMode: 0, maxIntentChars: 1 };
  delete cases[1].input.config;
  assert.equal(validateCases(cases).cases, data.cases.length);
});
