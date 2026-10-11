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

describe("recursive rm on a protected target needs no force", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "rm -r /*",
    "rm -R /*",
    "rm --recursive /*",
    "rm -r //**",
    'rm -r "/"*',
    "rm -r --no-preserve-root /",
    "rm -R --no-preserve-root /tmp/..",
    "sudo rm -r /*",
    "sh -c 'rm -r /*'",
    "find / -exec rm -r {} +",
    "find / -name x -exec rm -R {} \\;",
  ])(
    "blocks recursive rm on a protected target without force, case %#",
    (command) => {
      expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
        blocked,
      );
    },
  );

  test.each([
    // Plain `/` needs force or --no-preserve-root: GNU and BSD rm refuse it.
    "rm -r /",
    "rm -r --one-file-system /",
    // coreutils rejects an abbreviated --no-preserve-root and removes nothing.
    "rm -r --no-pres /",
    // The later option wins, as in coreutils.
    "rm -r --no-preserve-root --preserve-root /",
    // Literal file names and non-root paths.
    "rm -r '/*'",
    "rm -r /\\*",
    "rm -r /tmp/build",
    "rm -R /var/tmp/cache/*",
    "rm --rec ./dist",
    "rm /*",
    "find /tmp -exec rm -r {} +",
  ])("keeps a non-destructive neighbour allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("find checks every search path", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "find /tmp / -delete",
    "find /tmp /var / -delete",
    "find -L /tmp / -delete",
    "find /tmp //* -delete",
    "find /srv / -exec rm -rf {} +",
    "sudo find /tmp / -delete",
    "sh -c 'find /tmp / -delete'",
    "find -- /tmp / -delete",
    "find -L -- /tmp / -delete",
    "find -d /tmp / -delete",
    "find -s /tmp / -delete",
    "find -x /tmp / -delete",
    "find -f /tmp / -delete",
    "find -f / -delete",
    "find /tmp , / -delete",
    "find /tmp ')' / -delete",
  ])("blocks when any search path is the root, case %#", (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });

  test.each([
    "find /tmp /var -delete",
    // A word after the first expression word belongs to the expression.
    "find /tmp ! -name / -delete",
    "find /tmp -name / -delete",
    "find /tmp / -print",
    "find /tmp '(' -name x ')' -delete",
    // An expression word before the paths: find rejects the command line.
    "find -maxdepth 1 / -delete",
  ])("keeps a non-root search allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("a root glob may end in a slash", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "rm -r /*/",
    "rm -rf /*/",
    "rm -r //*//",
    'rm -r "/"*/',
    "find /*/ -delete",
  ])("blocks a live root glob with trailing slashes, case %#", (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });

  test.each([
    "rm -r '/*/'",
    "rm -r /\\*/",
    "rm -r /*/tmp",
    "rm -r /tmp/*/",
    "find /tmp/*/ -delete",
  ])("keeps a deeper or literal path allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});
