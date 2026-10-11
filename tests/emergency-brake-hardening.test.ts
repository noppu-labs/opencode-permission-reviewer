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
    "find / -exec rm -r {} \\; -print",
    "find / -exec rm {} -r \\;",
    "find / -exec rm {} \\; -exec rm -r {} +",
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
    "find / -type f -name '*.bak' -exec rm {} \\; -printf '%p\\n'",
    "find / -name '*.pyc' -exec rm {} \\; -print",
    "find / -name '*.pyc' -exec rm -v {} \\; -o -prune",
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
    "cp --backup src /dev/sda",
    "install --backup src /dev/sda",
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
    "cp src --sparse /dev/sda",
    "cp src --no-preserve /dev/sda",
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
    "mkfs.ntfs /dev/sdb",
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
    "mkfs.ntfs -n /dev/sdb",
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

describe("device option scans stop where the tool stops reading options", () => {
  test.each([
    "mkfs -t vfat -n -text4 /dev/sdb",
    "mkfs -t xfs -n size=8192 -L -text4 /dev/sdb",
    "mkfs -n -t xfs /dev/sdb",
    "mkfs -t ext4 -n -t xfs /dev/sdb",
  ])("blocks a device format or wipe, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeString();
  });

  test.each([
    "wipefs -Ooffset /dev/sda",
    "wipefs -Otype /dev/sda",
    "wipefs -fOoffset /dev/sda",
    "mkfs -n -t ext4 /dev/sdb",
    "mkfs -t ext4 -n -L -text4 /dev/sdb",
  ])("keeps a dry run or listing allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("output duplication onto a block device is a write whatever the descriptor digit", () => {
  test.each([
    "echo x 1>& /dev/sda",
    "echo x 1>&/dev/sda",
    "echo x 2>& /dev/sda",
    "sh -c 'echo x 1>& /dev/sda'",
    "bash -c 'echo x 3>& /dev/sdb'",
    "sudo sh -c 'echo x 1>& /dev/nvme0n1'",
  ])("blocks output duplication onto a block device, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeString();
  });

  test.each([
    "echo x 1>&2",
    "echo x 2>&1",
    "echo x 1>&-",
    "sh -c 'echo x 2>&1'",
    "echo x 1>& /dev/null",
    "echo x 1>& out.log",
  ])("keeps descriptor duplication allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("redirections of a segment are checked at every level, with or without a command", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "sh -c 'exec > /dev/sda'",
    "sh -c 'exec 3<> /dev/sda'",
    "bash -c 'exec >> /dev/sdb'",
    "sh -c 'exec &> /dev/sda'",
    "sudo sh -c 'exec > /dev/nvme0n1'",
    'sh -c "exec 1> /dev/sda; echo x"',
    "ssh host 'exec > /dev/sda'",
    "su -c 'exec > /dev/sda'",
    "env -S 'sh -c \"exec > /dev/sda\"'",
  ])("blocks a device redirection in a command string, case %#", (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });

  test.each([
    "exec >& /dev/sda",
    "exec 1>& /dev/sda",
    ">& /dev/sda",
    "exec >&/dev/sda",
    "exec 2>&/dev/sda",
    "exec >| /dev/sda",
    ">| /dev/sda",
  ])(
    "blocks a device redirection in a segment without a command, case %#",
    (command) => {
      expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
        blocked,
      );
    },
  );

  test.each([
    "sh -c 'exec > /tmp/log'",
    "sh -c 'exec 2> /dev/null'",
    "sh -c 'exec < /dev/sda'",
    "sh -c 'exec 3< /dev/sda'",
    "sh -c 'exec'",
  ])("keeps a harmless redirection allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("watch runs its command through a shell", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "watch 'rm -rf /'",
    'watch "rm -rf /*"',
    "watch -n 5 'rm -rf /'",
    "watch 'echo x > /dev/sda'",
    "watch rm -rf '/'",
    "sudo watch 'mkfs.ext4 /dev/sdb'",
    "watch 'true; rm -rf /'",
    "watch -s /tmp/shots 'rm -rf /'",
    "watch --int 5 'rm -rf /'",
    "watch -dn 'rm -rf /'",
    "watch '' 'rm -rf /'",
    "watch -n 5 rm -rf '/*'",
  ])("blocks destruction run through watch, case %#", (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });

  test.each([
    "watch 'ls -la'",
    "watch -n 5 'df -h'",
    "watch -x ls -la",
    "watch -x 'rm -rf /'",
    "watch --exec 'rm -rf /'",
    "watch 'echo rm -rf /'",
    "watch 'echo x > /dev/null'",
    "sudo watch 'lsblk'",
    "watch -s /tmp/shots 'ls -la'",
    "watch --int 5 'df -h'",
  ])("keeps a legitimate watch form allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("a blank command metadata is reviewed through the patterns", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each(["", "   "])(
    "a destructive pattern is blocked, case %#",
    (command) => {
      expect(
        emergencyBrakeReason(
          request({ metadata: { command }, patterns: ["rm -rf /"] }),
        ),
      ).toBe(blocked);
    },
  );

  test.each(["", "   "])(
    "harmless patterns stay allowed, case %#",
    (command) => {
      expect(
        emergencyBrakeReason(
          request({ metadata: { command }, patterns: ["ls -la", "echo ok"] }),
        ),
      ).toBeUndefined();
    },
  );
});

