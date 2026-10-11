import {
  afterEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyPlannedWrites } from "../src/cli/init-apply.ts";
import { planFileChange } from "../src/cli/init-config-files.ts";
import { writeBackup, writeEntry } from "../src/cli/init-config-write.ts";
import type { PackageInfo, PluginEntry } from "../src/cli/init-types.ts";

const pkg: PackageInfo = {
  name: "test-plugin",
  version: "9.9.9",
  engines: {},
  root: "/nonexistent-plugin-root",
};
const entry: PluginEntry = "test-plugin@^9.9.9";
const BACKUP = /\.bak-\d{8}-\d{6}$/;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDir(): string {
  dir = mkdtempSync(join(tmpdir(), "init-files-"));
  return dir;
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("planFileChange", () => {
  test("a config without the host's plugin key plans an append with a backup and fingerprint", () => {
    const path = join(freshDir(), "opencode.json");
    writeFileSync(path, '{"plugins":[]}');
    const plan = planFileChange(path, pkg, "v1");
    expect(plan.action).toBe("append");
    expect(plan.backup).toMatch(BACKUP);
    expect(plan.backup).toStartWith(`${path}.bak-`);
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(plan)).toEqual([
      "path",
      "action",
      "backup",
      "fingerprint",
    ]);
  });

  test("a non-array plugin key is an error, keyed by host", () => {
    const path = join(freshDir(), "opencode.json");
    writeFileSync(path, '{"plugin":{},"plugins":[]}');
    expect(planFileChange(path, pkg, "v1")).toEqual({ path, action: "error" });
    writeFileSync(path, '{"plugin":[],"plugins":"x"}');
    expect(planFileChange(path, pkg, "v2")).toEqual({ path, action: "error" });
  });

  test("entries that are not ours, including non-string heads, plan an append", () => {
    const path = join(freshDir(), "opencode.json");
    writeFileSync(
      path,
      JSON.stringify({ plugin: [1, null, [2], "other@1.0.0", { package: 3 }] }),
    );
    expect(planFileChange(path, pkg, "v1").action).toBe("append");
  });

  test("an entry naming the package root, the bare name or the exact version is already ours", () => {
    const path = join(freshDir(), "opencode.json");
    [[pkg.root], [pkg.name], [[pkg.name, {}]], [`${pkg.name}@9.9.9`]].forEach(
      (plugin) => {
        writeFileSync(path, JSON.stringify({ plugin }));
        expect(planFileChange(path, pkg, "v1")).toEqual({
          path,
          action: "noop",
        });
      },
    );
    writeFileSync(path, JSON.stringify({ plugins: [{ package: pkg.name }] }));
    expect(planFileChange(path, pkg, "v2")).toEqual({ path, action: "noop" });
  });

  test("an npm spec other than name@<exact version>, including the caret spec init --npm writes, plans as error (base behaviour)", () => {
    const path = join(freshDir(), "opencode.json");
    [`${pkg.name}@1.0.0`, `${pkg.name}@^9.9.9`].forEach((spec) => {
      writeFileSync(path, JSON.stringify({ plugin: [spec] }));
      expect(planFileChange(path, pkg, "v1").action).toBe("error");
      writeFileSync(path, JSON.stringify({ plugins: [{ package: spec }] }));
      expect(planFileChange(path, pkg, "v2").action).toBe("error");
    });
  });

  test("relative and file: URL entries resolving to the package root are already ours", () => {
    const directory = freshDir();
    const root = join(directory, "plugin-root");
    mkdirSync(root);
    symlinkSync(root, join(directory, "link"));
    const local = { ...pkg, root };
    const path = join(directory, "opencode.json");
    ["./link", pathToFileURL(root).href].forEach((head) => {
      writeFileSync(path, JSON.stringify({ plugin: [head] }));
      expect(planFileChange(path, local, "v1").action).toBe("noop");
    });
    writeFileSync(path, JSON.stringify({ plugin: ["./missing"] }));
    expect(planFileChange(path, local, "v1").action).toBe("append");
  });
});

