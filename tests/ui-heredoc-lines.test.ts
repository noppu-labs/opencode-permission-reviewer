import { describe, expect, test } from "bun:test";
import { extractHeredocs } from "../src/capability/heredoc-extractor.ts";
import { heredocBodies } from "../src/ui-heredoc-lines.ts";

const counts = (command: string): number[] | undefined =>
  heredocBodies(command, extractHeredocs(command))?.map((body) => body.lines);

describe("heredoc bodies", () => {
  test.each<[string, string, number[]]>([
    ["no heredoc", "ls -la | wc -l", []],
    [
      "one body before a chained command",
      "cat <<'EOF' > scripts/check.sh && bash scripts/check.sh\n#!/bin/sh\nset -e\nbun run check\nEOF",
      [3],
    ],
    [
      "one body and a command on the next line",
      "cat <<'EOF' > scripts/check.sh\n#!/bin/sh\nset -e\nbun run check\nEOF\nbash scripts/check.sh",
      [3],
    ],
    [
      "two bodies on one line and a third later",
      "cat <<A <<-B | wc\na1\na2\nA\n\tb1\n\tB\necho next\ncat <<C\nc1\nC",
      [2, 1, 1],
    ],
    ["an empty body", "cat <<EOF\nEOF\nls", [0]],
  ])("%s", (_name, command, expected) => {
    expect(counts(command)).toEqual(expected);
  });

  test("counts every line of a body longer than the stored bound", () => {
    const body = Array.from(
      { length: 400 },
      (_, index) => `line ${index} ${"x".repeat(20)}`,
    ).join("\n");
    const command = `cat <<EOF > big.txt\n${body}\nEOF\necho ok`;
    expect(extractHeredocs(command).heredocs[0]?.truncated).toBe(true);
    expect(counts(command)).toEqual([400]);
  });

  test.each([
    ["a delimiter whose quote never closes", "cat <<'EOF\nx\n\ny"],
    [
      "a body whose position cannot be verified (1)",
      "echo '<HEREDOC:sha256:0123456789ab>'",
    ],
    [
      "a body whose position cannot be verified (2)",
      "cat <<EOF \\\n  > out.txt\nbody\nEOF",
    ],
    [
      "a body whose position cannot be verified (3)",
      'cat <<EOF "a\nb"\nbody\nEOF',
    ],
    ["a body that never ends", "cat <<EOF\nunterminated\nbody"],
  ])("gives no counts for %s", (_name, command) => {
    expect(counts(command)).toBeUndefined();
  });
});

test("gives each body's place in the command", () => {
  const command = "cat <<A <<B\na1\nA\nb1\nb2\nB\nls";
  expect(heredocBodies(command, extractHeredocs(command))).toEqual([
    { lines: 1, start: 12, end: 17 },
    { lines: 2, start: 17, end: 25 },
  ]);
});
