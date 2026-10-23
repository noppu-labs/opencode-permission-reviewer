import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/modules/config/controllers/init.ts";

// The confirmation prompt only runs on a TTY, which a spawned CLI never has,
// so these cases drive runInit in-process with a TTY stdin and a fake answer.
let dir: string;
let project: string;
let restore: (() => void)[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "init-confirm-"));
  project = join(dir, "proj");
  mkdirSync(project);
  const xdg = process.env.XDG_CONFIG_HOME;
  const tty = process.stdin.isTTY;
  process.env.XDG_CONFIG_HOME = join(dir, "xdg");
  process.stdin.isTTY = true;
  restore = [
    (): void => {
      process.stdin.isTTY = tty;
      process.env.XDG_CONFIG_HOME = xdg;
      if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    },
  ];
});

afterEach(() => {
  restore.forEach((undo) => {
    undo();
  });
  rmSync(dir, { recursive: true, force: true });
});

function answer(text: string): { prompts: unknown[]; errors: string[] } {
  const prompts: unknown[] = [];
  const errors: string[] = [];
  const stdin = spyOn(Bun.stdin, "text").mockResolvedValue(text);
  const write = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    prompts.push(chunk);
    return true;
  });
  const error = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.join(" "));
  });
  restore.push(
    (): void => stdin.mockRestore(),
    (): void => write.mockRestore(),
    (): void => error.mockRestore(),
  );
  return { prompts, errors };
}

const args = (): string[] => [
  "--host",
  "v1",
  "--binary",
  "/missing/opencode",
  "--project",
  project,
];

test("a TTY answer other than y or yes aborts without writing", async () => {
  const { prompts, errors } = answer(" no \n");
  expect(await runInit(args())).toBe(0);
  expect(prompts).toEqual(["Apply these changes? [y/N] "]);
  expect(errors.at(-2)).toBe(`  ${join(project, "opencode.json")}: create`);
  expect(errors.at(-1)).toBe("init: aborted, nothing changed");
  expect(existsSync(join(project, "opencode.json"))).toBe(false);
});

test("a TTY answer of yes, in any case and padding, applies the plan", async () => {
  const { prompts, errors } = answer("  YeS \n");
  expect(await runInit(args())).toBe(0);
  expect(prompts).toEqual(["Apply these changes? [y/N] "]);
  expect(errors.at(-3)).toBe("init: done");
  expect(
    JSON.parse(readFileSync(join(project, "opencode.json"), "utf8")).plugin,
  ).toHaveLength(1);
});

test("a TTY answer of y applies the plan", async () => {
  answer("y");
  expect(await runInit(args())).toBe(0);
  expect(existsSync(join(project, "opencode.json"))).toBe(true);
});

test("--help writes the usage to stderr and exits 0", async () => {
  const { prompts } = answer("");
  expect(await runInit(["--help"])).toBe(0);
  expect(prompts).toHaveLength(1);
  expect(String(prompts[0])).toStartWith(
    "Usage:\n  opencode-permission-reviewer init [--project <dir>] [--global] [--tui]\n",
  );
  expect(String(prompts[0])).toEndWith(
    "  --json            print planned changes as JSON without writing files\n",
  );
});
