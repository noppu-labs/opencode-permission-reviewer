import { describe, expect, test } from "bun:test";
import {
  actionSegments,
  createServerUiStatus,
} from "../src/ui-action-segments.ts";
import {
  type ActionSegment,
  createUiStatus,
  decodeUiStatus,
  encodeUiStatus,
} from "../src/ui-protocol.ts";
import { MAX_STATUS_BYTES } from "../src/ui-status-extras.ts";
import {
  FIND_ACTION,
  FIND_COMMAND,
  FIND_SEGMENTS,
  GIT_LOG_ACTION,
  GIT_LOG_COMMAND,
  GIT_LOG_SEGMENTS,
  HEREDOC_ACTION,
  HEREDOC_COMMAND,
  HEREDOC_SEGMENTS,
  LONG_COMMAND,
} from "./action-fixtures.ts";
import { request } from "./helpers.ts";

/** Fixture segments without the `$ ` prompt `createServerUiStatus` adds. */
function unprompted(segments: readonly ActionSegment[]): ActionSegment[] {
  return segments.map((segment, index) =>
    index === 0
      ? { ...segment, text: segment.text.replace(/^\$ /, "") }
      : segment,
  );
}

const options = {
  model: "fixture/reviewer",
  variant: "max",
  timeoutMs: 10_000,
};
const seg179 = (index: number): string =>
  `printf '%s' ${"x".repeat(165)}${String(index).padStart(2, "0")}`;

