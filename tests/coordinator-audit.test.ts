import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientResponse } from "../src/opencode/types.ts";
import { renderVerifiedSshScriptCommand } from "../src/verified-ssh-command.ts";
import { decision, defined, MockClient, request, runtime } from "./helpers.ts";

beforeAll(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
});

describe("coordinator audit records", () => {
  test("a manual reply that supersedes an in-flight review writes exactly one superseded audit record", async () => {
    const client = new MockClient();
    const resolvers: Array<(value: { data: Record<string, unknown> }) => void> =
      [];
    client.promptImpl = (): Promise<ClientResponse<Record<string, unknown>>> =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      });
    const harness = runtime(client);
    harness.runtime.handle(request());
    // Let the reviewer reach the model call, then have the human reject.
    await new Promise((r) => setTimeout(r, 5));
    harness.runtime.handlePermissionReply({
      type: "permission.replied",
      properties: {
        sessionID: "ses_main",
        requestID: "per_1",
        reply: "reject",
      },
    });
    for (const resolve of resolvers)
      resolve({ data: { info: { structured: decision("allow") } } });
    await harness.runtime.waitForIdle();
    expect(client.replies).toHaveLength(0);
    const audits = harness.ctx.auditRecords.filter(
      (record) => record.requestID === "per_1",
    );
    expect(audits).toHaveLength(1);
    expect(defined(audits[0], "audits[0]")).toMatchObject({
      requestID: "per_1",
      outcome: "escalate",
      decisionSource: "manual-superseded",
      application: "superseded",
      reason: "Request already answered manually; automatic review superseded.",
    });
  });

  test("identical action content yields the same actionHash; a different action yields a different one", async () => {
    const harness = runtime();
    const action = {
      permission: "bash",
      patterns: ["printf one", "printf two"],
      metadata: { command: "printf one && printf two" },
    };
    await harness.runtime.process(request({ id: "per_a", ...action }));
    // Same action from another session and tool call, patterns in another order.
    await harness.runtime.process(
      request({
        ...action,
        id: "per_b",
        sessionID: "ses_other",
        tool: { messageID: "msg_2", callID: "call_2" },
        patterns: ["printf two", "printf one"],
      }),
    );
    await harness.runtime.process(
      request({
        id: "per_c",
        permission: "bash",
        patterns: ["printf three"],
        metadata: { command: "printf three" },
      }),
    );
    const byRequest = new Map(
      harness.ctx.auditRecords.map((record) => [record.requestID, record]),
    );
    const first = defined(byRequest.get("per_a"), "per_a audit");
    const second = defined(byRequest.get("per_b"), "per_b audit");
    const other = defined(byRequest.get("per_c"), "per_c audit");
    expect(first.actionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.actionHash).toBe(first.actionHash);
    expect(second.actionFingerprint).toBe(first.actionFingerprint);
    expect(first.actionFingerprint).toBe(`v1:${first.actionHash}`);
    expect(other.actionHash).not.toBe(first.actionHash);
  });

  test("actionHash of a fixed request is a pinned value", async () => {
    const harness = runtime();
    await harness.runtime.process(
      request({
        id: "per_pin",
        permission: "bash",
        // Mixed case and a non-ASCII entry: code-unit and locale sorts differ.
        patterns: ["b*", "é*", "B*", "a*"],
        metadata: { command: "printf pinned" },
      }),
    );
    const record = defined(
      harness.ctx.auditRecords.find((r) => r.requestID === "per_pin"),
      "per_pin audit",
    );
    // Pins the canonical form so audit records stay correlatable across versions.
    expect(record.actionHash).toBe(
      // biome-ignore lint/security/noSecrets: a SHA-256 hex digest pinned as the expected value, not a credential
      "a235e10ca35924b993710c8eb897d1eaf669c2dd97fb63f4d6cef9bd2725f253",
    );
  });

  test("a verified ssh script read during evidence collection reaches the audit record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coordinator-audit-"));
    try {
      const path = join(directory, "deploy.sh");
      await writeFile(path, "echo ok\n");
      const command = renderVerifiedSshScriptCommand({
        path,
        destination: "deploy@host.invalid",
        sha256: createHash("sha256").update("echo ok\n").digest("hex"),
        shell: "bash",
      });
      const harness = runtime(new MockClient(), {}, undefined, { directory });
      await harness.runtime.process(
        request({ metadata: { command }, patterns: [command] }),
      );
      expect(
        defined(harness.ctx.auditRecords[0], "audit record").verifiedScript,
      ).toEqual({
        sha256: createHash("sha256").update("echo ok\n").digest("hex"),
        status: "full",
        bytes: 8,
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
