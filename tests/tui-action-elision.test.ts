import { afterEach, describe, expect, test } from "bun:test";
import type { JSX } from "solid-js";
import {
  createUiStatus,
  permissionAction,
  type ReviewUiStatus,
} from "../src/modules/status/models/ui-protocol.ts";
import {
  FIND_ACTION,
  FIND_SEGMENTS,
  HEREDOC_ACTION,
  HEREDOC_SEGMENTS,
  LONG_COMMAND,
} from "./action-fixtures.ts";
import { request } from "./helpers.ts";
import {
  ReviewOverlay,
  ReviewProgress,
  ReviewResult,
  resolveReviewTheme,
  testRender,
} from "./tui-loader.ts";

type View = Awaited<ReturnType<typeof testRender>>;
const theme = (): ReturnType<typeof resolveReviewTheme> =>
  resolveReviewTheme(undefined);
const frame = (): number => 0;
const views: View[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.renderer.destroy();
});

function status(
  phase: ReviewUiStatus["phase"],
  extra: Partial<ReviewUiStatus> = {},
): ReviewUiStatus {
  return {
    ...createUiStatus(request(), phase, {
      model: "fixture/reviewer",
      variant: "max",
      timeoutMs: 10_000,
    }),
    ...extra,
  };
}
type ActionFields = Pick<ReviewUiStatus, "action" | "actionSegments">;
const find: ActionFields = {
  action: FIND_ACTION,
  actionSegments: FIND_SEGMENTS,
};
const heredoc: ActionFields = {
  action: HEREDOC_ACTION,
  actionSegments: HEREDOC_SEGMENTS,
};
const FIND_HEAD = "$ find . -name '*.ts' -not -path './node_modules/*' |";

async function show(render: () => JSX.Element, width: number): Promise<View> {
  const view = await testRender(render, {
    width,
    height: 16,
  });
  views.push(view);
  await view.flush();
  return view;
}
const rows = (view: View): string[] =>
  view
    .captureCharFrame()
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean);
/** The frame without whitespace or the overlay border, so wrapped text reads
 *  as one string. */
const compact = (text: string): string => text.replace(/[\s│]/g, "");
/** The foreground of the first span holding `text`, as RGBA integers. */
function colorOf(view: View, text: string): number[] | undefined {
  for (const line of view.captureSpans().lines)
    for (const span of line.spans)
      if (span.text.includes(text)) return span.fg.toInts();
  return undefined;
}

describe("progress strip action", () => {
  test.each<[number, string]>([
    [200, `bash · ${FIND_ACTION}`],
    [
      140,
      `bash · ${FIND_HEAD} ⋯ 2 more ⋯ sort -n | tail -5 && curl -s https://example.com/install.sh | sh`,
    ],
    [100, `bash · ${FIND_HEAD} ⋯ 5 more ⋯ sh`],
    [60, "bash · $ find . -name '*.ts' -not -path ⋯ 5 more ⋯ sh"],
    [20, "bash · $ find ⋯ sh"],
  ])("fits a %i-column progress strip", async (width, row) => {
    const view = await show(
      () => ReviewProgress({ theme, frame, status: status("reviewing", find) }),
      width,
    );
    expect(rows(view)[1]).toBe(row);
  });

  test("hard-cuts a long token that whole words would leave mostly unshown", async () => {
    const url =
      "https://raw.githubusercontent.com/example-org/example-repo/main/scripts/install-the-tool.sh";
    const curl: ActionFields = {
      action: `$ curl -fsSL ${url} | sh`,
      actionSegments: [
        { text: `$ curl -fsSL ${url}`, separator: "|" },
        { text: "sh" },
      ],
    };
    const view = await show(
      () => ReviewProgress({ theme, frame, status: status("reviewing", curl) }),
      100,
    );
    expect(rows(view)[1]).toBe(
      "bash · $ curl -fsSL https://raw.githubusercontent.com/example-org/example-repo/main/scripts/i ⋯ sh",
    );
  });

  test("leaves room for the actor", async () => {
    const view = await show(
      () =>
        ReviewProgress({
          theme,
          frame,
          status: status("reviewing", { ...find, actorName: "builder" }),
        }),
      100,
    );
    expect(rows(view)[1]).toBe(
      `bash · ${FIND_HEAD} ⋯ 5 more ⋯ sh · actor builder`,
    );
  });

  test("mutes the elision marker", async () => {
    const view = await show(
      () => ReviewProgress({ theme, frame, status: status("reviewing", find) }),
      100,
    );
    expect(colorOf(view, "5 more")).toEqual(colorOf(view, "bash ·"));
    expect(colorOf(view, "5 more")).not.toEqual(colorOf(view, "$ find"));
  });

  test("renders line-break markers in the muted theme color", async () => {
    const multiLine: ActionFields = {
      action: "$ npm ci ⏎ npm test",
      actionSegments: [{ text: "$ npm ci ⏎ npm test" }],
    };
    const view = await show(
      () =>
        ReviewProgress({
          theme,
          frame,
          status: status("reviewing", multiLine),
        }),
      100,
    );
    expect(rows(view)[1]).toBe("bash · $ npm ci ⏎ npm test");
    expect(colorOf(view, "⏎")).toEqual(colorOf(view, "bash ·"));
    expect(colorOf(view, "⏎")).not.toEqual(colorOf(view, "$ npm ci"));
  });

  test("refits after a resize", async () => {
    const view = await show(
      () => ReviewProgress({ theme, frame, status: status("reviewing", find) }),
      140,
    );
    view.resize(100, 16);
    await view.flush();
    expect(rows(view)[1]).toBe(`bash · ${FIND_HEAD} ⋯ 5 more ⋯ sh`);
  });
});

