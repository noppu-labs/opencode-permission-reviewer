import { afterEach, describe, expect, test } from "bun:test";
import { createUiStatus, type ReviewUiStatus } from "../src/ui-protocol.ts";
import { request } from "./helpers.ts";
import {
  ReviewOverlay,
  ReviewProgress,
  ReviewResult,
  testRender,
} from "./tui-loader.ts";

const THEME = {
  backgroundPanel: "#111111",
  text: "#eeeeee",
  textMuted: "#999999",
  info: "#4da3ff",
  success: "#48c774",
  error: "#ff5c5c",
};
const theme = (): typeof THEME => THEME;
const frame = (): number => 0;

const destroyers: Array<() => void> = [];
afterEach(() => {
  for (const destroy of destroyers.splice(0)) destroy();
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

/** The non-blank rows of the rendered frame, trimmed. */
async function rows(render: () => unknown): Promise<string[]> {
  const view = await testRender(() => render() as Element, {
    width: 100,
    height: 16,
  });
  destroyers.push(() => view.renderer.destroy());
  await view.flush();
  return view
    .captureCharFrame()
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean);
}

describe("review result strip", () => {
  test.each([
    ["approved", {}, "✓ Review approved · bash · $ printf safe"],
    ["unknown", {}, "? Review status unavailable · bash · $ printf safe"],
    ["denied", {}, "✕ Review blocked · bash · $ printf safe"],
    [
      "denied",
      { escalationDisposition: "deny" },
      "✕ Review blocked (fail-closed) · bash · $ printf safe",
    ],
    [
      "denied",
      { escalationDisposition: "manual" },
      "✕ Review blocked · bash · $ printf safe",
    ],
  ] as const)("shows %s %o as one row", async (phase, extra, row) => {
    const shown = await rows(() =>
      ReviewResult({ theme, status: status(phase, extra) }),
    );
    expect(shown).toEqual([row]);
  });

  test("adds the reason on a second row, on one line", async () => {
    const shown = await rows(() =>
      ReviewResult({
        theme,
        status: status("approved", {
          action: "printf a\nprintf b",
          reason: "First line\r\nsecond\tline",
        }),
      }),
    );
    expect(shown).toEqual([
      "✓ Review approved · bash · printf a printf b",
      "First line second line",
    ]);
  });
});

describe("review progress strip", () => {
  test("shows the model, variant, permission and action without an actor", async () => {
    const shown = await rows(() =>
      ReviewProgress({
        theme,
        frame,
        status: status("reviewing", { model: "fixture/\nreviewer" }),
      }),
    );
    expect(shown).toHaveLength(2);
    expect(shown[0]).toStartWith(
      "◐ Reviewing this permission · fixture/ reviewer · max",
    );
    expect(shown[0]).toMatch(/\d+\.\ds$/);
    expect(shown[1]).toBe("bash · $ printf safe");
  });

  test("names the actor on one line when there is one", async () => {
    const shown = await rows(() =>
      ReviewProgress({
        theme,
        frame,
        status: status("reviewing", { actorName: "build\ner" }),
      }),
    );
    expect(shown[1]).toBe("bash · $ printf safe · actor build er");
  });
});

describe("review overlay", () => {
  test("shows the review details and names the actor when there is one", async () => {
    const shown = await rows(() =>
      ReviewOverlay({
        theme,
        frame,
        status: status("reviewing", { actorName: "builder" }),
      }),
    );
    expect(shown).toHaveLength(7);
    expect(shown[1]).toMatch(/^│ {2}◐ Reviewing this permission +\d+\.\ds$/);
    expect(shown[3]).toBe("│    bash $ printf safe · actor builder");
    expect(shown[5]).toMatch(
      /^│ {4}fixture\/reviewer · reasoning max +No action needed$/,
    );
  });

  test("leaves the actor out when there is none", async () => {
    const shown = await rows(() =>
      ReviewOverlay({ theme, frame, status: status("reviewing") }),
    );
    expect(shown[3]).toBe("│    bash $ printf safe");
  });
});
