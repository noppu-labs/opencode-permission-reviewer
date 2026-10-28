import { expect, test } from "bun:test";
import { ReviewAttempt } from "../src/modules/review/services/review-attempt.ts";
import { decision } from "./helpers.ts";
import {
  answer,
  completed,
  returns,
  type StubInput,
  TOOL,
  v2ReviewFixture,
} from "./v2-review-fixture.ts";

const CORRECTION =
  "\nThe prior response was invalid. Return exactly one valid decision using the requested format.";

const escalation = (reason: string, sessionID: unknown): string =>
  JSON.stringify({
    kind: "escalate",
    reason,
    reviewSessionID: sessionID,
    decisionSource: "failure-safe",
    escalationDisposition: "manual",
  });

const inputsOf = (calls: Array<[string, unknown]>, call: string): unknown[] =>
  calls.filter(([name]) => name === call).map(([, input]) => input);

const promptsOf = (calls: Array<[string, unknown]>): string[] =>
  inputsOf(calls, "session.prompt").map(
    (input) => (input as { text: string }).text,
  );

test("a structured review creates its session and polls it in order", async () => {
  const run = v2ReviewFixture();
  expect((await run.review()).kind).toBe("allow");
  expect(run.calls.map(([name]) => name)).toEqual([
    "mcp.list",
    "plugin.list",
    "mcp.list",
    "model.list",
    "session.create",
    "session.prompt",
    "session.wait",
    "session.context",
    "session.interrupt",
    "session.remove",
    "session.get",
  ]);
  const [created] = inputsOf(run.calls, "session.create") as [{ id: string }];
  const [{ location }] = inputsOf(run.calls, "mcp.list") as [
    { location: unknown },
  ];
  expect(created.id).toMatch(/^ses_[0-9a-f]{32}$/);
  expect(JSON.stringify(created)).toBe(
    JSON.stringify({
      id: created.id,
      title: "Permission review",
      location,
      model: { id: "reviewer", providerID: "fixture", variant: "max" },
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: TOOL, resource: "*", effect: "allow" },
      ],
    }),
  );
  expect(run.calls.slice(5).map(([, input]) => input)).toEqual([
    { sessionID: created.id, text: promptsOf(run.calls)[0] },
    { sessionID: created.id },
    { sessionID: created.id },
    { sessionID: created.id },
    { sessionID: created.id },
    { sessionID: created.id },
  ]);
});

test("a text review without a variant asks for no tool and no variant", async () => {
  const run = v2ReviewFixture({ outputFormat: "text", variant: "" });
  run.stubs["session.prompt"] = returns({ id: "inbox_review" });
  run.stubs["model.list"] = async (): Promise<unknown> => ({
    data: [{ providerID: "fixture", id: "reviewer", capabilities: {} }],
  });
  run.stubs["session.context"] = async (): Promise<unknown> =>
    answer({ type: "text", text: "not a decision" });
  expect((await run.review()).kind).toBe("escalate");
  const [created] = inputsOf(run.calls, "session.create") as [
    Record<string, unknown>,
  ];
  expect(JSON.stringify(created.model)).toBe(
    JSON.stringify({ id: "reviewer", providerID: "fixture" }),
  );
  expect(created.permissions).toEqual([
    { action: "*", resource: "*", effect: "deny" },
  ]);
  expect(promptsOf(run.calls)).toHaveLength(2);
});

test("text output is the admitted reply's text parts joined by newlines", async () => {
  const run = v2ReviewFixture({ outputFormat: "text" });
  run.stubs["session.prompt"] = returns({ id: "inbox_review" });
  const text = JSON.stringify(decision("deny"));
  const split = (at: number): unknown[] => [
    { type: "assistant", id: "early", content: [{ type: "text", text: "x" }] },
    ...answer(
      { type: "text", text: text.slice(0, at) },
      { type: "tool", id: "call", name: "shell", state: {} },
    ),
    {
      type: "assistant",
      id: "b",
      content: [{ type: "text", text: text.slice(at) }],
    },
  ];
  run.stubs["session.context"] = async (): Promise<unknown> =>
    split(text.indexOf(",") + 1);
  expect((await run.review()).kind).toBe("deny");
  run.stubs["session.context"] = async (): Promise<unknown> =>
    split(text.indexOf("deny") + 2);
  expect((await run.review()).kind).toBe("escalate");
});

const model = (fields: object): unknown => ({
  data: [{ providerID: "fixture", id: "reviewer", ...fields }],
});

test.each([
  {
    name: "a foreign MCP inventory",
    stub: "mcp.list",
    value: (): unknown => ({ location: { directory: "/other" }, data: [] }),
    reason: "Reviewer MCP inventory belongs to another location",
  },
  {
    name: "an MCP server",
    stub: "mcp.list",
    value: (input: Record<string, unknown>): unknown => ({
      location: input.location,
      data: [{ name: "x" }],
    }),
    reason: "Reviewer isolation location contains MCP servers",
  },
  {
    name: "a missing model",
    stub: "model.list",
    value: (): unknown => ({ data: [] }),
    reason: "Reviewer model is unavailable",
  },
  {
    name: "a variantless model",
    stub: "model.list",
    value: (): unknown => model({ capabilities: { tools: true } }),
    reason: 'Reviewer variant "max" is unavailable (model has no variants)',
  },
  {
    name: "a toolless model",
    stub: "model.list",
    value: (): unknown =>
      model({ capabilities: {}, variants: [{ id: "max" }] }),
    reason: "Reviewer model does not support structured tool output",
  },
])("$name fails before the session exists", async ({ stub, value, reason }) => {
  const run = v2ReviewFixture();
  run.stubs[stub] = async (input: StubInput): Promise<unknown> => value(input);
  const result = await run.review();
  expect(inputsOf(run.calls, "session.create")).toEqual([]);
  expect(result.reviewSessionID).toMatch(/^ses_[0-9a-f]{32}$/);
  expect(JSON.stringify(result)).toBe(
    escalation(
      `reviewer session call failed (Error): ${reason}`,
      result.reviewSessionID,
    ),
  );
});

