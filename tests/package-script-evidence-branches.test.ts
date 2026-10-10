import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  expectedText,
  manifestFixture,
  packageEvidence,
  type RecordFields,
  requested,
} from "./package-script-fixtures.ts";

const SCRIPTS = JSON.stringify({
  scripts: { check: "printf ok", "check.ts": "printf ts", num: 5 },
});
const NO_MANIFEST = "no manifest found in the bounded parent search";

function located(directory: string, script: string): RecordFields {
  return {
    ...requested(script),
    directory,
    manifest: join(directory, "package.json"),
  };
}

function undefinedScript(directory: string, script: string): RecordFields {
  return {
    ...located(directory, script),
    status: "unavailable",
    reason: "requested manifest script is not defined",
  };
}

function included(directory: string, command: string): string {
  return expectedText(
    [{ ...located(directory, "check"), command, status: "included" }],
    "included",
  );
}

test.each([
  "npm install",
  "npm",
  "npm run",
  "npm exec check",
  "npm run check.ts",
])("%p gathers nothing", async (command) => {
  const directory = await manifestFixture(SCRIPTS);
  expect(await packageEvidence(directory, command)).toBe("");
});

test("run-script expands like run", async () => {
  const directory = await manifestFixture(SCRIPTS);
  expect(await packageEvidence(directory, "npm run-script check")).toBe(
    included(directory, "printf ok"),
  );
});

test.each([
  [
    "npm --prefix sub run check",
    "runtime directory or workspace selection is not resolved",
  ],
  [
    "env --chdir=sub npm run check",
    "wrapped script working directory is unresolved",
  ],
  ['cd "$X" && npm run check', "script working directory is unresolved"],
])("%p is an unresolved record", async (command, reason) => {
  const directory = await manifestFixture(SCRIPTS);
  expect(await packageEvidence(directory, command)).toBe(
    expectedText([{ ...requested("check"), status: "unavailable", reason }]),
  );
});

test.each(["missing", "num"])("script %p is not defined", async (script) => {
  const directory = await manifestFixture(SCRIPTS);
  expect(await packageEvidence(directory, `npm run ${script}`)).toBe(
    expectedText([undefinedScript(directory, script)]),
  );
});

test.each([
  "null",
  "5",
  "{}",
  '{"scripts":"x"}',
  '{"scripts":null}',
  '{"scripts":[]}',
])("manifest %p is included but defines no script", async (manifest) => {
  const directory = await manifestFixture(manifest);
  expect(await packageEvidence(directory, "npm run check")).toBe(
    expectedText([undefinedScript(directory, "check")]),
  );
});

test("the manifest search checks the working directory and seven parents", async () => {
  const directory = await manifestFixture(
    JSON.stringify({ scripts: { check: "printf deep" } }),
  );
  const deep = join(directory, "a/b/c/d/e/f/g/h");
  await mkdir(deep, { recursive: true });
  expect(
    await packageEvidence(directory, "cd a/b/c/d/e/f/g && npm run check"),
  ).toBe(included(directory, "printf deep"));
  expect(
    await packageEvidence(directory, "cd a/b/c/d/e/f/g/h && npm run check"),
  ).toBe(
    expectedText([
      { ...located(deep, "check"), status: "unavailable", reason: NO_MANIFEST },
    ]),
  );
});

// Starting at "/" is the only way to reach the root arm before the depth bound;
// a host with a root manifest would legitimately find it.
test.skipIf(existsSync("/package.json"))(
  "the manifest search stops at the filesystem root",
  async () => {
    expect(await packageEvidence("/", "npm run check")).toBe(
      expectedText([
        {
          ...located("/", "check"),
          status: "unavailable",
          reason: NO_MANIFEST,
        },
      ]),
    );
  },
);
