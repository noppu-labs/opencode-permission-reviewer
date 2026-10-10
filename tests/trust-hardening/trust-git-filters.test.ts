import { afterEach, describe, expect, test } from "bun:test";
import type { PromiseWithChild } from "node:child_process";
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setGlobalConfigPathForTests } from "../../src/config/loader.ts";
import { enrichGitEvidence } from "../../src/git-evidence.ts";
import {
  collectConversionKeys,
  conversionNeutralizationArgs,
} from "../../src/git-filter-neutralization.ts";
import { bashRequest, execFileAsync, tempDir } from "./trust-fixtures.ts";

type GitRun = PromiseWithChild<{ stdout: string; stderr: string }>;

async function initGitRepo(
  directory: string,
): Promise<(args: string[]) => GitRun> {
  const run = (args: string[]): GitRun =>
    execFileAsync("git", args, { cwd: directory });
  await run(["init", "-b", "staging"]);
  await run(["config", "user.email", "reviewer@example.invalid"]);
  await run(["config", "user.name", "Reviewer Test"]);
  return run;
}

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

// --- git evidence filter neutralization -------------------------------------------

describe("trust hardening — git evidence does not execute repository filters", () => {
  test("a configured clean filter never runs during evidence collection", async () => {
    const directory = tempDir("reviewer-gitfilter-");
    try {
      const run = await initGitRepo(directory);
      // Filter writes a marker file when executed.
      await run(["config", "filter.pwn.clean", "touch filter-ran-marker; cat"]);
      writeFileSync(join(directory, ".gitattributes"), "* filter=pwn\n");
      writeFileSync(join(directory, "data.txt"), "AAAA\n");
      await run(["add", "data.txt"]);
      await run(["commit", "-m", "fixture"]);
      // Same-size modification forces content comparison during status/diff.
      writeFileSync(join(directory, "data.txt"), "BBBB\n");
      const marker = join(directory, "filter-ran-marker");
      // The fixture's own `git add` runs the clean filter once; clear the
      // marker so only evidence collection could have recreated it.
      rmSync(marker, { force: true });
      const command = "git add data.txt && git commit -m bounded";
      const result = await enrichGitEvidence(
        bashRequest(command),
        directory,
        24_000,
      );
      expect(result.text).toContain("GIT_STATE_ANALYSIS");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true });
    }
  }, 20_000);
});

// --- git filter neutralization: dotted names, limits, no cross-time cache --------------

describe("trust hardening — git conversion-filter neutralization edge cases", () => {
  async function initRepoWithFilter(
    directory: string,
    key: string,
    value: string,
    marker: string,
  ): Promise<void> {
    const run = await initGitRepo(directory);
    await run(["config", key, value]);
    writeFileSync(join(directory, ".gitattributes"), "* filter=pwn\n");
    writeFileSync(join(directory, "data.txt"), "AAAA\n");
    await run(["add", "data.txt"]);
    await run(["commit", "-m", "fixture"]);
    writeFileSync(join(directory, "data.txt"), "BBBB\n");
    rmSync(marker, { force: true });
  }

  test("a filter name containing dots is neutralized too", async () => {
    const directory = tempDir("reviewer-gitfilter-dotted-");
    try {
      const marker = join(directory, "filter-ran-marker");
      await initRepoWithFilter(
        directory,
        "filter.audit.demo.clean",
        `touch ${marker}; cat`,
        marker,
      );
      const result = await enrichGitEvidence(
        bashRequest("git add data.txt && git commit -m bounded"),
        directory,
        24_000,
      );
      expect(result.text).toContain("GIT_STATE_ANALYSIS");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true });
    }
  }, 20_000);

  test("more conversion filters than the neutralization limit refuses the inspection", async () => {
    const directory = tempDir("reviewer-gitfilter-many-");
    try {
      const run = await initGitRepo(directory);
      for (let i = 0; i < 55; i += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: 55 git config writes to the same repo, serialized by git's .git/config lock
        await run(["config", `filter.filler${i}.clean`, "cat"]);
      }
      writeFileSync(join(directory, "data.txt"), "BBBB\n");
      const result = await enrichGitEvidence(
        bashRequest("git add data.txt && git commit -m bounded"),
        directory,
        24_000,
      );
      // Fail closed: over-limit config cannot be proven neutralized, so no
      // snapshot is taken and the reason says so.
      expect(result.text).toContain("unavailable");
      expect(result.text).toContain("refusing to inspect");
    } finally {
      rmSync(directory, { recursive: true });
    }
  }, 20_000);

  test("a filter configured AFTER a previous inspection is not trusted from any earlier scan", async () => {
    const directory = tempDir("reviewer-gitfilter-fresh-");
    try {
      const marker = join(directory, "filter-ran-marker");
      await initRepoWithFilter(
        directory,
        "filter.pwn.clean",
        "touch never; cat",
        marker,
      );
      // First inspection with a benign filter; then the repo swaps in an
      // executing filter. There is no TTL cache to lean on, so the second
      // inspection must re-scan and neutralize the new filter.
      await enrichGitEvidence(
        bashRequest("git add data.txt && git commit -m one"),
        directory,
        24_000,
      );
      await execFileAsync(
        "git",
        ["config", "filter.pwn.clean", `touch ${marker}; cat`],
        {
          cwd: directory,
        },
      );
      rmSync(marker, { force: true });
      const result = await enrichGitEvidence(
        bashRequest("git add data.txt && git commit -m two"),
        directory,
        24_000,
      );
      expect(result.text).toContain("GIT_STATE_ANALYSIS");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true });
    }
  }, 30_000);
});

