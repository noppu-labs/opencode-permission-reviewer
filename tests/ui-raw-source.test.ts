import { describe, expect, test } from "bun:test";
import {
  locateSeparator,
  locateToken,
  onlySkipped,
  touchesOperator,
} from "../src/ui-raw-source.ts";
import { TUI_SHIP_FILES } from "./package-tui-files.ts";

describe("a token's source text", () => {
  test("locates a plain word and a double-quoted token directly", () => {
    expect(locateToken("echo ls x", "ls", 5)).toEqual({
      start: 5,
      end: 7,
      next: 7,
    });
    const source = 'printf "%s\\n" x';
    expect(locateToken(source, '"%s\\n"', 6)).toEqual({
      start: 7,
      end: 13,
      next: 13,
    });
    expect(locateToken(source, '"%s\\nn"', 6)).toBeUndefined();
  });
});

describe("locating a token", () => {
  test("finds the token at or after the cursor", () => {
    expect(locateToken("echo a a", "a", 5)).toEqual({
      start: 5,
      end: 6,
      next: 6,
    });
    expect(locateToken("echo a a", "a", 6)).toEqual({
      start: 7,
      end: 8,
      next: 8,
    });
  });

  test("locates a token after a separator and its continuation", () => {
    expect(locateToken("echo a;\\\n b", "b", 6)).toEqual({
      start: 10,
      end: 11,
      next: 11,
    });
  });

  test("keeps a continuation that is part of the token", () => {
    expect(locateToken("echo a \\\nb | wc", "\\\nb", 6)).toEqual({
      start: 7,
      end: 10,
      next: 10,
    });
  });

  test("finds nothing for a token not in the source", () => {
    expect(locateToken("echo a", "b", 0)).toBeUndefined();
    expect(locateToken("echo a", "a", 6)).toBeUndefined();
  });
});

describe("locating a separator", () => {
  test("finds an operator at or after the cursor", () => {
    expect(locateSeparator("a && b", "&&", 1)).toEqual({
      start: 2,
      end: 4,
      next: 4,
    });
    expect(locateSeparator("$(a)", ")", 3)).toEqual({
      start: 3,
      end: 4,
      next: 4,
    });
  });

  test("finds ; as a semicolon or the first line break", () => {
    expect(locateSeparator("a; b\nc", ";", 1)).toEqual({
      start: 1,
      end: 2,
      next: 2,
    });
    expect(locateSeparator("a\nb; c", ";", 1)).toEqual({
      start: 1,
      end: 1,
      next: 2,
    });
    expect(locateSeparator("a\r\nb", ";", 2)).toEqual({
      start: 2,
      end: 2,
      next: 3,
    });
  });

  test("finds nothing for a separator not in the source", () => {
    expect(locateSeparator("a b", "|", 0)).toBeUndefined();
    expect(locateSeparator("a b", ";", 0)).toBeUndefined();
  });
});

describe("text between items", () => {
  test.each<[string, string, boolean, boolean]>([
    ["blanks", "a \t b", false, true],
    ["a line continuation", "a \\\n b", false, true],
    ["a comment", "a # note\n", false, true],
    ["a comment before a line break", "a # note\n b", true, true],
    ["a line break between commands", "a \n b", true, true],
    ["a line break inside a command", "a \n b", false, false],
    ["a word", "a x b", false, false],
    ["a # inside a word", "a x#y b", false, false],
    ["an operator", "a | b", false, false],
  ])("%s", (_name, source, lineBreaks, skipped) => {
    expect(onlySkipped(source, 1, source.length - 1, lineBreaks)).toBe(skipped);
  });

  test("ends a comment at its line break", () => {
    expect(onlySkipped("a # note\nb", 1, 5, true)).toBe(false);
  });
});

describe("a separator's neighbours", () => {
  test.each<[string, string, number, number, boolean]>([
    ["spaces", "a && b", 2, 4, false],
    ["words", "a&&b", 1, 3, false],
    ["an operator before it", "a >|| b", 3, 5, true],
    ["an operator after it", "a ||> b", 2, 4, true],
    ["a line break", "a;\n;b", 2, 2, false],
  ])("with %s", (_name, source, start, end, touches) => {
    expect(touchesOperator(source, { start, end, next: end })).toBe(touches);
  });
});

test("stays out of the TUI", () => {
  expect(
    TUI_SHIP_FILES.filter((file) => file.includes("ui-raw-source")),
  ).toEqual([]);
});
