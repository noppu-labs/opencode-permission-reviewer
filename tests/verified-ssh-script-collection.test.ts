import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectVerifiedSshScript } from "../src/verified-script-evidence.ts";
import {
  ScriptAnalysisRegistry,
  VERIFIED_SCRIPT_LIMIT,
  type VerifiedScriptEvidence,
} from "../src/verified-ssh-script.ts";
import { POSTGRES_URL_WITH_PASSWORD } from "./fixtures/synthetic-secrets.ts";

let directory = "";

beforeAll(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "approval-reviewer-verified-collect-")),
  );
});

afterAll(async () => {
  await rm(directory, { recursive: true });
});

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const CONTENT = "echo safe\n";
const HASH = digest(CONTENT);

async function script(name: string, content: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

function collect(
  path: string,
  sha256: string,
  registry = new ScriptAnalysisRegistry(),
): Promise<VerifiedScriptEvidence> {
  return collectVerifiedSshScript(
    { path, destination: "host.invalid", port: 2222, sha256, shell: "sh" },
    directory,
    directory,
    "scope",
    "config",
    registry,
  );
}

function unavailable(reason: string, sha256: string): VerifiedScriptEvidence {
  return {
    sha256,
    destination: "host.invalid",
    port: 2222,
    shell: "sh",
    status: "unavailable",
    text: `VERIFIED_SSH_SCRIPT\nstatus: unavailable\nreason: ${reason}\nExpected SHA-256: ${sha256}`,
  };
}

const CACHE_KEY = JSON.stringify([
  "scope",
  HASH,
  "host.invalid",
  2222,
  "sh",
  "config",
]);

describe("verified ssh script collection", () => {
  test("a missing file reports its status", async () => {
    const sha256 = digest("");
    expect(await collect(join(directory, "missing.sh"), sha256)).toStrictEqual(
      unavailable("unavailable", sha256),
    );
  });

  test.each([
    ["oversized.sh", "x".repeat(VERIFIED_SCRIPT_LIMIT + 1), "truncated"],
    ["binary.sh", "\u0000\u0001", "blocked"],
    ["redacted.sh", `${POSTGRES_URL_WITH_PASSWORD}\n`, "sensitive content"],
    ["mismatch.sh", "echo changed\n", "script hash mismatch"],
  ])("%s reports reason %p", async (name, content, reason) => {
    const path = await script(name, content);
    const expected = name === "mismatch.sh" ? HASH : digest(content);
    expect(await collect(path, expected)).toStrictEqual(
      unavailable(reason, expected),
    );
  });

  test("a matching file carries its port and size", async () => {
    const result = await collect(await script("full.sh", CONTENT), HASH);
    expect(result).toStrictEqual({
      sha256: HASH,
      destination: "host.invalid",
      port: 2222,
      shell: "sh",
      bytes: CONTENT.length,
      status: "full",
      cacheKey: CACHE_KEY,
      text: `VERIFIED_SSH_SCRIPT\nstatus: full content\nSHA-256: ${HASH}\nDestination: host.invalid\nInterpreter: sh\nUntrusted script content follows:\n${CONTENT}\nEND_VERIFIED_SSH_SCRIPT`,
    });
    expect(Object.keys(result)).toEqual([
      "sha256",
      "destination",
      "port",
      "shell",
      "bytes",
      "status",
      "cacheKey",
      "text",
    ]);
  });

  test("a remembered analysis is reused without the content", async () => {
    const registry = new ScriptAnalysisRegistry();
    registry.remember(CACHE_KEY, "Prints a fixed word and changes nothing.");
    const path = await script("reused.sh", CONTENT);
    expect(await collect(path, HASH, registry)).toStrictEqual({
      sha256: HASH,
      destination: "host.invalid",
      port: 2222,
      shell: "sh",
      bytes: CONTENT.length,
      status: "reused",
      cacheKey: CACHE_KEY,
      text: `VERIFIED_SSH_SCRIPT\nstatus: previously inspected\nSHA-256: ${HASH}\nDestination: host.invalid\nInterpreter: sh\nPrior model-generated script analysis (not authorization): Prints a fixed word and changes nothing.`,
    });
  });
});
