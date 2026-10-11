// tests/gnu-long-options.test.ts
import { describe, expect, test } from "bun:test";
import { RM_LONG_OPTIONS } from "../src/gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "../src/gnu-long-options.ts";

const resolve = (token: string): string | undefined =>
  resolveGnuLongOption(token, RM_LONG_OPTIONS)?.name;

describe("GNU long-option resolution (getopt_long rules)", () => {
  test.each([
    ["--recursive", "recursive"],
    ["--force", "force"],
    ["--no-preserve-root", "no-preserve-root"],
    ["--preserve-root=all", "preserve-root"],
    ["--interactive=never", "interactive"],
    ["---presume-input-tty", "-presume-input-tty"],
  ])("an exact name resolves to itself, case %#", (token, name) => {
    expect(resolve(token)).toBe(name);
  });

  test.each([
    ["--r", "recursive"],
    ["--recur", "recursive"],
    ["--f", "force"],
    ["--forc", "force"],
    ["--n", "no-preserve-root"],
    ["--o", "one-file-system"],
    ["--d", "dir"],
    ["--verb", "verbose"],
  ])("a unique prefix resolves to its option, case %#", (token, name) => {
    expect(resolve(token)).toBe(name);
  });

  test.each(["--v", "--ver", "--"])(
    "an ambiguous or empty name resolves to nothing, case %#",
    (token) => {
      expect(resolve(token)).toBeUndefined();
    },
  );

  test.each(["--recursivex", "--x", "-r", "recursive", "--force=yes"])(
    "an unknown option, a non-long token, or a value on a no-argument option resolves to nothing, case %#",
    (token) => {
      expect(resolve(token)).toBeUndefined();
    },
  );

  test("prefixes that match only aliases of one option are not ambiguous", () => {
    const table = [
      { name: "parents", argument: "none", id: "parents" },
      { name: "path", argument: "none", id: "parents" },
    ] as const;
    expect(resolveGnuLongOption("--pa", table)?.name).toBe("parents");
  });

  test("an inline value is reported", () => {
    expect(
      resolveGnuLongOption("--preserve-root=all", RM_LONG_OPTIONS),
    ).toEqual({
      name: "preserve-root",
      argument: "optional",
      inlineValue: true,
    });
  });
});
