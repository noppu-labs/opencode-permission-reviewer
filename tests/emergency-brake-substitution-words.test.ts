import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brakeReadingsReason } from "../src/brake-readings.ts";
import { emergencyBrakeReason } from "../src/emergency-brake.ts";
import type { ShellQuoting } from "../src/shell-lex-state.ts";
import { request } from "./helpers.ts";

const blocked =
  "Emergency brake: command contains unmistakable broad system destruction.";

/** `block` and `allow` are plain commands; `rescanOnly` are commands that,
 *  of the previous release's readings, only the rescan reading of a
 *  substitution body blocks. One row per line in
 *  tests/fixtures/emergency-brake-substitution-rows.json. */
const ROWS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/emergency-brake-substitution-rows.json"),
    "utf8",
  ),
) as { block: string[]; allow: string[]; rescanOnly: string[] };

const brake = (command: string): string | undefined =>
  emergencyBrakeReason(request({ metadata: { command } }));

/** Wraps a command in each command-string form the brake re-lexes. */
const doubleQuoted = (text: string): string =>
  `"${text.replace(/[\\"$`]/g, (char: string): string => `\\${char}`)}"`;
const singleQuoted = (text: string): string =>
  `'${text.replaceAll("'", "'\\''")}'`;

const WRAPPERS: Record<string, (command: string) => string> = {
  plain: (command: string): string => command,
  "bash -c": (command: string): string => `bash -c ${doubleQuoted(command)}`,
  "sh -c": (command: string): string => `sh -c ${singleQuoted(command)}`,
  "sudo bash -c": (command: string): string =>
    `sudo bash -c ${doubleQuoted(command)}`,
  "env -S": (command: string): string => `env -S ${singleQuoted(command)}`,
  "find -exec sh -c": (command: string): string =>
    `find . -exec sh -c ${doubleQuoted(command)} \\;`,
};

describe("root destruction after a substitution body", () => {
  for (const [wrapper, wrap] of Object.entries(WRAPPERS)) {
    test.each(ROWS.block)(`blocks through ${wrapper}: %j`, (command) => {
      expect(brake(wrap(command))).toBe(blocked);
    });
  }
});

describe("everyday substitution forms", () => {
  test.each(ROWS.allow)("allows %j", (command) => {
    expect(brake(command)).toBeUndefined();
  });
});

describe("the reading reaches each command-string wrapper", () => {
  const readings: ShellQuoting[] = ["bash", "rescan", "undecoded", "previous"];
  for (const [wrapper, wrap] of Object.entries(WRAPPERS)) {
    test.each(ROWS.rescanOnly)(
      `blocks through ${wrapper}, by the rescan reading: %j`,
      (command) => {
        const wrapped = wrap(command);
        expect(brake(wrapped)).toBe(blocked);
        const blocks = readings.filter(
          (reading) => brakeReadingsReason(wrapped, reading) !== undefined,
        );
        expect(blocks.filter((reading) => reading !== "bash")).toEqual([
          "rescan",
        ]);
      },
    );
  }
});