describe("applyPlannedWrites", () => {
  test("an append prints the backup, writes the merged config and reports the rollback", () => {
    const directory = freshDir();
    const path = join(directory, "opencode.json");
    const original = '{"plugin":["other@1.0.0"]}';
    writeFileSync(path, original);
    const plan = planFileChange(path, pkg);
    const stderr = captureStderr();
    let code: number;
    try {
      code = applyPlannedWrites([plan], entry, pkg);
    } finally {
      stderr.restore();
    }
    expect(code).toBe(0);
    const backups = readdirSync(directory).filter((f) => f.includes(".bak-"));
    expect(backups).toHaveLength(1);
    const backup = join(directory, String(backups[0]));
    expect(readFileSync(backup, "utf8")).toBe(original);
    expect(stderr.lines).toEqual([
      `  backup: ${backup}`,
      "init: done",
      "next: restart OpenCode to load the plugin",
      'next: ensure at least one permission "ask" rule (e.g. bash), or the plugin is a no-op',
      "rollback: restore from the .bak file above and restart OpenCode",
    ]);
    expect(JSON.parse(readFileSync(path, "utf8")).plugin).toEqual([
      "other@1.0.0",
      entry,
    ]);
  });

  test("noop plans are skipped and a create reports no rollback", () => {
    const directory = freshDir();
    const ours = join(directory, "opencode.json");
    writeFileSync(ours, JSON.stringify({ plugin: [pkg.name] }));
    const tui = join(directory, "tui.json");
    const plans = [planFileChange(ours, pkg), planFileChange(tui, pkg)];
    const stderr = captureStderr();
    try {
      expect(applyPlannedWrites(plans, entry, pkg)).toBe(0);
    } finally {
      stderr.restore();
    }
    expect(stderr.lines).toEqual([
      "init: done",
      "next: restart OpenCode to load the plugin",
      'next: ensure at least one permission "ask" rule (e.g. bash), or the plugin is a no-op',
    ]);
    expect(JSON.parse(readFileSync(tui, "utf8")).plugin).toEqual([entry]);
  });

  test("an error plan refuses with the malformed message", () => {
    const path = join(freshDir(), "opencode.json");
    writeFileSync(path, '{ "plugin": [');
    const stderr = captureStderr();
    try {
      expect(applyPlannedWrites([planFileChange(path, pkg)], entry, pkg)).toBe(
        1,
      );
    } finally {
      stderr.restore();
    }
    expect(stderr.lines).toEqual([
      `init: ${path} is malformed or has a non-array "plugin" key; refusing to write`,
    ]);
  });

  test("a plan whose file changed since planning names both actions", () => {
    const path = join(freshDir(), "opencode.json");
    const stale = planFileChange(path, pkg);
    writeFileSync(path, "{}");
    const stderr = captureStderr();
    try {
      expect(applyPlannedWrites([stale], entry, pkg)).toBe(1);
    } finally {
      stderr.restore();
    }
    expect(stderr.lines).toEqual([
      `init: ${path} changed since planning (was create, now append); refusing to write`,
    ]);
  });

  test("an append whose content changed with the same action is refused by fingerprint", () => {
    const directory = freshDir();
    const path = join(directory, "opencode.json");
    writeFileSync(path, '{"plugin":[]}');
    const stale = planFileChange(path, pkg);
    writeFileSync(path, '{"plugin":["other"]}');
    const stderr = captureStderr();
    try {
      expect(applyPlannedWrites([stale], entry, pkg)).toBe(1);
    } finally {
      stderr.restore();
    }
    expect(stderr.lines).toEqual([
      `init: ${path} changed since planning (was append, now append); refusing to write`,
    ]);
    expect(readdirSync(directory).filter((f) => f.includes(".bak-"))).toEqual(
      [],
    );
  });

  test("a create that loses the exclusive-create race refuses to overwrite", () => {
    const path = join(freshDir(), "opencode.json");
    const plan = planFileChange(path, pkg);
    const write = spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    });
    const stderr = captureStderr();
    try {
      expect(applyPlannedWrites([plan], entry, pkg)).toBe(1);
    } finally {
      stderr.restore();
      write.mockRestore();
    }
    expect(stderr.lines).toEqual([
      `init: ${path} was created concurrently; refusing to overwrite`,
    ]);
  });

  test("a write failure other than EEXIST propagates", () => {
    const directory = freshDir();
    const locked = join(directory, "locked");
    mkdirSync(locked);
    const path = join(locked, "opencode.json");
    const plan = planFileChange(path, pkg);
    expect(plan.action).toBe("create");
    chmodSync(locked, 0o500);
    try {
      expect(() => applyPlannedWrites([plan], entry, pkg)).toThrow(
        expect.objectContaining({ code: "EACCES" }),
      );
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});

describe("writeEntry", () => {
  test("appends to an existing array, keeping comments and trailing commas", () => {
    const path = join(freshDir(), "opencode.json");
    writeFileSync(
      path,
      '{\n  // keep\n  "plugin": ["other@1.0.0"],\n  "permission": {"bash": "ask"},\n}\n',
    );
    writeEntry(path, "e@^1", false, "v1");
    expect(readFileSync(path, "utf8")).toBe(
      '{\n  // keep\n  "plugin": [\n    "other@1.0.0",\n    "e@^1"\n  ],\n  "permission": {"bash": "ask"},\n}\n',
    );
  });

  test("adds a missing key and treats a blank file as an empty object", () => {
    const directory = freshDir();
    const keyless = join(directory, "a.json");
    writeFileSync(keyless, '{"permission":{"bash":"ask"}}');
    writeEntry(keyless, "e@^1", false, "v1");
    expect(readFileSync(keyless, "utf8")).toBe(
      '{\n  "permission": {\n    "bash": "ask"\n  },\n  "plugin": [\n    "e@^1"\n  ]\n}',
    );
    const blank = join(directory, "b.json");
    writeFileSync(blank, "  \n");
    writeEntry(blank, { package: "/r", options: {} }, false, "v2");
    expect(readFileSync(blank, "utf8")).toBe(
      '{\n  "plugins": [\n    {\n      "package": "/r",\n      "options": {}\n    }\n  ]\n}',
    );
  });

  test("refuses a fingerprint mismatch and an invalid plugin key with their messages", () => {
    const path = join(freshDir(), "opencode.json");
    writeFileSync(path, '{"plugin":[]}');
    expect(() => writeEntry(path, entry, false, "v1", "0".repeat(64))).toThrow(
      "Config changed after planning; refusing to overwrite",
    );
    writeFileSync(path, '{"plugin":{}}');
    expect(() => writeEntry(path, entry, false, "v1")).toThrow(
      "Invalid plugin config",
    );
    writeFileSync(path, "[]");
    expect(() => writeEntry(path, entry, false, "v1")).toThrow(
      "Invalid plugin config",
    );
    expect(readFileSync(path, "utf8")).toBe("[]");
  });

  test("refuses a FIFO in place of the config", () => {
    const path = join(freshDir(), "opencode.json");
    execFileSync("mkfifo", [path]);
    expect(() => writeEntry(path, entry, false, "v1")).toThrow(
      "Config is not a regular file",
    );
  });

  test("creates files with the schema their name selects", () => {
    const directory = freshDir();
    const cases: [string, "v1" | "v2", string][] = [
      [
        "opencode.json",
        "v1",
        '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [\n    "e"\n  ]\n}\n',
      ],
      [
        "tui.json",
        "v1",
        '{\n  "$schema": "https://opencode.ai/tui.json",\n  "plugin": [\n    "e"\n  ]\n}\n',
      ],
      [
        join("nested", "tui.jsonc"),
        "v1",
        '{\n  "$schema": "https://opencode.ai/tui.json",\n  "plugin": [\n    "e"\n  ]\n}\n',
      ],
      ["cli.json", "v2", '{\n  "plugins": [\n    "e"\n  ]\n}\n'],
      [
        "opencode.jsonc",
        "v2",
        '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": [\n    "e"\n  ]\n}\n',
      ],
    ];
    cases.forEach(([name, host, expected]) => {
      const path = join(directory, name);
      writeEntry(path, "e", true, host);
      expect(readFileSync(path, "utf8")).toBe(expected);
    });
  });
});

describe("backups", () => {
  test("planned backup names carry a local timestamp and gain a numeric suffix when taken", () => {
    const path = join(freshDir(), "opencode.json");
    writeFileSync(path, "{}");
    setSystemTime(new Date(2026, 0, 2, 3, 4, 5));
    try {
      const stamped = `${path}.bak-20260102-030405`;
      expect(planFileChange(path, pkg).backup).toBe(stamped);
      writeFileSync(stamped, "taken");
      expect(planFileChange(path, pkg).backup).toBe(`${stamped}-2`);
      writeFileSync(`${stamped}-2`, "taken");
      expect(planFileChange(path, pkg).backup).toBe(`${stamped}-3`);
    } finally {
      setSystemTime();
    }
  });

  test("writeBackup refuses a source that is not a regular file", () => {
    const directory = freshDir();
    const source = join(directory, "opencode.json");
    mkdirSync(source);
    expect(() => writeBackup(source, join(directory, "b"))).toThrow(
      `Config is not a regular file: ${source}`,
    );
  });
});
