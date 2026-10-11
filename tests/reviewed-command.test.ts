// tests/reviewed-command.test.ts
import { describe, expect, test } from "bun:test";
import { analyzeBashCommand } from "../src/context/command-evidence.ts";
import { reviewedCommand } from "../src/reviewed-command.ts";
import { request } from "./helpers.ts";

const CTX = { directory: "/work/repo", worktree: "/work/repo" };

function withMetadata(
  command: unknown,
  patterns: unknown[] = [],
): ReturnType<typeof request> {
  return request({
    metadata: { command },
    patterns: patterns as string[],
  });
}

describe("the reviewed command text", () => {
  test("a command with content is used as is", () => {
    expect(reviewedCommand(withMetadata("ls -la", ["echo other"]))).toBe(
      "ls -la",
    );
    expect(reviewedCommand(withMetadata("  ls  "))).toBe("  ls  ");
  });

  test.each(["", "   ", "\n\t "])(
    "a blank command falls back to the patterns joined by newlines, case %#",
    (command) => {
      expect(reviewedCommand(withMetadata(command, ["echo a", "echo b"]))).toBe(
        "echo a\necho b",
      );
    },
  );

  test.each([42, null, undefined, { text: "ls" }])(
    "a non-string command falls back to the patterns, case %#",
    (command) => {
      expect(reviewedCommand(withMetadata(command, ["echo a", "echo b"]))).toBe(
        "echo a\necho b",
      );
    },
  );

  test("patterns that are not strings are skipped", () => {
    expect(
      reviewedCommand(withMetadata(undefined, ["echo a", 7, null, "echo b"])),
    ).toBe("echo a\necho b");
  });

  test("no patterns give an empty string", () => {
    expect(reviewedCommand(withMetadata("", []))).toBe("");
    expect(reviewedCommand(withMetadata(undefined, []))).toBe("");
  });
});

describe("the analyzer reads the reviewed command text", () => {
  test.each(["", "   "])(
    "a blank command analyses the patterns, case %#",
    (command) => {
      const result = analyzeBashCommand(withMetadata(command, ["ls -la"]), CTX);
      expect(result.parsed?.sanitizedCommand).toBe("ls -la");
      expect(result.capability).toBeDefined();
    },
  );

  test("a blank command with blank patterns yields no analysis", () => {
    expect(analyzeBashCommand(withMetadata("  ", ["   "]), CTX)).toEqual({});
  });

  test("a command with content is analysed instead of the patterns", () => {
    const result = analyzeBashCommand(
      withMetadata("ls -la", ["echo other"]),
      CTX,
    );
    expect(result.parsed?.sanitizedCommand).toBe("ls -la");
  });
});
