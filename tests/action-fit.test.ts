import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ActionFitPart,
  fitAction,
  singleLine,
} from "../src/ui/action-fit.ts";
import { sliceParts, textColumns } from "../src/ui/fit-parts.ts";
import { createServerUiStatus } from "../src/ui-action-segments.ts";
import type { ReviewUiStatus } from "../src/ui-protocol.ts";
import {
  FIND_ACTION,
  FIND_SEGMENTS,
  GIT_LOG_ACTION,
  GIT_LOG_SEGMENTS,
  HEREDOC_ACTION,
  HEREDOC_SEGMENTS,
} from "./action-fixtures.ts";
import { request } from "./helpers.ts";
import { TUI_SHIP_FILES } from "./package-tui-files.ts";

type Fitted = Pick<ReviewUiStatus, "action" | "actionSegments">;
const find: Fitted = { action: FIND_ACTION, actionSegments: FIND_SEGMENTS };
const heredoc: Fitted = {
  action: HEREDOC_ACTION,
  actionSegments: HEREDOC_SEGMENTS,
};
const plain = (text: string): ActionFitPart => ({ text, muted: false });
const muted = (text: string): ActionFitPart => ({ text, muted: true });
const shown = (parts: readonly ActionFitPart[]): string =>
  parts.map((part) => part.text).join("");
const FIND_HEAD = "$ find . -name '*.ts' -not -path './node_modules/*' |";
const STATUSES: readonly Fitted[] = [find, heredoc, { action: FIND_ACTION }];
const CURL_URL =
  "https://raw.githubusercontent.com/example-org/example-repo/main/scripts/install-the-tool.sh";
const curl: Fitted = {
  action: `$ curl -fsSL ${CURL_URL} | sh`,
  actionSegments: [
    { text: `$ curl -fsSL ${CURL_URL}`, separator: "|" },
    { text: "sh" },
  ],
};

/** The words of the unmuted parts, less those next to a muted part, where
 *  a cut may fall inside a word. */
function innerWords(parts: readonly ActionFitPart[]): string[] {
  return parts.flatMap((part, index) => {
    if (part.muted) return [];
    const inner = part.text.split(" ");
    if (parts[index - 1]?.muted) inner.shift();
    if (parts[index + 1]?.muted) inner.pop();
    return inner;
  });
}

