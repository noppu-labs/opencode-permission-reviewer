import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewAttempt } from "../src/core/review-attempt.ts";
import { DECISION_SCHEMA } from "../src/decision-schema.ts";
import { probeCapabilities } from "../src/opencode/capability-detection.ts";
import type { ClientResponse, RuntimeContext } from "../src/opencode/types.ts";
import { V1ReviewerBackend } from "../src/opencode/v1/reviewer-backend.ts";
import { REVIEWER_SYSTEM_PROMPT } from "../src/policy.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../src/types.ts";
import { config, decision, defined, MockClient, request } from "./helpers.ts";

const bases: string[] = [];
afterEach(async () => {
  await Promise.all(
    bases.splice(0).map((base) => rm(base, { recursive: true, force: true })),
  );
});

type Call = [name: string, options: unknown];

function harness(overrides: Partial<ReviewerConfig> = {}): {
  client: MockClient;
  calls: Call[];
  recorded: number[];
  backend: V1ReviewerBackend;
  base: string;
  review: (envelope?: Partial<ReviewEnvelope>) => Promise<{
    result: ReviewExecutionResult;
    envelope: ReviewEnvelope;
  }>;
} {
  const base = mkdtempSync(join(tmpdir(), "reviewer-v1-run-"));
  bases.push(base);
  const client = new MockClient();
  const calls: Call[] = [];
  const recorded: number[] = [];
  const track =
    (name: string) =>
    async (options: unknown): Promise<ClientResponse<unknown>> => {
      calls.push([name, options]);
      return { data: true };
    };
  client.session.abort = track("abort");
  client.session.delete = track("delete");
  client.tool.ids = async (
    options?: unknown,
  ): Promise<ClientResponse<string[]>> => {
    calls.push(["tool.ids", options]);
    return { data: ["bash", "StructuredOutput", "read"] };
  };
  const ctx: RuntimeContext = {
    client,
    capabilities: probeCapabilities(client),
    permissionReply: client.permissionReply,
    directory: "/workspace/operational",
    worktree: "/workspace/operational",
    reviewerDirectoryBase: base,
  };
  const backend = new V1ReviewerBackend(
    ctx,
    config({ model: "fixture/reviewer", variant: "max", ...overrides }),
    () => {},
    (_envelope, ms) => void recorded.push(ms),
  );
  const review = async (
    overridesEnvelope: Partial<ReviewEnvelope> = {},
  ): Promise<{ result: ReviewExecutionResult; envelope: ReviewEnvelope }> => {
    const envelope: ReviewEnvelope = {
      request: request(),
      directory: "/workspace/operational",
      worktree: "/workspace/operational",
      transcript: "Run printf safe",
      intentHistory: "Run printf safe",
      enrichment: "",
      sshAudit: [],
      ...overridesEnvelope,
    };
    const attempt = new ReviewAttempt("generation_fixture", 5000);
    try {
      return { result: await backend.review(envelope, attempt), envelope };
    } finally {
      attempt.close("cancelled");
    }
  };
  return { client, calls, recorded, backend, base, review };
}

test("structured mode sends the exact create, tool and prompt shapes", async () => {
  const run = harness();
  const { result } = await run.review({
    request: request({ patterns: ["printf safe", "x".repeat(200)] }),
  });
  expect(result).toMatchObject({
    kind: "allow",
    reviewSessionID: "ses_review_1",
  });
  expect(JSON.stringify(run.client.creates[0])).toBe(
    JSON.stringify({
      signal: {},
      body: {
        title: `[permission-review] bash: ${`printf safe, ${"x".repeat(200)}`.slice(0, 120)}`,
      },
      query: { directory: run.base },
    }),
  );
  expect(run.calls[0]).toEqual([
    "tool.ids",
    { query: { directory: run.base }, signal: expect.any(AbortSignal) },
  ]);
  const prompt = run.client.prompts[0] as {
    body: { parts: Array<{ text: string }> };
  };
  expect(JSON.stringify(prompt)).toBe(
    JSON.stringify({
      signal: {},
      path: { id: "ses_review_1" },
      query: { directory: run.base },
      body: {
        model: { providerID: "fixture", modelID: "reviewer" },
        variant: "max",
        tools: { "*": false, bash: false, read: false, StructuredOutput: true },
        system: REVIEWER_SYSTEM_PROMPT,
        format: {
          type: "json_schema",
          schema: DECISION_SCHEMA,
          retryCount: 2,
        },
        parts: [
          { type: "text", text: defined(prompt.body.parts[0], "part").text },
        ],
      },
    }),
  );
});

