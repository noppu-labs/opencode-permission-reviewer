// Shared fixtures for the remote-target tests: a real temporary repository and a minimal plan.

import { afterAll, beforeAll } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PlannedGitActions } from "../src/git-command-plan.ts";

const exec = promisify(execFile);
const directories: string[] = [];

export async function git(directory: string, ...args: string[]): Promise<void> {
  await exec("git", args, {
    cwd: directory,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
}

/** Run this file's real-git tests against an empty global config, so a developer's
 *  insteadOf, pushDefault or gpgsign settings cannot change the asserted output. */
export function isolateGlobalGitConfig(): void {
  const saved = process.env.GIT_CONFIG_GLOBAL;
  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  });
}

export async function repository(commit = true): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "reviewer-git-remotes-")),
  );
  directories.push(directory);
  await git(directory, "init", "-b", "main");
  if (commit) {
    await git(directory, "config", "user.name", "Fixture");
    await git(directory, "config", "user.email", "fixture@example.invalid");
    await git(directory, "commit", "--allow-empty", "-m", "fixture");
  }
  return directory;
}

export function planned(
  remoteCandidates: string[],
  needsDefaultRemote: string[] = [],
): PlannedGitActions {
  return {
    relevant: true,
    commit: false,
    plannedAdd: [],
    discardTargets: [],
    removeTargets: [],
    commands: [],
    rewriteBases: [],
    remoteCandidates,
    needsDefaultRemote,
  };
}

export async function removeRepositories(): Promise<void> {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