test.each([
  { name: "another session ID", value: { id: "ses_other" } },
  { name: "another location", value: { location: { directory: "/other" } } },
])(
  "a created session with $name fails and is cleaned up",
  async ({ value }) => {
    const run = v2ReviewFixture();
    run.stubs["session.create"] = async (
      input: StubInput,
    ): Promise<unknown> => ({ ...input, ...value });
    const result = await run.review();
    expect(result.reason).toBe(
      "reviewer session call failed (Error): Reviewer session identity or isolation location does not match",
    );
    expect(run.calls.slice(5).map(([name]) => name)).toEqual([
      "session.interrupt",
      "session.remove",
      "session.get",
    ]);
  },
);

test("a structured review without a captured decision is re-prompted twice with a correction", async () => {
  const run = v2ReviewFixture();
  run.stubs["session.prompt"] = returns({ id: "inbox_review" });
  run.stubs["session.context"] = async (): Promise<unknown> => answer();
  const result = await run.review();
  const [first, second, third] = promptsOf(run.calls);
  expect(second).toBe(`${first}${CORRECTION}`);
  expect(third).toBe(`${first}${CORRECTION}${CORRECTION}`);
  expect(promptsOf(run.calls)).toHaveLength(3);
  expect(JSON.stringify(result)).toBe(
    escalation(
      "Reviewer returned missing, invalid, or ambiguous output.",
      result.reviewSessionID,
    ),
  );
});

test("schema retries the host reported as errors still allow the final decision", async () => {
  const run = v2ReviewFixture();
  run.stubs["session.context"] = async (): Promise<unknown> => [
    ...answer(completed(TOOL, "error")),
    { type: "assistant", id: "b", content: [completed(TOOL, "error")] },
    { type: "assistant", id: "c", content: [{ type: "text", text: "ok" }] },
    { type: "assistant", id: "d", content: [completed()] },
  ];
  expect((await run.review()).kind).toBe("allow");
});

const failed = completed(TOOL, "error");
const replies = (...messages: unknown[][]): unknown[] => [
  { type: "user", id: "inbox_review", text: "evidence" },
  ...messages.map((content, index) => ({
    type: "assistant",
    id: `reply_${index}`,
    content,
  })),
];

test.each([
  {
    name: "two tool calls in one message",
    context: replies([failed, completed()]),
  },
  {
    name: "four tool calls",
    context: replies([failed], [failed], [failed], [completed()]),
  },
  {
    name: "an earlier completed call",
    context: replies([completed()], [completed()]),
  },
  {
    name: "an earlier call to another tool",
    context: replies([completed("shell", "error")], [completed()]),
  },
  {
    name: "a final call to another tool",
    context: replies([completed("shell")]),
  },
  { name: "a final call that failed", context: replies([failed]) },
  { name: "no admitted message", context: replies([completed()]).slice(1) },
])(
  "a captured decision with $name is ambiguous and never retried",
  async ({ context }) => {
    const run = v2ReviewFixture();
    run.stubs["session.context"] = async (): Promise<unknown> => context;
    const result = await run.review();
    expect(promptsOf(run.calls)).toHaveLength(1);
    expect(result.reason).toBe(
      "Reviewer returned missing, invalid, or ambiguous output.",
    );
  },
);

test("two captured decisions are ambiguous", async () => {
  const run = v2ReviewFixture();
  run.stubs["session.prompt"] = async (input: StubInput): Promise<unknown> => {
    const event = { sessionID: `${input.sessionID}` };
    await run.host.tool.execute(decision("allow"), event);
    await run.host.tool.execute(decision("allow"), event).catch(() => {});
    return { id: "inbox_review" };
  };
  expect((await run.review()).reason).toBe(
    "Reviewer returned missing, invalid, or ambiguous output.",
  );
  expect(promptsOf(run.calls)).toHaveLength(1);
});

test("an attempt that ends while the reviewer runs fails the review", async () => {
  let ended = false;
  let checks = 0;
  const now = (): number => Date.now() + Number(ended && checks++ > 0) * 1e9;
  const attempt = new ReviewAttempt("generation_fixture", 5000, now);
  const run = v2ReviewFixture();
  run.stubs["session.wait"] = async (): Promise<unknown> => {
    ended = true;
    return undefined;
  };
  const result = await run.review(attempt);
  expect(result.reason).toBe(
    "reviewer session call failed (Error): Review no longer active",
  );
  expect(run.calls.map(([name]) => name)).not.toContain("session.context");
  attempt.close("cancelled");
});