test("text mode keeps a listed StructuredOutput tool disabled in place", async () => {
  const run = harness({ outputFormat: "text" });
  run.client.nextText = JSON.stringify(decision("allow"));
  expect((await run.review()).result.kind).toBe("allow");
  const prompt = run.client.prompts[0] as {
    body: { tools: Record<string, boolean>; format: unknown };
  };
  expect(JSON.stringify(prompt.body.tools)).toBe(
    JSON.stringify({
      "*": false,
      bash: false,
      StructuredOutput: false,
      read: false,
    }),
  );
  expect(prompt.body.format).toEqual({ type: "text" });
});

test("cleanup aborts and then deletes the review session in its isolated location", async () => {
  const run = harness();
  run.client.promptImpl = async (): Promise<
    ClientResponse<Record<string, unknown>>
  > => {
    expect(run.backend.owns("ses_review_1")).toBe(true);
    return { data: { info: { structured: decision("allow") } } };
  };
  await run.review();
  expect(run.backend.owns("ses_review_1")).toBe(false);
  expect(run.calls.slice(1)).toEqual([
    ["abort", { path: { id: "ses_review_1" }, query: { directory: run.base } }],
    [
      "delete",
      { path: { id: "ses_review_1" }, query: { directory: run.base } },
    ],
  ]);
});

test("retained review sessions are aborted but never deleted", async () => {
  const run = harness({ retainReviewSessions: true });
  await run.review();
  expect(run.calls.map(([name]) => name)).toEqual(["tool.ids", "abort"]);
});

test("cleanup failures never change the decision", async () => {
  const run = harness();
  run.client.session.abort = (): Promise<never> =>
    Promise.reject(new Error("abort failed"));
  run.client.session.delete = (): Promise<never> =>
    Promise.reject(new Error("delete failed"));
  expect((await run.review()).result.kind).toBe("allow");
});

test("reviewer time is recorded per prompt, cumulatively across the text retry", async () => {
  const run = harness({ outputFormat: "text" });
  run.client.nextTexts = ["not a decision", JSON.stringify(decision("deny"))];
  const { result } = await run.review();
  expect(JSON.stringify(result)).toBe(
    JSON.stringify({
      kind: "deny",
      decision: decision("deny"),
      reason: "The action has unsafe unrequested effects.",
      reviewerOutcome: "deny",
      reviewSessionID: "ses_review_1",
      decisionSource: "llm-reviewer",
    }),
  );
  const [first, total] = run.recorded;
  expect(run.recorded).toHaveLength(2);
  expect(total).toBeGreaterThanOrEqual(first as number);
});

test("reviewer time is recorded before an invalid prompt response fails", async () => {
  const run = harness();
  run.client.promptError = "unavailable";
  const { result } = await run.review();
  expect(run.recorded).toHaveLength(1);
  expect(JSON.stringify(result)).toBe(
    JSON.stringify({
      kind: "escalate",
      reason:
        'reviewer backend failed (Error): session.prompt failed: "unavailable"',
      reviewSessionID: "ses_review_1",
      decisionSource: "failure-safe",
      escalationDisposition: "manual",
    }),
  );
});

test("an invalid structured decision escalates with the structured reason", async () => {
  const run = harness();
  run.client.nextStructured = { outcome: "allow" };
  const { result } = await run.review();
  expect(JSON.stringify(result)).toBe(
    JSON.stringify({
      kind: "escalate",
      reason: "Reviewer returned missing or invalid structured output.",
      reviewSessionID: "ses_review_1",
      decisionSource: "failure-safe",
      escalationDisposition: "manual",
    }),
  );
  expect(run.client.prompts).toHaveLength(1);
});

test("a failure before the session exists carries no review session", async () => {
  const run = harness();
  run.client.mcpServers = { fixture: { status: "connected" } };
  const { result } = await run.review();
  expect(JSON.stringify(result)).toBe(
    JSON.stringify({
      kind: "escalate",
      reason:
        "reviewer backend failed (Error): Reviewer isolation location contains MCP servers",
      decisionSource: "failure-safe",
      escalationDisposition: "manual",
    }),
  );
  expect(run.client.creates).toHaveLength(0);
  expect(run.calls).toEqual([]);
});

test.each([
  {
    name: "an incomplete action",
    input: { actionEvidenceComplete: false },
    expected: false,
  },
  { name: "an unset action", input: {}, expected: true },
])("$name keeps its evidence completeness", async ({ input, expected }) => {
  const run = harness();
  const { envelope } = await run.review(input);
  expect(envelope.actionEvidenceComplete).toBe(expected);
});
