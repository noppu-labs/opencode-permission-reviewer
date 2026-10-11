// tests/emergency-brake-hardening.test.ts
import { describe, expect, test } from "bun:test";
import { hasRmFlags } from "../src/brake-rm-flags.ts";
import { emergencyBrakeReason } from "../src/emergency-brake.ts";
import { request } from "./helpers.ts";

describe("rm long options are resolved like GNU getopt_long", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "rm --rec --forc --no-preserve-root /",
    "rm --r --f /*",
    "rm --recur --force /*",
    "rm --recursive --forc /*",
    "sudo rm --r --f /",
    "bash -c 'rm --recur --fo /'",
    "find / -exec rm --r --f {} +",
  ])(
    "an abbreviated recursive or force option counts like its full spelling, case %#",
    (command) => {
      expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
        blocked,
      );
    },
  );

  test.each([
    "rm --v --f /",
    "rm --interactive=never --f /",
    "rm --one-file-system --no-preserve-root /",
    "rm --recursive=yes --f /",
    "rm -f -- --recursive /",
    "rm -r -- --force /",
  ])(
    "an option that is neither recursive nor force, or a word after --, sets neither, case %#",
    (command) => {
      expect(
        emergencyBrakeReason(request({ metadata: { command } })),
      ).toBeUndefined();
    },
  );
});

describe("rm records whether root protection is switched off", () => {
  const flagsOf = (command: string): boolean =>
    hasRmFlags(command.split(" ").map((word) => ({ raw: word, value: word })))
      .noPreserveRoot;

  test.each([
    ["rm -rf --no-preserve-root /", true],
    ["rm -rf --no-preserve-root --preserve-root /", false],
    ["rm -rf --no-preserve-root --preserve-root=all /", false],
    ["rm -rf --no-preserve-root --pre /", false],
    ["rm -rf --preserve-root --no-preserve-root /", true],
    ["rm -rf --no-preserve /", false],
    ["rm -rf --no-preserve-root=yes /", false],
    ["rm -rf -- --no-preserve-root /", false],
    ["rm -rf /", false],
  ])(
    "the root-protection flag follows the last accepted spelling, case %#",
    (command, expected) => {
      expect(flagsOf(command)).toBe(expected);
    },
  );
});
