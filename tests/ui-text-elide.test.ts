import { describe, expect, test } from "bun:test";
import {
  boundedHeadTail,
  ELISION,
  elideMiddle,
  keepHead,
  keepTail,
} from "../src/modules/status/services/ui-text-elide.ts";
import { columnUnits } from "../src/ui/text-columns.ts";
import { codePointUnits, unitsColumns } from "../src/utils/text-units.ts";

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

describe("elision by a unit splitter", () => {
  test("hard-cuts wide characters without crossing the column budget", () => {
    expect(keepHead("修复登录 错误", 5, columnUnits)).toBe("修复");
    expect(keepTail("echo 修复登录页面", 7, columnUnits)).toBe("录页面");
  });

  test("keeps a flag whole", () => {
    expect(keepHead("🇯🇵🇯🇵🇯🇵", 3, columnUnits)).toBe("🇯🇵");
  });

  test("fits the elided middle in terminal columns", () => {
    const parts = elideMiddle(
      'git commit -m "修复登录页面的错误" | sh',
      20,
      columnUnits,
    );
    expect(parts).toBeDefined();
    const head = parts?.head ?? "";
    const tail = parts?.tail ?? "";
    expect(
      unitsColumns(columnUnits(head + ELISION + tail)),
    ).toBeLessThanOrEqual(20);
    expect(tail.endsWith("| sh")).toBe(true);
  });

  test("defaults to code points", () => {
    expect(keepHead("alpha beta gamma", 12)).toBe(
      keepHead("alpha beta gamma", 12, codePointUnits),
    );
    expect(keepTail("alpha beta gamma", 12)).toBe(
      keepTail("alpha beta gamma", 12, codePointUnits),
    );
    expect(elideMiddle("😀".repeat(10), 7)).toEqual(
      elideMiddle("😀".repeat(10), 7, codePointUnits),
    );
  });
});

// The code-point implementation before the unit splitter, frozen as an oracle.
const oracle = {
  wordCut: (kept: number, max: number): boolean => kept > 0 && kept * 2 >= max,
  keepHead(text: string, max: number): string {
    const chars = Array.from(text);
    if (chars.length <= max) return text;
    let end = max;
    while (end > 0 && chars[end] !== " ") end -= 1;
    const head = oracle.wordCut(end, max)
      ? chars.slice(0, end)
      : chars.slice(0, Math.max(0, max));
    return head.join("").trimEnd();
  },
  keepTail(text: string, max: number): string {
    if (max <= 0) return "";
    const chars = Array.from(text);
    if (chars.length <= max) return text;
    let start = chars.length - max;
    while (start < chars.length && chars[start - 1] !== " ") start += 1;
    const tail = oracle.wordCut(chars.length - start, max)
      ? chars.slice(start)
      : chars.slice(chars.length - max);
    return tail.join("").trimStart();
  },
  elideMiddle(
    text: string,
    max: number,
  ): { head: string; tail: string } | undefined {
    if (Array.from(text).length <= max) return undefined;
    const budget = Math.max(0, max - Array.from(ELISION).length);
    const head = oracle.keepHead(text, Math.ceil(budget / 2));
    return {
      head,
      tail: oracle.keepTail(text, budget - Array.from(head).length),
    };
  },
};

function generatedTexts(): string[] {
  let seed = 45;
  const next = (bound: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  const letters = ["a", "b", "z", "😀", "é", "修"];
  const texts = ["", " ", "   ", "a", " a ", "ab  cd"];
  for (let index = 0; index < 150; index += 1) {
    let text = " ".repeat(next(3));
    const words = 1 + next(6);
    for (let word = 0; word < words; word += 1) {
      if (word > 0) text += " ".repeat(1 + next(3));
      const length = 1 + next(12);
      for (let char = 0; char < length; char += 1) {
        text += letters[next(letters.length)];
      }
    }
    texts.push(text + " ".repeat(next(3)));
  }
  return texts;
}

describe("default splitter equivalence", () => {
  test("matches the frozen code-point implementation", () => {
    let checked = 0;
    for (const text of generatedTexts()) {
      const length = Array.from(text).length;
      for (let max = -2; max <= length + 2; max += 1) {
        expect(keepHead(text, max)).toBe(oracle.keepHead(text, max));
        expect(keepTail(text, max)).toBe(oracle.keepTail(text, max));
        expect(elideMiddle(text, max)).toEqual(oracle.elideMiddle(text, max));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });
});
