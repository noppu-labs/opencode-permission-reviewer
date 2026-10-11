// Spawns the CLI entry in a throwaway HOME and project, with the host's config
// variables removed, and normalises the paths and versions that vary per run.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = realpathSync(join(import.meta.dir, ".."));
export const PKG = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as {
  name: string;
  version: string;
  engines: { bun: string; opencode: string };
};

interface CliSandbox {
  tmp: string;
  home: string;
  project: string;
}

type CliOptions = { stdin?: string; env?: Record<string, string> };

function makeSandbox(): CliSandbox {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "cli-output-")));
  const box = { tmp, home: join(tmp, "home"), project: join(tmp, "proj") };
  mkdirSync(box.home);
  mkdirSync(box.project);
  return box;
}

function removeSandbox(box: CliSandbox): void {
  rmSync(box.tmp, { recursive: true, force: true });
}

async function spawnCli(
  box: CliSandbox,
  args: string[],
  options: CliOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: box.home,
  };
  [
    "XDG_CONFIG_HOME",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_PASSWORD",
    "OPENCODE_SERVER_PASSWORD",
  ].forEach((key) => {
    delete env[key];
  });
  const proc = Bun.spawn({
    cmd: ["bun", "run", join(ROOT, "src/cli/explain.ts"), ...args],
    cwd: box.project,
    stdin:
      options.stdin === undefined
        ? "ignore"
        : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, ...options.env },
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const norm = (text: string): string =>
    text
      .split(box.tmp)
      .join("<TMP>")
      .split(ROOT)
      .join("<ROOT>")
      .replace(/\.bak-\d{8}-\d{6}/g, ".bak-<STAMP>")
      .replaceAll(`bun/${process.versions.bun}`, "bun/<BUN>");
  return { code, stdout: norm(stdout), stderr: norm(stderr) };
}

/** One sandbox per test file: call `fresh` in each test and pass `remove` to `afterEach`. */
export interface CliSession {
  fresh: () => CliSandbox;
  cli: (args: string[], options?: CliOptions) => ReturnType<typeof spawnCli>;
  remove: () => void;
}

export function cliSandbox(): CliSession {
  let box: CliSandbox | undefined;
  return {
    fresh: (): CliSandbox => {
      box = makeSandbox();
      return box;
    },
    cli: (
      args: string[],
      options?: CliOptions,
    ): ReturnType<typeof spawnCli> => {
      if (!box) throw new Error("expected CLI sandbox to be defined");
      return spawnCli(box, args, options);
    },
    remove: (): void => {
      if (box) removeSandbox(box);
      box = undefined;
    },
  };
}
