import { describe, expect, test } from "bun:test";
import { codePointUnits, unitsColumns } from "../src/utils/text-units.ts";

describe("codePointUnits", () => {
  test("gives one single-column unit per code point", () => {
    const units = codePointUnits("a修👍");
    expect(units.map((unit) => unit.text)).toEqual(["a", "修", "👍"]);
    expect(units.map((unit) => unit.columns)).toEqual([1, 1, 1]);
  });

  test("returns no units for empty text", () => {
    expect(codePointUnits("")).toEqual([]);
  });
});

describe("unitsColumns", () => {
  test("sums the columns of every unit", () => {
    expect(
      unitsColumns([
        { text: "a", columns: 1 },
        { text: "修", columns: 2 },
        { text: "\u0301", columns: 0 },
      ]),
    ).toBe(3);
    expect(unitsColumns([])).toBe(0);
  });
});
