import { readFile } from "node:fs/promises";
import { INPUT_KEYS } from "./case-input-schema.mjs";
import { OUTCOMES, validateCase, validatePairs } from "./case-schema.mjs";
import { assert, sha256, stable } from "./util.mjs";
export function validateCases(cases) {
  assert(
    Array.isArray(cases) && cases.length > 0,
    "Dataset must contain cases.",
  );
  const seen = { ids: new Set(), families: new Map(), inputs: new Set() };
  for (const c of cases) validateCase(c, seen);
  validatePairs(cases);
  return {
    cases: cases.length,
    families: seen.families.size,
    categories: [...new Set(cases.map((c) => c.category))].sort(),
    outcomes: Object.fromEntries(
      OUTCOMES.map((o) => [
        o,
        cases.filter((c) => c.gold.outcome === o).length,
      ]),
    ),
  };
}
export async function loadDataset(path) {
  const text = await readFile(path, "utf8");
  const cases = text.split("\n").flatMap((line, i) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch (e) {
      throw new Error(`${path}:${i + 1}: ${e.message}`, { cause: e });
    }
  });
  return { cases, hash: sha256(text), validation: validateCases(cases) };
}
/** Explicit whitelist at the adapter boundary. NEVER pass the case or gold to a provider. */
export function modelInput(c) {
  return Object.fromEntries(
    Object.keys(c.input)
      .filter((k) => INPUT_KEYS.has(k))
      .map((k) => [k, structuredClone(c.input[k])]),
  );
}
export function selectCases(
  cases,
  { split = "all", category, id, ids, limit } = {},
) {
  let selected = cases.filter(
    (c) =>
      (split === "all" || c.split === split) &&
      (!category || c.category === category) &&
      (!id || c.id === id) &&
      (!ids || ids.has(c.id)),
  );
  if (limit !== undefined) selected = selected.slice(0, limit);
  assert(selected.length > 0, "No selected cases.");
  return selected;
}
export const caseDigest = (c) => sha256(stable(c));
