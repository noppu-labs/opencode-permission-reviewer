import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import type { ClientResponse } from "../../src/opencode/types.ts";
import { decision, MockClient, request, runtime } from "../helpers.ts";
import {
  type HeldCalls,
  holdCalls,
  manualReply,
  phases,
  replyBody,
} from "./runtime-fixtures.ts";

type PromptResolver = (value: ClientResponse<Record<string, unknown>>) => void;
type MessagesResolver = (value: ClientResponse<unknown>) => void;

function holdPrompts(client: MockClient): HeldCalls<PromptResolver> {
  const calls = holdCalls<PromptResolver>("reviewer prompts");
  client.promptImpl = (): Promise<ClientResponse<Record<string, unknown>>> =>
    new Promise((resolve) => calls.hold(resolve));
  return calls;
}

function holdMessages(client: MockClient): HeldCalls<MessagesResolver> {
  const calls = holdCalls<MessagesResolver>("transcript fetches");
  client.messagesImpl = (): Promise<ClientResponse<unknown>> =>
    new Promise((resolve) => calls.hold(resolve));
  return calls;
}

// /tmp/opencode is one of the plugin's approved enrichment roots. It exists on
// machines that run OpenCode, but not on a fresh CI runner or a clean clone.
beforeAll(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
});

describe("runtime decisions", () => {
  test("a manual reject during the model call supersedes the review (no double reply)", async () => {
    const client = new MockClient();
    const { resolvers, held } = holdPrompts(client);
    const harness = runtime(client);
    harness.runtime.handle(request());
    // Let the reviewer reach the model call, then have the human reject.
    await held(1);
    manualReply(harness, "per_1", "reject");
    for (const resolve of resolvers)
      resolve({ data: { info: { structured: decision("allow") } } });
    await harness.runtime.waitForIdle();
    expect(client.replies).toHaveLength(0);
    expect(phases(client)).toEqual(["reviewing"]);
    const output = { output: "should not be annotated", metadata: {} };
    harness.runtime.annotateToolResult("call_1", output);
    expect(output.output).toBe("should not be annotated");
  });

  test("a manual allow during the model call supersedes the review (no duplicate once)", async () => {
    const client = new MockClient();
    const { resolvers, held } = holdPrompts(client);
    const harness = runtime(client);
    harness.runtime.handle(request());
    await held(1);
    manualReply(harness, "per_1", "once");
    for (const resolve of resolvers)
      resolve({ data: { info: { structured: decision("deny") } } });
    await harness.runtime.waitForIdle();
    expect(client.replies).toHaveLength(0);
    expect(phases(client)).toEqual(["reviewing"]);
  });

  test("a manual reply for one request does not cancel a sibling review in the same session", async () => {
    const client = new MockClient();
    const { resolvers, held } = holdPrompts(client);
    const harness = runtime(client);
    harness.runtime.handle(
      request({ id: "per_1", tool: { messageID: "m1", callID: "c1" } }),
    );
    harness.runtime.handle(
      request({ id: "per_2", tool: { messageID: "m2", callID: "c2" } }),
    );
    // Evidence collection time varies by runner, so wait for both model calls.
    await held(2);
    manualReply(harness, "per_2", "reject");
    for (const resolve of resolvers)
      resolve({ data: { info: { structured: decision("allow") } } });
    await harness.runtime.waitForIdle();
    // The sibling review that was NOT answered manually completes normally.
    expect(
      client.replies.filter((r) => replyBody(r).reply === "once"),
    ).toHaveLength(1);
    expect(
      client.replies.filter((r) => replyBody(r).reply === "reject"),
    ).toHaveLength(0);
    expect(resolvers).toHaveLength(2);
  });

  test("a reply to an unknown request leaves in-flight reviews untouched (and does not leak)", async () => {
    const harness = runtime();
    manualReply(harness, "never_seen", "reject");
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("allow");
    expect(replyBody(harness.client.replies[0]).reply).toBe("once");
  });

  test("a manual reject during the model call also supersedes an escalate outcome (no manual resurrection)", async () => {
    const client = new MockClient();
    const { resolvers, held } = holdPrompts(client);
    const harness = runtime(client);
    harness.runtime.handle(request());
    await held(1);
    manualReply(harness, "per_1", "reject");
    // Low-confidence allow becomes an escalate; the manual reply must still win.
    for (const resolve of resolvers)
      resolve({
        data: { info: { structured: decision("allow", { confidence: 0.2 }) } },
      });
    await harness.runtime.waitForIdle();
    expect(client.replies).toHaveLength(0);
    expect(phases(client)).toEqual(["reviewing"]);
  });

  test("a 404 on the reply (window residual) is benign: no manual resurrection", async () => {
    const client = new MockClient();
    client.replyError = { status: 404, message: "PermissionNotFoundError" };
    const harness = runtime(client);
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(phases(client)).not.toContain("manual");
    const output = { output: "x", metadata: {} };
    harness.runtime.annotateToolResult("call_1", output);
    expect(output.output).toBe("x");
  });

  test("a PermissionNotFoundError message without status/code is still recognized as already-resolved", async () => {
    const client = new MockClient();
    client.replyError = {
      message: "PermissionNotFoundError: request not found",
    };
    const harness = runtime(client);
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(phases(client)).not.toContain("manual");
  });

  test("a manual reply during transcript collection skips the model call entirely", async () => {
    const client = new MockClient();
    const { resolvers: msgResolvers, held } = holdMessages(client);
    const harness = runtime(client);
    harness.runtime.handle(request());
    await held(1);
    // The human answers while the transcript fetch is still pending.
    manualReply(harness, "per_1", "reject");
    for (const resolve of msgResolvers) resolve({ data: client.messageData });
    await harness.runtime.waitForIdle();
    expect(client.creates).toHaveLength(0);
    expect(client.prompts).toHaveLength(0);
    expect(client.replies).toHaveLength(0);
    expect(phases(client)).toEqual(["reviewing"]);
  });

  test("a transcript failure after a manual reply does not resurrect the manual phase", async () => {
    const client = new MockClient();
    const { resolvers: msgResolvers, held } = holdMessages(client);
    const harness = runtime(client);
    harness.runtime.handle(request());
    await held(1);
    manualReply(harness, "per_1", "reject");
    // Now the transcript fetch fails; the error path must NOT re-emit "manual".
    for (const resolve of msgResolvers)
      resolve({ error: { message: "database unavailable" } });
    await harness.runtime.waitForIdle();
    expect(client.replies).toHaveLength(0);
    expect(phases(client)).toEqual(["reviewing"]);
  });
});