describe("find exec commands are read after their wrappers", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "find / -exec sudo rm -rf {} +",
    "find / -exec env rm -rf {} +",
    "find / -exec doas rm -rf {} +",
    "find / -exec nice rm -rf {} +",
    "find / -exec command rm -rf {} +",
    "find / -exec busybox rm -rf {} +",
    "find / -ok sudo rm -r {} \\;",
    "find / -exec sudo -u root rm -r {} \\;",
    "find / -execdir nice -n 5 rm -rf {} +",
  ])("blocks a recursive rm run on a root search, case %#", (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });

  test.each([
    "find /tmp -exec sudo rm -rf {} +",
    "find / -name '*.log' -exec sudo ls -l {} +",
    "find / -exec env grep x {} +",
    "find / -exec sudo rm {} \\;",
  ])("keeps a legitimate find exec command allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("a find exec rm is judged by the rm root rule", () => {
  const blocked =
    "Emergency brake: command contains unmistakable broad system destruction.";

  test.each([
    "find . -exec rm -rf /* \\;",
    "find /tmp -exec rm -r --no-preserve-root / \\;",
    "find . -exec rm -rf / \\;",
    "find . -name x -exec sudo rm -r /* +",
  ])("blocks an rm of a protected target, case %#", (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });

  test.each([
    "find . -exec rm -rf ./build \\;",
    "find . -exec rm -r / \\;",
    "find /tmp -exec rm -rf {} +",
    "find . -exec rm -rf '/*' \\;",
  ])("keeps a non-root rm allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("partition tools read their short options", () => {
  test.each([
    "sfdisk -W always /dev/sda",
    "sfdisk -w always /dev/sda",
    "sfdisk -Walways /dev/sda",
    "sfdisk -fW always /dev/sda",
    "sfdisk -N 1 -w always /dev/sda",
    "sudo sfdisk -w always /dev/sda",
  ])("blocks a partition table rewrite, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeString();
  });

  test.each([
    "sfdisk -l /dev/sda",
    "sfdisk -d /dev/sda",
    "sfdisk -Ow /dev/sda",
    "sfdisk -N1w /dev/sda",
    "sfdisk -w always disk.img",
  ])("keeps a listing or a non-device target allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});

describe("sgdisk clears the partition table with its clear option", () => {
  test.each([
    "sgdisk -o /dev/sda",
    "sgdisk --clear /dev/sda",
    "sgdisk -go /dev/sda",
    "sgdisk -og /dev/sda",
    "sudo sgdisk -o /dev/nvme0n1",
  ])("blocks a new empty partition table, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeString();
  });

  test.each([
    "sgdisk -p /dev/sda",
    "sgdisk --print /dev/sda",
    "sgdisk -O /dev/sda",
    "sgdisk -c1:boot /dev/sda",
    "sgdisk -o disk.img",
  ])("keeps a listing or a non-device target allowed, case %#", (command) => {
    expect(
      emergencyBrakeReason(request({ metadata: { command } })),
    ).toBeUndefined();
  });
});
