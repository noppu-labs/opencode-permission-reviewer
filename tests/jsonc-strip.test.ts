import { describe, expect, test } from "bun:test";
import {
  parseJsonc,
  parseJsoncStrict,
  stripCommentsAndTrailingCommas,
} from "../src/config/jsonc.ts";

describe("JSONC stripping", () => {
  test("an escaped quote does not end the string, so later markers stay text", () => {
    expect(parseJsonc('{"a":"q\\" // kept"}')).toEqual({ a: 'q" // kept' });
    expect(parseJsonc('{"a":"q\\\\", "b": 1 // dropped\n}')).toEqual({
      a: "q\\",
      b: 1,
    });
  });

  test.each([
    ["space", '{"a":[1, ]}'],
    ["tab", '{"a":[1,\t]}'],
    ["newline", '{"a":[1,\n]}'],
    ["carriage return", '{"a":[1,\r\n]}'],
  ])("a trailing comma before ] is removed across a %s", (_label, text) => {
    expect(parseJsonc(text)).toEqual({ a: [1] });
  });

  test("a trailing comma is removed before } and ] alike", () => {
    expect(stripCommentsAndTrailingCommas("[1,]")).toBe("[1]");
    expect(stripCommentsAndTrailingCommas('{"a":1, /* c */ }')).toBe('{"a":1}');
    expect(stripCommentsAndTrailingCommas('{"a":1,\r\n}')).toBe('{"a":1}');
  });

  test("comments are stripped without touching the surrounding text", () => {
    expect(stripCommentsAndTrailingCommas('{"a":1}// x\r\n')).toBe('{"a":1}\n');
    expect(stripCommentsAndTrailingCommas("1 /* open")).toBe("1 ");
    expect(stripCommentsAndTrailingCommas('"open \\')).toBe('"open \\');
  });

  test.each([
    ["null", "null"],
    ["array", "[1]"],
    ["string", '"x"'],
    ["number", "1"],
  ])("a top-level %s is rejected by the strict parser", (_label, text) => {
    expect(() => parseJsoncStrict(text)).toThrow(
      "top-level value is not a JSON object",
    );
    expect(parseJsonc(text)).toEqual({});
  });
});
