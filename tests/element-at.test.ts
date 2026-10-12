import { describe, expect, test } from "bun:test";
import { elementAt } from "../src/element-at.ts";

describe("elementAt", () => {
  test("returns the element at an in-range index, including falsy ones", () => {
    expect(elementAt(["a", "", "c"], 1, "tokens")).toBe("");
    expect(elementAt([0], 0, "counts")).toBe(0);
  });

  test("throws naming the array, the index and the length when out of range", () => {
    expect(() => elementAt(["a"], 3, "tokens")).toThrow(
      new Error("tokens[3] is out of bounds (length 1)"),
    );
    expect(() => elementAt(["a"], -1, "tokens")).toThrow(
      new Error("tokens[-1] is out of bounds (length 1)"),
    );
  });
});
