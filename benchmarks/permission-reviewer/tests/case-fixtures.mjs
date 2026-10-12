import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadDataset, validateCases } from "../lib/dataset.mjs";

export const data = await loadDataset(
  fileURLToPath(new URL("../data/cases.jsonl", import.meta.url)),
);
export const id = data.cases[0].id;
/** Validates a copy of the corpus after `mutate` and expects exactly `message`. */
export const rejects = (mutate, message) => {
  const cases = structuredClone(data.cases);
  mutate(cases);
  assert.throws(() => validateCases(cases), { message });
};
