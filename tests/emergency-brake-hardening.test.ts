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
    "find -f / -delete x",
    "find -f / -delete -print",
    "find -L -f / -delete x",
    "find -f / -delete <<EOF\nbody\nEOF",
    "find -dx /tmp / -delete",
    "find -Lx /tmp / -delete",
    "find -sx /tmp / -delete",
    "find -dL /tmp / -delete",
    "find -Hf /tmp / -delete",
    "find -f/ -delete",
    "find -Lf/ -delete",
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
    "find -dx /tmp /var -delete",
    "find -Hf /tmp -delete",
    "find -delete",
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

describe("device and copy detectors resolve long-option prefixes", () => {
  test.each([
    "wipefs --a /dev/sda",
    "wipefs --ty ext4 /dev/sda",
    "sfdisk --del /dev/sda 1",
    "cp src /dev/sda --suf x",
    "install src /dev/sda --mo 0644",
    "cp --context src /dev/sda",
  ])(
    "blocks a device or copy command with an abbreviated option, case %#",
    (command) => {
      expect(
        emergencyBrakeReason(request({ metadata: { command } })),
      ).toBeString();
    },
  );

  test.each([
    "wipefs --no-act /dev/sda",
    "wipefs --j /dev/sda",
    "sfdisk --du /dev/sda",
    "sfdisk --wip x /dev/sda",
    "cp --target /mnt src /dev/sda",
    "cp --suf x src /mnt/copy",
    "cp --sparse always src /mnt/copy",
  ])(
    "keeps a non-destructive device or copy command allowed, case %#",
    (command) => {
      expect(
        emergencyBrakeReason(request({ metadata: { command } })),
      ).toBeUndefined();
    },
  );
});

describe("device format and wipe options follow each tool", () => {
  test.each([
    "mkfs.xfs -n size=8192 /dev/sdb",
    "mkfs.btrfs -n 65536 /dev/sdb",
    "mkfs.vfat -n DATA /dev/sdb",
    "mkfs -t xfs -n size=8192 /dev/sdb",
    "mkfs -txfs -n size=8192 /dev/sdb",
    "mkswap -n /dev/sdb",
    "sgdisk -d1 /dev/sda",
    "sgdisk -d12 /dev/sda",
    "wipefs -o 0x438 /dev/sda",
    "wipefs -o0x438 /dev/sda",
    "wipefs --offset 0x438 /dev/sda",
    "wipefs --offs=0x438 /dev/sda",
    "wipefs -fo 0x438 /dev/sda",
    "sudo mkfs.xfs -n size=8192 /dev/sdb",
  ])("blocks a device format or wipe, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeString();
  });

  test.each([
    "mkfs.ext4 -n /dev/sdb",
    "mke2fs -n /dev/sdb",
    "mkfs -n /dev/sdb",
    "mkfs -t ext4 -n /dev/sdb",
    "mkfs.xfs -N /dev/sdb",
    "mkfs.xfs --dry-run /dev/sdb",
    "sgdisk -d /dev/sda",
    "sgdisk -p /dev/sda",
    "wipefs /dev/sda",
    "wipefs --no-act /dev/sda",
    "wipefs -o 0x438 disk.img",
  ])("keeps a dry run or listing allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("device option clusters and long names are read in full", () => {
  test.each([
    "mkfs --type xfs -n /dev/sdb",
    "mkfs --type=xfs -n /dev/sdb",
    "mkfs --ty=xfs -n /dev/sdb",
    "mkfs -Vt xfs -n /dev/sdb",
    "mkfs -vtxfs -n /dev/sdb",
    "mkfs --type -n /dev/sdb",
    "wipefs -fo0x438 /dev/sda",
    "wipefs -qo0x438 /dev/sda",
    "wipefs -ft dos /dev/sda",
    "sgdisk -pd1 /dev/sda",
    "sgdisk -pd 1 /dev/sda",
  ])("blocks a device format or wipe, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeString();
  });

  test.each([
    "mkfs --type ext4 -n /dev/sdb",
    "mkfs -Vt ext4 -n /dev/sdb",
    "mkfs --ty=ext3 -n /dev/sdb",
    "mkfs -t xfs -t ext4 -n /dev/sdb",
    "wipefs -O offset /dev/sda",
    "wipefs --no-act /dev/sda",
    "wipefs -n /dev/sda",
    "sgdisk -pd /dev/sda",
    "sgdisk -p /dev/sda",
  ])("keeps a dry run or listing allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});
