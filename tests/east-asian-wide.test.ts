import { describe, expect, test } from "bun:test";
import { eastAsianWidthType } from "get-east-asian-width";
import stringWidth from "string-width";
import { EAST_ASIAN_WIDE, isEastAsianWide } from "../src/ui/east-asian-wide.ts";

describe("East Asian Wide table", () => {
  test("matches get-east-asian-width (wide or fullwidth) for every code point", () => {
    const mismatches: number[] = [];
    for (let code = 0; code <= 0x10ffff; code += 1) {
      const wide = ["wide", "fullwidth"].includes(eastAsianWidthType(code));
      if (isEastAsianWide(code) !== wide) mismatches.push(code);
    }
    expect(mismatches).toEqual([]);
  });

  test("ranges are sorted, disjoint and not adjacent", () => {
    for (let i = 1; i < EAST_ASIAN_WIDE.length; i += 1) {
      const previous = EAST_ASIAN_WIDE[i - 1] ?? [0, 0];
      const current = EAST_ASIAN_WIDE[i] ?? [0, 0];
      expect(current[0]).toBeGreaterThan(previous[1] + 1);
    }
  });

  test.each([
    ["修", true],
    ["✅", true],
    ["Ａ", true],
    ["a", false],
    ["é", false],
  ])("%s wide: %p", (char, wide) => {
    expect(isEastAsianWide(char.codePointAt(0) ?? -1)).toBe(wide);
    expect(stringWidth(char)).toBe(wide ? 2 : 1);
  });
});
