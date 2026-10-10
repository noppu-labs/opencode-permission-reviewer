import { afterAll, expect, test } from "bun:test";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { filterNeutralizationArgs } from "../src/git-filter-neutralization.ts";
import {
  git,
  isolateGlobalGitConfig,
  removeRepositories,
  repository,
} from "./git-remote-fixtures.ts";

// The scan reads the global git config too, so a developer's own filters or
// textconv drivers would leak into the exact args asserted below.
isolateGlobalGitConfig();
afterAll(removeRepositories);

test("concurrent scans of one directory share a promise that is dropped once it settles", async () => {
  const directory = await repository(false);
  await git(directory, "config", "filter.lfs.clean", "git-lfs clean");
  const first = filterNeutralizationArgs(directory);
  expect(filterNeutralizationArgs(directory)).toBe(first);
  const args = await first;
  expect(args).toEqual([
    "-c",
    "filter.lfs.clean=cat",
    "-c",
    "filter.lfs.smudge=cat",
    "-c",
    "filter.lfs.process=",
    "-c",
    "filter.lfs.required=false",
  ]);
  const second = filterNeutralizationArgs(directory);
  expect(second).not.toBe(first);
  expect(await second).toEqual(args);
}, 30_000);

test("a rejected scan is dropped too, so the next call scans the current config again", async () => {
  const directory = await repository(false);
  const config = join(directory, ".git", "config");
  const clean = await Bun.file(config).text();
  const baseline = await filterNeutralizationArgs(directory);
  await appendFile(config, '[filter "x=y"]\n\tclean = cat\n');
  const rejected = filterNeutralizationArgs(directory);
  expect(filterNeutralizationArgs(directory)).toBe(rejected);
  await expect(rejected).rejects.toThrow(
    'repository configures conversion filter "x=y" which cannot be neutralized with a config override; refusing to inspect',
  );
  await writeFile(config, clean);
  expect(await filterNeutralizationArgs(directory)).toEqual(baseline);
}, 30_000);