describe("fitting an action to a width", () => {
  test("leaves a command that fits unchanged", () => {
    expect(fitAction(find, 160)).toEqual([plain(FIND_ACTION)]);
    expect(fitAction(find, Number.POSITIVE_INFINITY)).toEqual([
      plain(FIND_ACTION),
    ]);
    expect(fitAction({ action: "printf safe" }, 91)).toEqual([
      plain("printf safe"),
    ]);
  });

  test("shows a fitting command the server segmented exactly as its action", () => {
    const status = createServerUiStatus(
      request({
        metadata: { command: "cd $(git rev-parse --show-toplevel)/src && ls" },
      }),
      "reviewing",
      { model: "fixture/reviewer", variant: "max", timeoutMs: 10_000 },
    );
    expect(status.action).toBe(
      "$ cd $(git rev-parse --show-toplevel)/src && ls",
    );
    expect(status.actionSegments).toBeDefined();
    expect(fitAction(status, 160)).toEqual([plain(status.action)]);
  });

  test.each<[number, number, string]>([
    [
      155,
      1,
      "xargs wc -l | sort -n | tail -5 && curl -s https://example.com/install.sh | sh",
    ],
    [
      131,
      2,
      "sort -n | tail -5 && curl -s https://example.com/install.sh | sh",
    ],
    [120, 3, "tail -5 && curl -s https://example.com/install.sh | sh"],
    [91, 5, "sh"],
    [67, 5, "sh"],
  ])(
    "at %i columns keeps the first segment and the tail, hiding %i",
    (columns, hidden, tail) => {
      expect(fitAction(find, columns)).toEqual([
        plain(FIND_HEAD),
        muted(` ⋯ ${hidden} more ⋯ `),
        plain(tail),
      ]);
    },
  );

  test("attaches ; to its segment and keeps a trailing &", () => {
    const status: Fitted = {
      action: GIT_LOG_ACTION,
      actionSegments: GIT_LOG_SEGMENTS,
    };
    expect(fitAction(status, 200)).toEqual([plain(GIT_LOG_ACTION)]);
    expect(fitAction(status, 80)).toEqual([
      plain("$ git log --oneline --since='2 weeks ago' -- src |"),
      muted(" ⋯ 3 more ⋯ "),
      plain("true; echo done &"),
    ]);
  });

  test("shows a heredoc body as a muted line count", () => {
    const expected = [
      plain("$ cat <<'EOF' > scripts/check.sh"),
      muted(" ⋯ 3-line heredoc ⋯"),
      plain(" && bash scripts/check.sh"),
    ];
    expect(fitAction(heredoc, 91)).toEqual(expected);
    expect(fitAction(heredoc, Number.POSITIVE_INFINITY)).toEqual(expected);
  });

  test("falls back to the start of the first segment and the end of the last", () => {
    expect(fitAction(find, 66)).toEqual([
      plain("$ find . -name '*.ts' -not -path './node_modules/*'"),
      muted(" ⋯ 5 more ⋯ "),
      plain("sh"),
    ]);
    expect(fitAction(find, 51)).toEqual([
      plain("$ find . -name '*.ts' -not -path"),
      muted(" ⋯ 5 more ⋯ "),
      plain("sh"),
    ]);
    // A kept heredoc label is followed by the cut's own ⋯.
    expect(fitAction(heredoc, 75)).toEqual([
      plain("$ cat <<'EOF' > scripts/check.sh"),
      muted(" ⋯ 3-line heredoc ⋯ ⋯ "),
      plain("bash scripts/check.sh"),
    ]);
    expect(fitAction(heredoc, 60)).toEqual([
      plain("$ cat <<'EOF' > scripts/check.sh"),
      muted(" ⋯ "),
      plain("bash scripts/check.sh"),
    ]);
    expect(fitAction(heredoc, 40)).toEqual([
      plain("$ cat <<'EOF' >"),
      muted(" ⋯ "),
      plain("bash scripts/check.sh"),
    ]);
  });

  test("elides a lone segment too wide for the row, keeping its heredoc marker whole", () => {
    const lone: Fitted = {
      action: "$ cat <<EOF > out.txt",
      actionSegments: [{ text: "$ cat <<EOF > out.txt", heredocLines: 12 }],
    };
    expect(fitAction(lone, 41)).toEqual([
      plain("$ cat <<EOF > out.txt"),
      muted(" ⋯ 12-line heredoc ⋯"),
    ]);
    expect(fitAction(lone, 40)).toEqual([
      plain("$ cat <<EOF >"),
      muted(" ⋯ ⋯ 12-line heredoc ⋯"),
    ]);
  });

  test("counts the commands it hides beside a heredoc label", () => {
    const status: Fitted = {
      action: "$ cat <<'EOF' > setup.sh && chmod +x setup.sh && ./setup.sh",
      actionSegments: [
        { text: "$ cat <<'EOF' > setup.sh", separator: "&&", heredocLines: 2 },
        { text: "chmod +x setup.sh", separator: "&&" },
        { text: "./setup.sh --prefix /opt/tool", separator: "|" },
        { text: "tee setup.log", separator: "&&" },
        { text: "echo the-setup-script-finished-without-errors" },
      ],
    };
    expect(fitAction(status, 90)).toEqual([
      plain("$ cat <<'EOF' > setup.sh"),
      muted(" ⋯ 3 more ⋯ "),
      plain("echo the-setup-script-finished-without-errors"),
    ]);
    expect(fitAction(status, 100)).toEqual([
      plain("$ cat <<'EOF' > setup.sh"),
      muted(" ⋯ 2-line heredoc ⋯ ⋯ 3 more ⋯ "),
      plain("echo the-setup-script-finished-without-errors"),
    ]);
  });

  test("shows a heredoc label only with its command", () => {
    const status: Fitted = {
      action: "$ echo preparing-the-build-environment-now; bash <<'EOF'",
      actionSegments: [
        { text: "$ echo preparing-the-build-environment-now", separator: ";" },
        { text: "bash <<'EOF'", heredocLines: 3 },
      ],
    };
    expect(fitAction(status, 40)).toEqual([
      plain("$ echo preparing-the-build-environmen"),
      muted(" ⋯"),
    ]);
    expect(fitAction(status, 66)).toEqual([
      plain("$ echo preparing-the-build-envir"),
      muted(" ⋯ "),
      plain("bash <<'EOF'"),
      muted(" ⋯ 3-line heredoc ⋯"),
    ]);
  });

  test("never shows a heredoc body at any width", () => {
    for (let columns = 0; columns <= 200; columns += 1) {
      const text = shown(fitAction(heredoc, columns));
      expect(text).not.toContain("#!/bin/sh");
      expect(text).not.toContain("bun run check");
    }
  });

  test("uses the start and end of action without segments", () => {
    const expected = [
      plain("$ find . -name '*.ts' -not -path"),
      muted(" ⋯ "),
      plain("| tail -5 && curl -s https://example.com/install.sh | sh"),
    ];
    expect(fitAction({ action: FIND_ACTION }, 91)).toEqual(expected);
    expect(fitAction({ action: FIND_ACTION, actionSegments: [] }, 91)).toEqual(
      expected,
    );
  });

  test.each<[number, ActionFitPart[]]>([
    [
      40,
      [plain("$ find . -name '*.ts' -not"), muted(" ⋯ 5 more ⋯ "), plain("sh")],
    ],
    [20, [plain("$ find"), muted(" ⋯ 5 more ⋯ "), plain("sh")]],
    [11, [plain("$ find"), muted(" ⋯ "), plain("sh")]],
    [8, [plain("$ f"), muted(" ⋯ "), plain("sh")]],
    [5, [plain("$"), muted(" ⋯ "), plain("h")]],
    [4, [muted("⋯")]],
    [1, [muted("⋯")]],
    [0, []],
    [-3, []],
    [Number.NaN, []],
  ])(
    "at %d columns, narrower than the first segment, still fits",
    (columns, parts) => {
      expect(fitAction(find, columns)).toEqual(parts);
    },
  );

  test("is never wider than the columns it is given", () => {
    const statuses: Fitted[] = [
      find,
      heredoc,
      { action: FIND_ACTION },
      { action: `$ ${"a".repeat(300)}` },
    ];
    for (const status of statuses)
      for (let columns = 0; columns <= 250; columns += 1)
        expect(
          textColumns(shown(fitAction(status, columns))),
        ).toBeLessThanOrEqual(columns);
  });

  test("cuts inside a word only next to a ⋯", () => {
    for (const status of STATUSES) {
      const words = new Set([
        ...status.action.split(" "),
        ...(status.actionSegments ?? []).flatMap((segment) =>
          segment.text.split(" "),
        ),
      ]);
      for (let columns = 5; columns <= 200; columns += 1) {
        const cut = innerWords(fitAction(status, columns)).filter(
          (word) => word !== "" && !words.has(word),
        );
        expect(cut).toEqual([]);
      }
    }
  });

  test.each<[number, string]>([
    [
      80,
      "$ curl -fsSL https://raw.githubusercontent.com/example-org/example-repo/mai",
    ],
    [
      100,
      "$ curl -fsSL https://raw.githubusercontent.com/example-org/example-repo/main/scripts/install-th",
    ],
  ])(
    "at %i columns hard-cuts a long token that whole words would leave mostly unshown",
    (columns, head) => {
      expect(fitAction(curl, columns)).toEqual([
        plain(head),
        muted(" ⋯ "),
        plain("sh"),
      ]);
    },
  );

  test("never widens or splits a separator for random segments", () => {
    let state = 7;
    const next = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(next() * list.length)] as T;
    const words = ["$", "ab", "c", "cleanup", "x/y", "zz", "a-very-long-word"];
    const separators = ["|", "||", "&&", ";", "&"];
    for (let run = 0; run < 2_000; run += 1) {
      const segments = Array.from(
        { length: 1 + Math.floor(next() * 4) },
        () => ({
          text: Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
            pick(words),
          ).join(" "),
          separator: pick(separators),
          ...(next() < 0.2 ? { heredocLines: 2 } : {}),
        }),
      );
      const status: Fitted = {
        action: segments.map((segment) => segment.text).join(" "),
        actionSegments: segments,
      };
      const used = new Set(segments.map((segment) => segment.separator));
      for (let columns = 1; columns <= 40; columns += 1) {
        const parts = fitAction(status, columns);
        expect(textColumns(shown(parts))).toBeLessThanOrEqual(columns);
        const operators = parts
          .filter((part) => !part.muted)
          .flatMap((part) => part.text.split(/[^|&;]+/))
          .filter((operator) => operator !== "");
        for (const operator of operators) expect(used).toContain(operator);
      }
    }
  });

  test("slices parts to the columns asked for", () => {
    const parts = [
      plain("$ cleanup"),
      { ...plain(" &&"), whole: true },
      plain(" b c d e"),
    ];
    expect(sliceParts(parts, 0, 8)).toEqual([plain("$ cleanu")]);
    expect(sliceParts(parts, 0, 10)).toEqual([plain("$ cleanup")]);
    expect(sliceParts(parts, 11, 20)).toEqual([plain(" b c d e")]);
    expect(sliceParts(parts, 10, 20)).toEqual([
      { ...plain("&&"), whole: true },
      plain(" b c d e"),
    ]);
  });

  test("fits a fractional width as its whole columns", () => {
    expect(fitAction(find, 0.5)).toEqual([]);
    for (const status of STATUSES)
      for (let width = 0; width <= 200; width += 1)
        expect(fitAction(status, width + 0.5)).toEqual(
          fitAction(status, width),
        );
  });

  test("collapses line breaks and tabs", () => {
    expect(fitAction({ action: "printf a\nprintf\tb" }, 80)).toEqual([
      plain("printf a printf b"),
    ]);
    expect(singleLine("a\r\nb")).toBe("a b");
  });

  test("ships with the TUI and imports no shell module", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/ui/action-fit.ts"),
      "utf8",
    );
    const imports = new Bun.Transpiler({ loader: "ts" })
      .scan(source)
      .imports.map((entry) => entry.path);
    expect(imports).toEqual(["../ui-text-elide.ts", "./fit-parts.ts"]);
    expect(TUI_SHIP_FILES).toContain("dist/tui/ui/action-fit.ts");
    expect(TUI_SHIP_FILES).toContain("dist/tui/ui/fit-parts.ts");
    expect(
      TUI_SHIP_FILES.filter((file) =>
        /shell|capability\/|ui-action-segments|ui-segment-builder|ui-heredoc-|ui-raw-source/.test(
          file,
        ),
      ),
    ).toEqual([]);
  });
});
