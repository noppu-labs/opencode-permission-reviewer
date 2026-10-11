// tests/gnu-long-options.test.ts
import { describe, expect, test } from "bun:test";
import {
  CP_LONG_OPTIONS,
  RM_LONG_OPTIONS,
  SFDISK_LONG_OPTIONS,
} from "../src/gnu-long-option-tables.ts";
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

  test.each(["--", "--=x"])(
    "an empty name resolves to nothing even with a single-option table, case %#",
    (token) => {
      const table = [{ name: "recursive", argument: "none" }] as const;
      expect(resolveGnuLongOption(token, table)).toBeUndefined();
    },
  );

  test("an exact name wins over a longer name sharing its prefix", () => {
    const table = [
      { name: "color", argument: "none" },
      { name: "colors", argument: "none" },
    ] as const;
    expect(resolveGnuLongOption("--color", table)?.name).toBe("color");
    expect(resolveGnuLongOption("--col", table)).toBeUndefined();
  });

  test("aliases of one option that differ in argument are ambiguous on a shared prefix", () => {
    const table = [
      { name: "alpha", argument: "none", id: "a" },
      { name: "alpine", argument: "required", id: "a" },
    ] as const;
    expect(resolveGnuLongOption("--al", table)).toBeUndefined();
  });

  test("a required-argument option resolves with and without an inline value", () => {
    const table = [{ name: "target", argument: "required" }] as const;
    expect(resolveGnuLongOption("--target", table)).toEqual({
      name: "target",
      argument: "required",
      inlineValue: false,
    });
    expect(resolveGnuLongOption("--tar=dir", table)).toEqual({
      name: "target",
      argument: "required",
      inlineValue: true,
    });
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

describe("device and copy option tables", () => {
  test("cp's deprecated --path aliases --parents, so --pa is not ambiguous", () => {
    expect(resolveGnuLongOption("--pa", CP_LONG_OPTIONS)?.name).toBe("parents");
  });

  test("sfdisk --wipe is exact, --wip is ambiguous", () => {
    expect(resolveGnuLongOption("--wipe", SFDISK_LONG_OPTIONS)?.name).toBe(
      "wipe",
    );
    expect(resolveGnuLongOption("--wip", SFDISK_LONG_OPTIONS)).toBeUndefined();
  });
});
