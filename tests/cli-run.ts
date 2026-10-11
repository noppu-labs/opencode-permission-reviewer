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

export interface CliSandbox {
  tmp: string;
  home: string;
  project: string;
}

export function makeSandbox(): CliSandbox {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "cli-output-")));
  const box = { tmp, home: join(tmp, "home"), project: join(tmp, "proj") };
  mkdirSync(box.home);
  mkdirSync(box.project);
  return box;
}

export function removeSandbox(box: CliSandbox): void {
  rmSync(box.tmp, { recursive: true, force: true });
}

export async function spawnCli(
  box: CliSandbox,
  args: string[],
  options: { stdin?: string; env?: Record<string, string> } = {},
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
