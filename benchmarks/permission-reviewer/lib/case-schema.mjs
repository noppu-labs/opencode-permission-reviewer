import { validateInput } from "./case-input-schema.mjs";
import { assert } from "./util.mjs";
export const OUTCOMES = ["allow", "deny", "escalate"];
const SPLITS = ["dev", "validation", "holdout"];
const DIFFICULTIES = ["easy", "medium", "hard"];
function validatePlacement(c, { ids, families }) {
  assert(
    c && typeof c.id === "string" && c.id.length > 3 && !ids.has(c.id),
    `Missing or duplicate case id: ${c?.id}`,
  );
  ids.add(c.id);
  assert(
    typeof c.family === "string" && c.family.length > 0,
    `${c.id}: family missing`,
  );
  assert(SPLITS.includes(c.split), `${c.id}: invalid partition`);
  if (families.has(c.family))
    assert(
      families.get(c.family) === c.split,
      `${c.id}: family crosses partitions`,
    );
  else families.set(c.family, c.split);
}
function validateGold(c) {
  assert(DIFFICULTIES.includes(c.difficulty), `${c.id}: difficulty`);
  assert(
    typeof c.category === "string" && c.category.length,
    `${c.id}: category`,
  );
  assert(OUTCOMES.includes(c.gold?.outcome), `${c.id}: gold outcome`);
  assert(
    Array.isArray(c.gold.acceptable) &&
      c.gold.acceptable.includes(c.gold.outcome) &&
      c.gold.acceptable.every((x) => OUTCOMES.includes(x)),
    `${c.id}: acceptable outcomes`,
  );
  assert(
    Number.isInteger(c.gold.severity) &&
      c.gold.severity >= 1 &&
      c.gold.severity <= 5,
    `${c.id}: severity`,
  );
  assert(typeof c.gold.critical === "boolean", `${c.id}: critical`);
  assert(
    typeof c.gold.reason === "string" && c.gold.reason.length >= 12,
    `${c.id}: gold explanation`,
  );
  assert(
    Array.isArray(c.gold.rubric?.essential) && c.gold.rubric.essential.length,
    `${c.id}: rationale rubric missing`,
  );
}
export function validatePairs(cases) {
  for (const c of cases)
    for (const source of [c.metamorphic?.sourceId, c.attack?.controlId].filter(
      Boolean,
    )) {
      const base = cases.find((x) => x.id === source);
      assert(base, `${c.id}: missing paired source ${source}`);
      assert(
        base.family === c.family && base.split === c.split,
        `${c.id}: pair leakage across family/partition`,
      );
      assert(
        base.gold.outcome === c.gold.outcome,
        `${c.id}: preservation pair has inconsistent gold`,
      );
    }
}
export function validateCase(c, seen) {
  validatePlacement(c, seen);
  validateGold(c);
  validateInput(c, seen.inputs);
}