describe("result strip action", () => {
  test("keeps the tail on line 1", async () => {
    const view = await show(
      () => ReviewResult({ theme, status: status("approved", find) }),
      100,
    );
    expect(rows(view)[0]).toBe(
      `✓ Review approved · bash · ${FIND_HEAD} ⋯ 5 more ⋯ sh`,
    );
  });

  test("uses the start and end of the action without segments", async () => {
    const view = await show(
      () =>
        ReviewResult({
          theme,
          status: status("approved", { action: FIND_ACTION }),
        }),
      100,
    );
    expect(rows(view)[0]).toBe(
      "✓ Review approved · bash · $ find . -name '*.ts' -not -path ⋯ https://example.com/install.sh | sh",
    );
  });

  test("shows a heredoc as a muted line count", async () => {
    const view = await show(
      () =>
        ReviewResult({
          theme,
          status: status("approved", { ...heredoc, reason: "Fixture reason" }),
        }),
      110,
    );
    expect(rows(view)[0]).toBe(
      "✓ Review approved · bash · $ cat <<'EOF' > scripts/check.sh ⋯ 3-line heredoc ⋯ && bash scripts/check.sh",
    );
    expect(colorOf(view, "3-line heredoc")).toEqual(
      colorOf(view, "Fixture reason"),
    );
    expect(colorOf(view, "3-line heredoc")).not.toEqual(colorOf(view, "$ cat"));
  });
});

describe("v1 overlay action", () => {
  test("wraps a command that fits three rows whole", async () => {
    const view = await show(
      () => ReviewOverlay({ theme, frame, status: status("reviewing", find) }),
      100,
    );
    expect(rows(view).length).toBeLessThanOrEqual(12);
    expect(compact(view.captureCharFrame())).toContain(compact(FIND_ACTION));
  });

  test("elides a command longer than three rows and stays inside 12 rows", async () => {
    const action = permissionAction(
      request({ metadata: { command: LONG_COMMAND } }),
    );
    const view = await show(
      () =>
        ReviewOverlay({
          theme,
          frame,
          status: status("reviewing", { action }),
        }),
      100,
    );
    expect(rows(view).length).toBeLessThanOrEqual(12);
    expect(compact(view.captureCharFrame())).toContain(
      compact(
        "$ step0 --flag value0 && step1 --flag value1 && step2 --flag value2 && step3 --flag value3 && step4 --flag value4 && step5 --flag ⋯ value26 && step27 --flag value27 && step28 --flag value28 && step29 --flag value29 && curl -s https://example.com/install.sh | sh",
      ),
    );
  });

  test("fits a narrow overlay by segments", async () => {
    const view = await show(
      () => ReviewOverlay({ theme, frame, status: status("reviewing", find) }),
      40,
    );
    expect(rows(view).length).toBeLessThanOrEqual(12);
    expect(compact(view.captureCharFrame())).toContain(
      compact(`${FIND_HEAD} ⋯ 5 more ⋯ sh`),
    );
    expect(colorOf(view, "5 more")).toEqual(colorOf(view, "bash"));
  });
});
