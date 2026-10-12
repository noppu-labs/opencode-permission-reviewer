import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractPermissionRequest } from "../../src/opencode/event-normalizer.ts";
import type { ClientResponse } from "../../src/opencode/types.ts";
import { decision, defined, MockClient, request, runtime } from "../helpers.ts";
import { phases, replyBody } from "./runtime-fixtures.ts";

// /tmp/opencode is one of the plugin's approved enrichment roots. It exists on
// machines that run OpenCode, but not on a fresh CI runner or a clean clone.
beforeAll(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
});

describe("event boundary", () => {
  test("only accepts permission.asked with a complete request shape", () => {
    expect(
      extractPermissionRequest({
        type: "permission.replied",
        properties: request(),
      }),
    ).toBeUndefined();
    expect(
      extractPermissionRequest({
        type: "permission.asked",
        properties: { id: "x" },
      }),
    ).toBeUndefined();
    expect(
      extractPermissionRequest({
        type: "permission.asked",
        properties: request(),
      }),
    ).toEqual(request());
  });

  test("plugin uses OpenCode V1's authenticated raw transport to reply", async () => {
    const configRoot = await mkdtemp("/tmp/reviewer-v1-config-");
    const globalConfig = join(configRoot, "permission-reviewer.jsonc");
    await writeFile(
      globalConfig,
      JSON.stringify({
        model: "openai/gpt-5.6-luna",
        variant: "max",
        audit: false,
      }),
    );
    let evidence!: {
      rawPosts: unknown[];
      deletes: unknown[];
      prompts: unknown[];
    };
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../fixtures/v1-server.ts"),
          globalConfig,
        ],
        {
          env: { ...process.env, HOME: join(configRoot, "home") },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stderr).toBe("");
      expect(exit).toBe(0);
      evidence = JSON.parse(stdout);
    } finally {
      await rm(configRoot, { recursive: true, force: true });
    }
    const { rawPosts } = evidence;
    expect(
      rawPosts.filter(
        (post) => (post as { url?: string }).url === "/tui/publish",
      ),
    ).toHaveLength(2);
    const reply = rawPosts.find(
      (post) =>
        (post as { url?: string }).url === "/permission/{requestID}/reply",
    );
    expect(reply).toMatchObject({
      url: "/permission/{requestID}/reply",
      path: { requestID: "per_1" },
      body: { reply: "once" },
    });
    expect(evidence.deletes).toHaveLength(1);
    expect(
      (evidence.prompts[0] as { body: { model: unknown; variant: string } })
        .body,
    ).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-5.6-luna" },
      variant: "max",
    });
  }, 30_000);

  test("text mode sends a text format body and approves from parsed JSON", async () => {
    const harness = runtime(new MockClient(), {
      outputFormat: "text",
      model: "opencode-go/deepseek-v4-flash",
      variant: "high",
    });
    harness.client.nextText = JSON.stringify(decision("allow"));
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("allow");
    expect(replyBody(harness.client.replies[0]).reply).toBe("once");

    const prompt = harness.client.prompts[0] as {
      body: { format: unknown; model: unknown; variant: string };
    };
    expect(prompt.body.format).toEqual({ type: "text" });
    expect(prompt.body.model).toEqual({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
    });
    expect(prompt.body.variant).toBe("high");
  });

  test("text mode with a fence plus prose escalates (ambiguous response)", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextText =
      "Here is the review:\n```json\n" +
      JSON.stringify(decision("allow"), null, 2) +
      "\n```\nDone.";
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(result.reason).toMatch(/unparseable text output/i);
    expect(harness.client.replies).toHaveLength(0);
  });

  test("text mode with two conflicting decisions escalates (never picks one)", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextText =
      JSON.stringify(decision("allow")) +
      "\nFinal decision:\n" +
      JSON.stringify(decision("deny"));
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(harness.client.replies).toHaveLength(0);
  });

  test("text mode embeds the decision schema in the prompt part", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextText = JSON.stringify(decision("allow"));
    await harness.runtime.process(request());
    const prompt = harness.client.prompts[0] as {
      body: { parts: Array<{ type: string; text: string }> };
    };
    const part = defined(prompt.body.parts[0], "prompt part").text;
    expect(part).toContain("# Output format");
    expect(part).toContain('"outcome"');
    expect(part).toContain('"risk_level"');
    expect(part).toContain('"scope_alignment"');
    expect(part).toContain("misaligned");
  });

  test("text mode with unparseable output escalates with no reply", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextText = "I cannot provide a structured decision.";
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(result.reason).toMatch(/unparseable text output/i);
    expect(harness.client.replies).toHaveLength(0);
    expect(phases(harness.client)).toEqual(["reviewing", "manual"]);
  });

  test("text mode with no text parts escalates", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextText = ""; // becomes parts with empty text
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(harness.client.replies).toHaveLength(0);
  });

  test("text mode retries once when the first response is unparseable, then parses the retry", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextTexts = [
      "Here is some prose that cannot be parsed.",
      JSON.stringify(decision("allow")),
    ];
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("allow");
    expect(harness.client.replies).toHaveLength(1);
    // Exactly two reviewer prompts: the original and one corrective retry.
    expect(harness.client.prompts).toHaveLength(2);
  });

  test("text mode retry appends a corrective note in the same review session", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextTexts = [
      "bad output",
      JSON.stringify(decision("allow")),
    ];
    await harness.runtime.process(request());
    const prompts = harness.client.prompts as Array<{
      path: { id: string };
      body: { parts: Array<{ type: string; text: string }> };
    }>;
    expect(prompts).toHaveLength(2);
    const first = defined(prompts[0], "first prompt");
    const retry = defined(prompts[1], "retry prompt");
    // Both prompts target the same review session (first-writer-wins on the reply).
    expect(retry.path.id).toBe(first.path.id);
    expect(retry.body.parts).toHaveLength(2);
    const note = defined(retry.body.parts[1], "retry note");
    expect(note.text).toMatch(/could not be parsed/i);
    expect(note.text).toMatch(/exactly one JSON object/i);
  });

  test("text mode retries once and escalates when both responses are unparseable", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextTexts = ["first bad", "second bad"];
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(result.reason).toMatch(/unparseable text output/i);
    expect(harness.client.replies).toHaveLength(0);
    expect(harness.client.prompts).toHaveLength(2);
  });

  test("text mode does not retry a valid decision", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextTexts = [JSON.stringify(decision("allow"))];
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("allow");
    expect(harness.client.prompts).toHaveLength(1);
  });

  test("structured mode is not retried by the plugin (OpenCode retries it)", async () => {
    const harness = runtime();
    harness.client.nextStructured = "not an object";
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(harness.client.prompts).toHaveLength(1);
  });

  test("text mode retry output still passes enforceDecision gates (critical risk escalates)", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.nextTexts = [
      "garbage first response",
      JSON.stringify(decision("allow", { risk_level: "critical" })),
    ];
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(harness.client.replies).toHaveLength(0);
    expect(harness.client.prompts).toHaveLength(2);
  });

  test("a reviewer transport failure does not trigger the retry", async () => {
    const harness = runtime(new MockClient(), { outputFormat: "text" });
    harness.client.promptImpl = async (): Promise<
      ClientResponse<Record<string, unknown>>
    > => ({
      error: "transport is down",
    });
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(harness.client.replies).toHaveLength(0);
    expect(harness.client.prompts).toHaveLength(1);
  });

  test("default mode still sends the json_schema structured-output format", async () => {
    const harness = runtime();
    await harness.runtime.process(request());
    const prompt = harness.client.prompts[0] as { body: { format: unknown } };
    expect(prompt.body.format).toMatchObject({
      type: "json_schema",
      retryCount: 2,
      schema: { type: "object", additionalProperties: false },
    });
  });
});
