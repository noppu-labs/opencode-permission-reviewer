import { afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichPackageScriptEvidence } from "../src/package-script-evidence.ts";
import { request } from "./helpers.ts";

export const COVERAGE =
  "manifest definitions and literal local calls only; imported code and runtime configuration may add effects";
export const PREFIX = "PACKAGE_SCRIPT_ANALYSIS\n";

const directories: string[] = [];

/** A temporary directory holding `manifest` verbatim as its package.json. */
export async function manifestFixture(manifest: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "package-script-branches-"));
  directories.push(directory);
  await writeFile(join(directory, "package.json"), manifest);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

export async function packageEvidence(
  directory: string,
  command: string,
  maxChars = 24000,
): Promise<string> {
  return (
    await enrichPackageScriptEvidence(
      request({ patterns: [command], metadata: { command } }),
      directory,
      directory,
      maxChars,
    )
  ).text;
}

export type RecordFields = Record<string, unknown>;

/** The text enrichPackageScriptEvidence returns for these records. */
export function expectedText(
  records: RecordFields[],
  status = "partial",
): string {
  return `${PREFIX}${JSON.stringify({ coverage: COVERAGE, status, records }, null, 2)}`;
}

/** The leading fields of a record for a top-level npm script call. */
export function requested(script: string): RecordFields {
  return { manager: "npm", script, arguments: [], phase: "requested" };
}
