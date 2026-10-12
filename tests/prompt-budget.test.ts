import { describe, expect, test } from "bun:test";
import { renderPolicySummary } from "../src/context/evidence-sections.ts";
import {
  elideMiddle,
  keepMostRecentBlocks,
} from "../src/context/prompt-budget.ts";

describe("keepMostRecentBlocks", () => {
  test("an empty budget or block list yields nothing", () => {
    expect(keepMostRecentBlocks(["abc"], 0)).toBe("");
    expect(keepMostRecentBlocks(["abc"], -5)).toBe("");
    expect(keepMostRecentBlocks([], 100)).toBe("");
  });

  test("keeps the newest blocks in chronological order with a blank-line separator", () => {
    expect(keepMostRecentBlocks(["one", "two", "three"], 100)).toBe(
      "one\n\ntwo\n\nthree",
    );
    expect(keepMostRecentBlocks(["one", "two", "three"], 10)).toBe(
      "two\n\nthree",
    );
  });

  test("stops when only the separator would fit", () => {
    expect(keepMostRecentBlocks(["aaaa", "bbbb"], 4)).toBe("bbbb");
    expect(keepMostRecentBlocks(["aaaa", "bbbb"], 6)).toBe("bbbb");
  });

  test("elides an over-budget block when the elision fits, and stops when it does not", () => {
    const long = "x".repeat(300);
    expect(keepMostRecentBlocks([long], 200)).toBe(elideMiddle(long, 200));
    expect(elideMiddle(long, 200).length).toBeLessThanOrEqual(200);
    expect(keepMostRecentBlocks([long, "new"], 205)).toBe(
      `${elideMiddle(long, 200)}\n\nnew`,
    );
    expect(keepMostRecentBlocks(["aaaa", "bbbb"], 7)).toBe("bbbb");
    expect(keepMostRecentBlocks([long, "old", "new"], 60)).toBe("old\n\nnew");
    expect(keepMostRecentBlocks(["old", long], 60)).toBe("");
  });
});

describe("renderPolicySummary", () => {
  test("lists each matched rule by id, effect and reason only", () => {
    expect(
      renderPolicySummary(
        {
          effectivePolicyHash: "hash-1",
          finalRoute: "review",
          mode: "observe",
          matchedRules: [
            { id: "r1", source: "global", effect: "ask", reason: "first" },
            { id: "r2", source: "project", effect: "deny", reason: "second" },
          ],
        },
        2_000,
      ),
    ).toBe(
      `EFFECTIVE_POLICY_SUMMARY\n${JSON.stringify(
        {
          hash: "hash-1",
          route: "review",
          mode: "observe",
          matches: [
            { id: "r1", effect: "ask", reason: "first" },
            { id: "r2", effect: "deny", reason: "second" },
          ],
        },
        null,
        2,
      )}`,
    );
    expect(renderPolicySummary(undefined, 2_000)).toBe(
      "EFFECTIVE_POLICY_SUMMARY\n<no policy evaluation available />",
    );
  });
});
