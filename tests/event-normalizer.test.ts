import { expect, test } from "bun:test";
import { extractPermissionRequest } from "../src/adapters/opencode/event-normalizer.ts";

const asked = (properties: unknown): unknown => ({
  type: "permission.asked",
  properties,
});

const base = {
  id: "per_1",
  sessionID: "ses_main",
  permission: "bash",
  patterns: ["printf safe"],
};

test.each([
  { name: "a string event", event: "permission.asked" },
  { name: "a null event", event: null },
  { name: "an undefined event", event: undefined },
  { name: "a function event", event: () => undefined },
  { name: "another event type", event: { type: "permission.replied" } },
  { name: "missing properties", event: { type: "permission.asked" } },
  { name: "null properties", event: asked(null) },
  { name: "string properties", event: asked("per_1") },
  { name: "a numeric id", event: asked({ ...base, id: 1 }) },
  { name: "a missing session ID", event: asked({ ...base, sessionID: null }) },
  { name: "a missing permission", event: asked({ ...base, permission: 1 }) },
  { name: "string patterns", event: asked({ ...base, patterns: "x" }) },
  {
    name: "a non-string pattern",
    event: asked({ ...base, patterns: ["printf safe", 1] }),
  },
])("$name is not a permission request", ({ event }) => {
  expect(extractPermissionRequest(event)).toBeUndefined();
});

test("a minimal request defaults metadata and always and omits the tool key", () => {
  expect(JSON.stringify(extractPermissionRequest(asked(base)))).toBe(
    JSON.stringify({ ...base, metadata: {}, always: [] }),
  );
});

test("a complete request keeps its field order and the metadata reference", () => {
  const metadata = { command: "printf safe" };
  const result = extractPermissionRequest(
    asked({
      tool: { callID: "call_1", messageID: "msg_1", extra: true },
      always: ["printf *", 2, "echo *"],
      metadata,
      ...base,
      extra: "ignored",
    }),
  );
  expect(JSON.stringify(result)).toBe(
    JSON.stringify({
      ...base,
      metadata,
      always: ["printf *", "echo *"],
      tool: { messageID: "msg_1", callID: "call_1" },
    }),
  );
  expect(result?.metadata).toBe(metadata);
});

test.each([
  { name: "null metadata", input: { metadata: null }, metadata: {} },
  { name: "string metadata", input: { metadata: "x" }, metadata: {} },
  { name: "array metadata", input: { metadata: ["x"] }, metadata: ["x"] },
])("$name normalises to its record form", ({ input, metadata }) => {
  expect(extractPermissionRequest(asked({ ...base, ...input }))).toEqual({
    ...base,
    metadata,
    always: [],
  } as never);
});

test.each([
  { name: "a string always", input: { always: "printf *" } },
  { name: "a null tool", input: { tool: null } },
  { name: "a string tool", input: { tool: "call_1" } },
  { name: "a tool without a call ID", input: { tool: { messageID: "msg_1" } } },
  {
    name: "a tool with a numeric message ID",
    input: { tool: { messageID: 1, callID: "call_1" } },
  },
])("$name is dropped from the request", ({ input }) => {
  const result = extractPermissionRequest(asked({ ...base, ...input }));
  expect(result).toEqual({ ...base, metadata: {}, always: [] });
  expect(result && "tool" in result).toBe(false);
});
