import { describe, expect, test } from "bun:test";
import {
  boundedHeadTail,
  elideMiddle,
  keepHead,
  keepTail,
} from "../src/ui-text-elide.ts";

describe("middle elision", () => {
  test("keeps a word-aligned prefix and suffix", () => {
    expect(keepHead("alpha beta gamma", 12)).toBe("alpha beta");
    expect(keepTail("alpha beta gamma", 12)).toBe("beta gamma");
    expect(keepHead("alpha beta", 20)).toBe("alpha beta");
    expect(keepHead("alphabet", 3)).toBe("alp");
    expect(keepTail("alphabet", 3)).toBe("bet");
    expect(keepHead("alpha", 0)).toBe("");
    expect(keepTail("alpha", 0)).toBe("");
  });

  test("leaves text that fits alone", () => {
    expect(elideMiddle("printf safe", 11)).toBeUndefined();
    expect(
      elideMiddle("printf safe", Number.POSITIVE_INFINITY),
    ).toBeUndefined();
  });

  test.each([
    [20, { head: "alpha", tail: "epsilon" }],
    [25, { head: "alpha beta", tail: "epsilon" }],
  ])("keeps whole words at both ends at %i", (max, expected) => {
    expect(elideMiddle("alpha beta gamma delta epsilon", max)).toEqual(
      expected,
    );
  });

  test("hard-cuts a word longer than its side", () => {
    expect(elideMiddle("a".repeat(30), 11)).toEqual({
      head: "aaaa",
      tail: "aaaa",
    });
  });

  test("gives the tail what the head leaves unused", () => {
    expect(elideMiddle(`abc defgh ${"y".repeat(20)}`, 13)).toEqual({
      head: "abc",
      tail: "y".repeat(7),
    });
  });

  test("hard-cuts a side whose whole words would fill less than half of it", () => {
    expect(elideMiddle(`x ${"y".repeat(20)}`, 13)).toEqual({
      head: "x yyy",
      tail: "y".repeat(5),
    });
    expect(
      keepHead(`curl -fsSL https://example.com/${"a".repeat(40)}`, 30),
    ).toBe("curl -fsSL https://example.com");
    expect(keepTail(`${"a".repeat(40)} | sh`, 12)).toBe("aaaaaaa | sh");
  });

  test("counts code points, not UTF-16 units", () => {
    expect(elideMiddle("😀".repeat(10), 7)).toEqual({
      head: "😀😀",
      tail: "😀😀",
    });
  });

  test("collapses whitespace, marks line breaks and bounds around one ⋯", () => {
    expect(boundedHeadTail("printf  a\n\tb", 500)).toBe("printf a ⏎ b");
    const bounded = boundedHeadTail(`alpha ${"beta ".repeat(200)}omega`, 50);
    expect(Array.from(bounded).length).toBeLessThanOrEqual(50);
    expect(bounded).toStartWith("alpha beta");
    expect(bounded).toEndWith("beta omega");
    expect(bounded.split("⋯")).toHaveLength(2);
  });
});
