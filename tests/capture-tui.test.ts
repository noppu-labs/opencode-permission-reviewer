import { describe, expect, test } from "bun:test";
import type { CapturedFrame, CapturedSpan } from "@opentui/core";
// Registers the Solid transform before any TUI module loads (see tests/tui-loader.ts); the
// capture modules are imported dynamically after it for the same reason.
import "./tui-loader.ts";

const { RGBA, TextAttributes }: typeof import("@opentui/core") = await import(
  "@opentui/core"
);
const { frameToAnsi, textRow }: typeof import("../scripts/capture/ansi.ts") =
  await import("../scripts/capture/ansi.ts");

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
