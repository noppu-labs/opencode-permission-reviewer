// Contained git subprocess runner: inspection environment and the hardened `git` invocation.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export function gitInspectionEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    // Skip the system gitconfig too: it can define filters just like the
    // repository-local config can.
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

export async function runGit(
  directory: string,
  args: string[],
  neutralization: string[] = [],
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  try {
    const result = await execFileAsync(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...neutralization,
        ...args,
      ],
      {
        cwd: directory,
        timeout: 2_000,
        maxBuffer: 512 * 1024,
        encoding: "utf8",
        env: gitInspectionEnv(),
      },
    );
    return { ok: true, stdout: result.stdout };
  } catch (error) {
    const record = error as {
      code?: unknown;
      signal?: unknown;
      stderr?: unknown;
      message?: unknown;
    };
    const reason =
      typeof record.stderr === "string" && record.stderr.trim()
        ? record.stderr.trim()
        : typeof record.message === "string"
          ? record.message
          : String(error);
    return { ok: false, reason: reason.slice(0, 1_000) };
  }
}