describe("action segments", () => {
  test.each([
    ["a pipeline chain", FIND_COMMAND, unprompted(FIND_SEGMENTS)],
    ["||, ; and a trailing &", GIT_LOG_COMMAND, unprompted(GIT_LOG_SEGMENTS)],
    [
      "a heredoc before a chained command",
      HEREDOC_COMMAND,
      unprompted(HEREDOC_SEGMENTS),
    ],
  ])("splits %s", (_name, command, expected) => {
    expect(actionSegments(command)).toEqual(expected);
  });

  test.each<[string, string, ActionSegment[]]>([
    [
      "a heredoc and a command on the next line",
      "cat <<'EOF' > scripts/check.sh\n#!/bin/sh\nset -e\nbun run check\nEOF\nbash scripts/check.sh",
      [
        {
          text: "cat <<'EOF' > scripts/check.sh",
          separator: ";",
          heredocLines: 3,
        },
        { text: "bash scripts/check.sh" },
      ],
    ],
    [
      "two heredocs in one command",
      "cat <<A <<-B | wc\na1\na2\nA\n\tb1\n\tB\necho next",
      [
        { text: "cat <<A <<-B", separator: "|", heredocLines: 3 },
        { text: "wc", separator: ";" },
        { text: "echo next" },
      ],
    ],
    [
      "a group",
      "(cd /tmp && ls) | wc -l",
      [{ text: "(cd /tmp && ls)", separator: "|" }, { text: "wc -l" }],
    ],
    [
      "a command substitution",
      "echo $(date +%s | cut -c1-5) && echo ok",
      [
        { text: "echo $(date +%s | cut -c1-5)", separator: "&&" },
        { text: "echo ok" },
      ],
    ],
    [
      "nested groups",
      "a && (b || (c; d)) | e",
      [
        { text: "a", separator: "&&" },
        { text: "(b || (c; d))", separator: "|" },
        { text: "e" },
      ],
    ],
    [
      "process substitutions",
      "diff <(ls a) <(ls b) | head",
      [{ text: "diff <(ls a) <(ls b)", separator: "|" }, { text: "head" }],
    ],
    [
      "an array assignment",
      "arr=(a b) && echo ok",
      [{ text: "arr=(a b)", separator: "&&" }, { text: "echo ok" }],
    ],
    [
      "lines",
      "npm ci\nnpm test\n\nnpm run build",
      [
        { text: "npm ci", separator: ";" },
        { text: "npm test", separator: ";" },
        { text: "npm run build" },
      ],
    ],
    [
      "extra spaces and a comment",
      "  ls    -la   |   wc  # count",
      [{ text: "ls -la", separator: "|" }, { text: "wc" }],
    ],
    [
      "a backtick substitution",
      "echo `whoami | tr a-z A-Z` && ls",
      [
        { text: "echo `whoami", separator: "|" },
        { text: "tr a-z A-Z`", separator: "&&" },
        { text: "ls" },
      ],
    ],
    [
      "a substitution followed by a path",
      "cd $(pwd)/src && ls",
      [{ text: "cd $(pwd)/src", separator: "&&" }, { text: "ls" }],
    ],
    [
      "a substitution inside a word",
      "x$(date)y | wc",
      [{ text: "x$(date)y", separator: "|" }, { text: "wc" }],
    ],
    [
      "a substitution that starts a path",
      "rm -rf $(mktemp -d)/cache",
      [{ text: "rm -rf $(mktemp -d)/cache" }],
    ],
    [
      "an assignment from a substitution and a suffix",
      "a=$(b)c; echo",
      [{ text: "a=$(b)c", separator: ";" }, { text: "echo" }],
    ],
    [
      "an escape inside double quotes",
      'printf "%s\\n" x && ls',
      [{ text: 'printf "%s\\n" x', separator: "&&" }, { text: "ls" }],
    ],
    [
      "an escaped pipe inside double quotes",
      'grep "a\\|b" f | wc',
      [{ text: 'grep "a\\|b" f', separator: "|" }, { text: "wc" }],
    ],
    [
      "a line continuation between words",
      "echo a \\\n  b | wc",
      [{ text: "echo a b", separator: "|" }, { text: "wc" }],
    ],
    ["a trailing ;", "ls;", [{ text: "ls" }]],
    [
      "a line break after an operator in a group",
      "(a |\n b) && c",
      [{ text: "(a | b)", separator: "&&" }, { text: "c" }],
    ],
    [
      "a heredoc delimiter as typed",
      'cat << "EOF" > out.txt\nhello\nEOF',
      [{ text: 'cat << "EOF" > out.txt', heredocLines: 1 }],
    ],
    [
      "a heredoc operator against its command",
      "cat<<EOF | wc -l\na\nb\nEOF",
      [
        { text: "cat<<EOF", separator: "|", heredocLines: 2 },
        { text: "wc -l" },
      ],
    ],
    [
      "a heredoc inside a command substitution",
      "x=$(cat <<'EOF'\nhello\nEOF\n) && echo \"$x\"",
      [
        { text: "x=$(cat <<'EOF'; )", separator: "&&", heredocLines: 1 },
        { text: 'echo "$x"' },
      ],
    ],
  ])("splits %s", (_name, command, expected) => {
    expect(actionSegments(command)).toEqual(expected);
  });

  test.each([
    ["an unclosed single quote", "echo 'abc | rm -rf x"],
    ["an unclosed double quote", 'echo "abc | rm && x'],
    ["an unclosed group", "(a && b"],
  ])("unclosed quotes and groups stay one segment: %s", (_name, command) => {
    expect(actionSegments(command)).toEqual([{ text: command }]);
  });

  test("keeps common redirects in their segment", () => {
    expect(actionSegments("ls 2>&1 | wc -l")).toEqual([
      { text: "ls 2>&1", separator: "|" },
      { text: "wc -l" },
    ]);
    expect(
      actionSegments("make >&2 && echo 'a && b' ; ls &>/dev/null"),
    ).toEqual([
      { text: "make >&2", separator: "&&" },
      { text: "echo 'a && b'", separator: ";" },
      { text: "ls &>/dev/null" },
    ]);
  });

  test("counts a long heredoc body in full", () => {
    const body = Array.from(
      { length: 400 },
      (_, index) => `line ${index}`,
    ).join("\n");
    expect(
      actionSegments(`cat <<EOF > big.txt\n${body}\nEOF\necho ok`),
    ).toEqual([
      { text: "cat <<EOF > big.txt", separator: ";", heredocLines: 400 },
      { text: "echo ok" },
    ]);
  });

  test("keeps a long segment's head and tail", () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`);
    const [first] = actionSegments(`echo ${words.join(" ")} | wc`) ?? [];
    expect(Array.from(first?.text ?? "").length).toBeLessThanOrEqual(200);
    expect(first?.text).toStartWith("echo word0 ");
    expect(first?.text).toEndWith(" word59");
    expect(first?.text.split("⋯")).toHaveLength(2);
    expect(first?.separator).toBe("|");
  });

  test("keeps up to 24 segments and 2,000 bytes", () => {
    const pipeline = (count: number): string =>
      Array.from({ length: count }, (_, index) => `echo ${index}`).join(" | ");
    expect(actionSegments(pipeline(24))).toHaveLength(24);
    const eight = actionSegments(
      Array.from({ length: 8 }, (_, index) => seg179(index)).join(" && "),
    );
    expect(eight).toHaveLength(8);
    expect(Buffer.byteLength(JSON.stringify(eight))).toBeLessThanOrEqual(2_000);
  });

  test.each([
    ["an empty command", ""],
    ["a blank command", "   "],
    ["a heredoc delimiter whose quote never closes", "cat <<'EOF\nx"],
    [
      "a command whose heredoc line count cannot be verified",
      "echo '<HEREDOC:sha256:0123456789ab>'",
    ],
    [
      "25 segments",
      Array.from({ length: 25 }, (_, index) => `echo ${index}`).join(" | "),
    ],
    [
      "segments over the byte budget",
      Array.from({ length: 12 }, (_, index) => seg179(index)).join(" && "),
    ],
    ["more tokens than the lexer budget", "a ".repeat(5_000)],
    ["a heredoc whose body never ends", "cat <<EOF\nline"],
    ["a case statement", "case $x in a) foo;; esac"],
    ["a command over 65,536 characters", `echo ${"a".repeat(65_532)}`],
  ])("returns no segments for %s", (_name, command) => {
    expect(actionSegments(command)).toBeUndefined();
  });
});

/** `count` three-byte characters. */
const wide = (count: number): string => "世".repeat(count);
const WIDE_COMMAND = [wide(150), "echo ok", "tail -1"].join(" | ");
const WIDE_OPTIONS = {
  model: wide(200),
  variant: wide(100),
  timeoutMs: 1,
  reason: wide(2_000),
  actorName: wide(100),
  decidedBy: wide(200),
  emittedAt: 1,
  handoff: {
    from: wide(200),
    to: wide(200),
    trigger: "jev-failure" as const,
    failureKind: wide(40),
  },
};

describe("server statuses", () => {
  test("carry a bash command's segments with the $ prompt", () => {
    const status = createServerUiStatus(
      request({ metadata: { command: FIND_COMMAND } }),
      "reviewing",
      { ...options, emittedAt: 1 },
    );
    expect(status.action).toBe(FIND_ACTION);
    expect(status.actionSegments).toEqual(FIND_SEGMENTS);
    const { actionSegments: _segments, ...rest } = status;
    expect(rest).toEqual(
      createUiStatus(
        request({ metadata: { command: FIND_COMMAND } }),
        "reviewing",
        {
          ...options,
          emittedAt: 1,
        },
      ),
    );
  });

  test.each([
    [
      "a ||, ; and & command",
      GIT_LOG_COMMAND,
      GIT_LOG_ACTION,
      GIT_LOG_SEGMENTS,
    ],
    ["a heredoc command", HEREDOC_COMMAND, HEREDOC_ACTION, HEREDOC_SEGMENTS],
  ])(
    "carry the segments and action of %s",
    (_name, command, action, segments) => {
      const status = createServerUiStatus(
        request({ metadata: { command } }),
        "reviewing",
        options,
      );
      expect(status.action).toBe(action);
      expect(status.actionSegments).toEqual(segments);
    },
  );

  test("carry only the action for a command with too many segments", () => {
    const status = createServerUiStatus(
      request({ metadata: { command: LONG_COMMAND } }),
      "reviewing",
      options,
    );
    expect(status.action).toContain("curl -s https://example.com/install.sh");
    expect("actionSegments" in status).toBe(false);
  });

  test.each([
    [
      "an edit",
      request({
        permission: "edit",
        patterns: ["notes.txt"],
        metadata: { filepath: "notes.txt" },
      }),
    ],
    ["bash without a command", request({ metadata: {} })],
    ["bash with an empty command", request({ metadata: { command: "  " } })],
  ])("carry no segments for %s", (_name, permission) => {
    const status = createServerUiStatus(permission, "reviewing", options);
    expect("actionSegments" in status).toBe(false);
  });

  test("leave segments off a status they would push past the cap", () => {
    const wideRequest = request({
      id: wide(300),
      sessionID: wide(300),
      metadata: { command: WIDE_COMMAND },
    });
    const plain = createUiStatus(wideRequest, "reviewing", WIDE_OPTIONS);
    const withSegments = createUiStatus(wideRequest, "reviewing", {
      ...WIDE_OPTIONS,
      actionSegments: actionSegments(WIDE_COMMAND) ?? [],
    });
    expect(Buffer.byteLength(JSON.stringify(plain))).toBeLessThanOrEqual(
      MAX_STATUS_BYTES,
    );
    expect(Buffer.byteLength(JSON.stringify(withSegments))).toBeGreaterThan(
      MAX_STATUS_BYTES,
    );
    const status = createServerUiStatus(wideRequest, "reviewing", WIDE_OPTIONS);
    expect(status).toEqual(plain);
    expect("actionSegments" in status).toBe(false);
    expect(decodeUiStatus(encodeUiStatus(status))).toEqual(status);
  });

  test("leave segments off rather than crowd out a config entry", () => {
    const entries = [wide(200), wide(199), wide(198)];
    const crowded = request({ metadata: { command: WIDE_COMMAND } });
    const withOptions = { ...WIDE_OPTIONS, configWarnings: entries };
    const withSegments = createUiStatus(crowded, "reviewing", {
      ...withOptions,
      actionSegments: actionSegments(WIDE_COMMAND) ?? [],
    });
    expect(withSegments.configWarnings).toHaveLength(2);
    const status = createServerUiStatus(crowded, "reviewing", withOptions);
    expect(status.configWarnings).toEqual(entries);
    expect("actionSegments" in status).toBe(false);
    expect(decodeUiStatus(encodeUiStatus(status))).toEqual(status);
  });
});