// --- git filter neutralization: names with spaces or equals ------------------------

describe("trust hardening — git conversion-filter names with spaces or equals", () => {
  test("a filter name containing a space is parsed and neutralized", () => {
    // NUL-delimited scan output for `[filter "a b"]` plus a spaced diff driver.
    const stdout = "filter.a b.clean\ncat\0diff.my driver.textconv\ncat\0";
    const { filterNames, diffDrivers } = collectConversionKeys(stdout);
    expect([...filterNames]).toEqual(["a b"]);
    expect([...diffDrivers]).toEqual(["my driver"]);
    const args = conversionNeutralizationArgs(filterNames, diffDrivers);
    expect(args).toContain("filter.a b.clean=cat");
    expect(args).toContain("filter.a b.smudge=cat");
    expect(args).toContain("diff.my driver.textconv=");
  });

  test("a plain filter name still neutralizes exactly as before", () => {
    const { filterNames, diffDrivers } = collectConversionKeys(
      "filter.lfs.clean\ncat\0",
    );
    expect([...filterNames]).toEqual(["lfs"]);
    expect(diffDrivers.size).toBe(0);
    expect(conversionNeutralizationArgs(filterNames, diffDrivers)).toEqual([
      "-c",
      "filter.lfs.clean=cat",
      "-c",
      "filter.lfs.smudge=cat",
      "-c",
      "filter.lfs.process=",
      "-c",
      "filter.lfs.required=false",
    ]);
  });

  test("a filter name containing = cannot be overridden, so building args throws", () => {
    const { filterNames } = collectConversionKeys("filter.x=y.clean\ncat\0");
    expect([...filterNames]).toEqual(["x=y"]);
    expect(() => conversionNeutralizationArgs(filterNames, new Set())).toThrow(
      "refusing to inspect",
    );
  });

  test("a repo with a spaced filter subsection still produces a snapshot", async () => {
    const directory = tempDir("reviewer-gitfilter-space-");
    try {
      const run = await initGitRepo(directory);
      await run(["config", "filter.a b.clean", "cat"]);
      writeFileSync(join(directory, "data.txt"), "BBBB\n");
      const result = await enrichGitEvidence(
        bashRequest("git add data.txt && git commit -m bounded"),
        directory,
        24_000,
      );
      expect(result.text).toContain("GIT_STATE_ANALYSIS");
      expect(result.text).not.toContain("unavailable");
    } finally {
      rmSync(directory, { recursive: true });
    }
  }, 20_000);

  test("a repo with an equals filter subsection withholds the snapshot", async () => {
    const directory = tempDir("reviewer-gitfilter-equals-");
    try {
      await initGitRepo(directory);
      appendFileSync(
        join(directory, ".git", "config"),
        '[filter "x=y"]\n\tclean = cat\n',
      );
      writeFileSync(join(directory, "data.txt"), "BBBB\n");
      const result = await enrichGitEvidence(
        bashRequest("git add data.txt && git commit -m bounded"),
        directory,
        24_000,
      );
      // Fail closed: the name cannot be neutralized via -c overrides, so no
      // snapshot is taken and the reason says so.
      expect(result.text).toContain("unavailable");
      expect(result.text).toContain("refusing to inspect");
    } finally {
      rmSync(directory, { recursive: true });
    }
  }, 20_000);
});
