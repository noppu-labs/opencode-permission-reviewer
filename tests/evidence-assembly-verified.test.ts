import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import { REVIEWER_PROMPT_VERSION } from "../src/modules/context/services/prompt/policy.ts";
import type { EvidenceFragment } from "../src/modules/evidence/providers/provider.ts";
import { renderVerifiedSshScriptCommand } from "../src/modules/evidence/ssh/verified-ssh-command.ts";
import {
  configFingerprint,
  ScriptAnalysisRegistry,
} from "../src/modules/evidence/ssh/verified-ssh-script.ts";
import type { PermissionRequest } from "../src/types.ts";
import { CURRENT, PARENT } from "./evidence-assembly-fakes.ts";
import { assemble, delegatedSessions } from "./evidence-assembly-fixtures.ts";
import { request } from "./helpers.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

const FINGERPRINT = configFingerprint({
  config: DEFAULT_CONFIG,
  prompt: REVIEWER_PROMPT_VERSION,
});

interface Script {
  pending: PermissionRequest;
  root: { directory: string; worktree: string };
  /** The registry key the assembler should use for this script in `scope`. */
  key: (scope: string) => string;
}

async function script(port?: number): Promise<Script> {
  const directory = await mkdtemp(join(tmpdir(), "evidence-assembly-"));
  directories.push(directory);
  const path = join(directory, "deploy.sh");
  await writeFile(path, "echo ok\n");
  const parts = {
    path,
    destination: "deploy@host.invalid",
    ...(port === undefined ? {} : { port }),
    sha256: createHash("sha256").update("echo ok\n").digest("hex"),
    shell: "bash" as const,
  };
  const command = renderVerifiedSshScriptCommand(parts);
  return {
    pending: request({ metadata: { command }, patterns: [command] }),
    root: { directory, worktree: directory },
    key: (scope: string): string =>
      new ScriptAnalysisRegistry().key(scope, parts, FINGERPRINT),
  };
}

const SSH_AND_GIT: Array<[string, EvidenceFragment]> = [
  ["ssh", { kind: "ssh", text: "SSH", audit: [{ destination: "other" }] }],
  ["git", { kind: "git", text: "GIT" }],
];

describe("assembleEvidence verified scripts", () => {
  test("an unavailable script skips the ssh provider and blocks complete evidence", async () => {
    const { pending, root } = await script(2222);
    await rm(join(root.directory, "deploy.sh"));
    const calls: string[] = [];
    const { envelope } = await assemble(
      pending,
      { fragments: SSH_AND_GIT, context: root },
      calls,
    );
    expect(envelope.verifiedScript?.status).toBe("unavailable");
    expect(calls.filter((call) => call.startsWith("collect"))).toHaveLength(1);
    expect(calls.at(-1)).toStartWith("collect git ");
    expect(envelope.enrichment).toBe("GIT");
    expect(envelope.sshAudit).toEqual([
      {
        destination: "deploy@host.invalid",
        port: "2222",
        stdinStatus: "unavailable",
      },
    ]);
    expect(envelope.actionEvidenceComplete).toBe(false);
    expect(envelope.evidenceCompleteness?.reasons.at(-1)).toBe(
      "verified script content was unavailable or did not match its hash",
    );
    expect(Object.keys(envelope).slice(6, 9)).toEqual([
      "enrichment",
      "verifiedScript",
      "sshAudit",
    ]);
  });

  test("a delegated session keys the script analysis by its root session", async () => {
    const { pending, root, key } = await script();
    const registry = new ScriptAnalysisRegistry();
    registry.remember(key(PARENT), "Prints a fixed message and exits.");
    const { envelope } = await assemble(pending, {
      sessions: delegatedSessions(),
      fragments: SSH_AND_GIT,
      context: { ...root, scriptRegistry: registry },
    });
    expect(envelope.verifiedScript?.status).toBe("reused");
    expect(envelope.verifiedScript?.cacheKey).toBe(key(PARENT));
    expect(envelope.sshAudit).toEqual([
      { destination: "deploy@host.invalid", stdinStatus: "reused" },
    ]);
    expect(envelope.actionEvidenceComplete).toBe(true);
  });

  test.each([
    { name: "an unknown origin", sessions: {} },
    { name: "a human root", sessions: { [CURRENT]: { id: CURRENT } } },
  ])(
    "$name keys the script analysis by the requesting session",
    async ({ sessions }) => {
      const { pending, root, key } = await script();
      const { envelope } = await assemble(pending, { sessions, context: root });
      expect(envelope.verifiedScript?.status).toBe("full");
      expect(envelope.verifiedScript?.cacheKey).toBe(key(CURRENT));
    },
  );
});
