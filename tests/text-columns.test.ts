import { describe, expect, test } from "bun:test";
import { columnUnits } from "../src/ui/text-columns.ts";
import { unitsColumns } from "../src/utils/text-units.ts";

const CASES: ReadonlyArray<readonly [string, string, number, number]> = [
  ["CJK ideographs", "修复", 2, 4],
  ["emoji presentation", "✅", 1, 2],
  ["regional indicator flag", "🇯🇵", 1, 2],
  ["emoji with skin tone", "👍🏽", 1, 2],
  ["combining accent", "e\u0301", 1, 1],
  ["lone combining mark", "\u0301", 1, 0],
  ["ascii", "abc", 3, 3],
  ["text-presentation pictograph", "☺", 1, 1],
  ["pictograph with emoji selector", "☺\ufe0f", 1, 2],
  ["fullwidth letter", "Ａ", 1, 2],
  ["midline ellipsis", "⋯", 1, 1],
];

describe("columnUnits", () => {
  for (const [name, text, count, columns] of CASES) {
    test(`${name}: ${count} unit(s), ${columns} column(s)`, () => {
      const units = columnUnits(text);
      expect(units).toHaveLength(count);
      expect(unitsColumns(units)).toBe(columns);
      expect(units.map((unit) => unit.text).join("")).toBe(text);
    });
  }

  test("returns no units for empty text", () => {
    expect(columnUnits("")).toEqual([]);
  });
});
