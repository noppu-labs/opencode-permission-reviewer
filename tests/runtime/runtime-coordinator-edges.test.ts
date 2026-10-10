import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import type { ReviewAuditRecord } from "../../src/audit-record.ts";
import type { ClientResponse } from "../../src/opencode/types.ts";
import type { ReviewExecutionResult } from "../../src/types.ts";
import { decision, defined, MockClient, request, runtime } from "../helpers.ts";
import { holdCalls, phases, replyBody } from "./runtime-fixtures.ts";

type PromptResolver = (value: ClientResponse<Record<string, unknown>>) => void;

const SUPERSEDED: ReviewExecutionResult = {
  kind: "escalate",
  reason: "Request already answered manually; automatic review superseded.",
  decisionSource: "manual-superseded",
};

function auditRecords(ctx: unknown): ReviewAuditRecord[] {
  return (ctx as { auditRecords: ReviewAuditRecord[] }).auditRecords;
}

function collectLogs(): {
  logs: Array<[string, unknown]>;
  logger: (message: string, details?: unknown) => void;
} {
  const logs: Array<[string, unknown]> = [];
  return {
    logs,
    logger: (message: string, details?: unknown): void => {
      logs.push([message, details]);
    },
  };
}

beforeAll(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
});

describe("coordinator edges", () => {
  test("reply events that do not name a pending request leave the review running", async () => {
    const client = new MockClient();
    const calls = holdCalls<PromptResolver>("reviewer prompts");
    client.promptImpl = (): Promise<ClientResponse<Record<string, unknown>>> =>
      new Promise((resolve) => calls.hold(resolve));
    const harness = runtime(client);
    harness.runtime.handle(request());
    await calls.held(1);
    const replied = "permission.replied";
    [
      null,
      replied,
      { type: "permission.updated", properties: { requestID: "per_1" } },
      { type: replied },
      { type: replied, properties: null },
      { type: replied, properties: "per_1" },
      { type: replied, properties: { requestID: "per_1" } },
      { type: replied, properties: { sessionID: 7, requestID: "per_1" } },
      { type: replied, properties: { sessionID: "ses_main", requestID: 1 } },
      { type: replied, properties: { sessionID: "ses_main" } },
      { type: replied, properties: { sessionID: "ses_main", requestID: "x" } },
    ].forEach((event) => {
      harness.runtime.handlePermissionReply(event);
    });
    calls.resolvers.forEach((resolve) => {
      resolve({ data: { info: { structured: decision("allow") } } });
    });
    await harness.runtime.waitForIdle();
    expect(client.replies).toHaveLength(1);
    expect(replyBody(client.replies[0]).reply).toBe("once");
    expect(phases(client)).toEqual(["reviewing", "approved"]);
  });

  test("a deny whose reply finds the request already resolved publishes no denied phase", async () => {
    const client = new MockClient();
    client.nextStructured = decision("deny");
    client.replyError = { status: 404, message: "PermissionNotFoundError" };
    const harness = runtime(client);
    const result = await harness.runtime.process(request());
    expect(result).toEqual(SUPERSEDED);
    expect(client.replies).toHaveLength(1);
    expect(replyBody(client.replies[0]).reply).toBe("reject");
    expect(phases(client)).toEqual(["reviewing"]);
    expect(defined(auditRecords(harness.ctx)[0], "audit record")).toMatchObject(
      {
        outcome: "escalate",
        decisionSource: "manual-superseded",
        application: "superseded",
      },
    );
  });

  test("process() after dispose() supersedes without a reply or a model call", async () => {
    const client = new MockClient();
    const harness = runtime(client);
    await harness.runtime.dispose();
    const result = await harness.runtime.process(request());
    expect(result).toEqual(SUPERSEDED);
    expect(client.replies).toHaveLength(0);
    expect(client.prompts).toHaveLength(0);
    expect(phases(client)).toEqual(["reviewing"]);
    expect(defined(auditRecords(harness.ctx)[0], "audit record")).toMatchObject(
      { outcome: "escalate", application: "superseded" },
    );
  });

  test("handle() after dispose() starts nothing", async () => {
    const client = new MockClient();
    const harness = runtime(client);
    await harness.runtime.dispose();
    harness.runtime.handle(request());
    expect(harness.runtime.pendingCount()).toBe(0);
    await harness.runtime.waitForIdle();
    expect(client.uiStatuses).toHaveLength(0);
  });

  test("a host without status publishing still replies", async () => {
    const client = new MockClient();
    const harness = runtime(client);
    delete harness.ctx.publishUiStatus;
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("allow");
    expect(client.replies).toHaveLength(1);
    expect(client.uiStatuses).toHaveLength(0);
  });

  test.each([
    ["undefined", undefined],
    ["a string", "published"],
    ["an object without an error field", { data: true }],
  ])(
    "a status publish resolving to %s is not logged as a failure",
    async (_label, response) => {
      const client = new MockClient();
      const { logs, logger } = collectLogs();
      const harness = runtime(client, {}, logger);
      // Off-contract host responses probe the coordinator's defensive check.
      harness.ctx.publishUiStatus = (): Promise<ClientResponse<unknown>> =>
        Promise.resolve(response as ClientResponse<unknown>);
      const result = await harness.runtime.process(request());
      expect(result.kind).toBe("allow");
      expect(
        logs.filter(([message]) => message.includes("UI status")),
      ).toHaveLength(0);
    },
  );

  test("a status publish rejecting with a non-Error is logged by its string form", async () => {
    const client = new MockClient();
    const { logs, logger } = collectLogs();
    const harness = runtime(client, {}, logger);
    harness.ctx.publishUiStatus = (): Promise<ClientResponse<unknown>> =>
      Promise.reject("publish refused");
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("allow");
    expect(client.replies).toHaveLength(1);
    expect(logs.filter(([message]) => message.includes("UI status"))).toEqual([
      [
        "failed to publish reviewer UI status",
        { requestID: "per_1", phase: "reviewing", error: "publish refused" },
      ],
      [
        "failed to publish reviewer UI status",
        { requestID: "per_1", phase: "approved", error: "publish refused" },
      ],
    ]);
  });

  test("a review failure with a non-Error value is logged by its string form", async () => {
    const client = new MockClient();
    const { logs, logger } = collectLogs();
    const harness = runtime(client, {}, logger);
    harness.ctx.permissionReply = (): Promise<ClientResponse<boolean>> =>
      Promise.reject("transport closed");
    harness.runtime.handle(request());
    await harness.runtime.waitForIdle();
    expect(
      logs.find(([message]) => message.startsWith("review failed")),
    ).toEqual([
      "review failed; the attempt recorded its failure disposition",
      { requestID: "per_1", error: "transport closed" },
    ]);
  });
});
