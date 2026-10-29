import { describe, expect, test } from "bun:test";
import stringWidth from "string-width";
import type { ReviewUiStatus } from "../src/modules/status/models/ui-protocol.ts";
import { createServerUiStatus } from "../src/modules/status/services/ui-action-segments.ts";
import { type ActionFitPart, fitAction } from "../src/ui/action-fit.ts";
import {
  fitHead,
  fitMiddle,
  fitTail,
  sliceParts,
  textColumns,
} from "../src/ui/fit-parts.ts";
import {
  FIND_ACTION,
  FIND_SEGMENTS,
  GIT_LOG_ACTION,
  GIT_LOG_SEGMENTS,
  HEREDOC_ACTION,
  HEREDOC_SEGMENTS,
} from "./action-fixtures.ts";
import { request } from "./helpers.ts";

type Fitted = Pick<ReviewUiStatus, "action" | "actionSegments">;
const plain = (text: string): ActionFitPart => ({ text, muted: false });
const shown = (parts: readonly ActionFitPart[]): string =>
  parts.map((part) => part.text).join("");
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string): string[] =>
  Array.from(SEGMENTER.segment(text), ({ segment }) => segment);

const CJK_COMMIT = '$ git commit -m "修复登录页面的错误，并更新相关的测试用例"';
const cjk: Fitted = {
  action: `${CJK_COMMIT} | sh`,
  actionSegments: [{ text: CJK_COMMIT, separator: "|" }, { text: "sh" }],
};
const serverCjk: Fitted = createServerUiStatus(
  request({
    metadata: {
      command:
        'git commit -m "修复登录页面的错误，并更新相关的测试用例" && echo 完成 | sh',
    },
  }),
  "reviewing",
  { model: "fixture/reviewer", variant: "max", timeoutMs: 10_000 },
);
const emoji: Fitted = { action: `$ echo ${"🇯🇵👍🏽".repeat(40)}` };
const mixed: Fitted = {
  action: `$ printf 'Ｈｅｌｌｏ 世界 🎉 café' && echo ${"ﾊﾝｶｸ e\u0301 ✅ 日本 ".repeat(8)} | tee 結果.txt`,
  actionSegments: [
    {
      text: "$ printf 'Ｈｅｌｌｏ 世界 🎉 café'",
      separator: "&&",
    },
    {
      text: `echo ${"ﾊﾝｶｸ e\u0301 ✅ 日本 ".repeat(8).trimEnd()}`,
      separator: "|",
    },
    { text: "tee 結果.txt" },
  ],
};
const STATUSES: readonly Fitted[] = [
  { action: FIND_ACTION, actionSegments: FIND_SEGMENTS },
  { action: GIT_LOG_ACTION, actionSegments: GIT_LOG_SEGMENTS },
  { action: HEREDOC_ACTION, actionSegments: HEREDOC_SEGMENTS },
  { action: FIND_ACTION },
  cjk,
  serverCjk,
  emoji,
  mixed,
  { action: `$ ${"漢".repeat(150)}` },
];

describe("column fit", () => {
  test("textColumns counts terminal columns", () => {
    for (const text of [
      "修复",
      "Ａ",
      "🇯🇵",
      "👍🏽",
      "🎉",
      "e\u0301",
      "café",
      "ﾊﾝｶｸ",
    ])
      expect(textColumns(text)).toBe(stringWidth(text));
    expect(textColumns("e\u0301")).toBe(1);
  });

  test("sliceParts drops a wide character that straddles either edge", () => {
    const parts = [plain("ab修复cd")];
    expect(sliceParts(parts, 0, 3)).toEqual([plain("ab")]);
    expect(sliceParts(parts, 0, 4)).toEqual([plain("ab修")]);
    expect(sliceParts(parts, 3, 8)).toEqual([plain("复cd")]);
    expect(sliceParts([plain("修"), plain("复")], 1, 4)).toEqual([plain("复")]);
  });

  test("column wrappers keep whole graphemes within the columns", () => {
    expect(fitHead("修复登录 页面", 7)).toBe("修复登");
    expect(fitTail("修复 登录页面", 7)).toBe("录页面");
    expect(fitMiddle("修复登录页面的错误", 9)).toEqual({
      head: "修",
      tail: "错误",
    });
    expect(fitMiddle("修复登录页面的错误", 11)).toEqual({
      head: "修复",
      tail: "错误",
    });
  });

  test.each([40, 80])("fits a CJK command at %i columns", (columns) => {
    const fit = shown(fitAction(cjk, columns));
    expect(fit).toEndWith("sh");
    expect(stringWidth(fit)).toBeLessThanOrEqual(columns);
  });

  test("the server's CJK status fits and keeps its last segment", () => {
    expect(serverCjk.actionSegments).toBeDefined();
    for (const columns of [30, 40, 60, 80]) {
      const fit = shown(fitAction(serverCjk, columns));
      expect(fit).toEndWith("sh");
      expect(stringWidth(fit)).toBeLessThanOrEqual(columns);
    }
  });

  test("never splits a flag or a skin-toned emoji", () => {
    for (let columns = 0; columns <= 120; columns += 1) {
      const strays = graphemes(shown(fitAction(emoji, columns))).filter(
        (grapheme) =>
          !/^[\x20-\x7e]$/.test(grapheme) &&
          !["⋯", "🇯🇵", "👍🏽"].includes(grapheme),
      );
      expect(strays).toEqual([]);
    }
  });

  test("keeps the tail of wide text when a wide character leaves no room for both ends", () => {
    const action = "日本語".repeat(4);
    expect(shown(fitAction({ action }, 5))).toBe(" ⋯ 語");
    expect(shown(fitAction({ action }, 6))).toBe(" ⋯ 語");
    expect(shown(fitAction({ action }, 7))).toBe("日 ⋯ 語");
  });

  test("measures keycaps as wide", () => {
    const status = createServerUiStatus(
      request({ metadata: { command: `echo ${"1\u20e3".repeat(8)} | sh` } }),
      "reviewing",
      { model: "fixture/reviewer", variant: "max", timeoutMs: 10_000 },
    );
    for (let columns = 0; columns <= 40; columns += 1)
      expect(
        stringWidth(shown(fitAction(status, columns))),
      ).toBeLessThanOrEqual(columns);
  });

  test("combining marks take no column", () => {
    const action = "e\u0301".repeat(100);
    expect(textColumns(action)).toBe(100);
    expect(fitAction({ action }, 100)).toEqual([plain(action)]);
  });

  test("is never wider than the columns it is given", () => {
    for (const status of STATUSES)
      for (let columns = 0; columns <= 200; columns += 1)
        expect(
          stringWidth(shown(fitAction(status, columns))),
        ).toBeLessThanOrEqual(columns);
  });
});
