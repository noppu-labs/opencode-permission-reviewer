import { expect, test } from "bun:test";
import { createV2ContextReader } from "../src/adapters/opencode/v2/context-reader.ts";
import { defined } from "./helpers.ts";
import { intentIDs } from "./intent-ids.ts";

type V2Context = Parameters<typeof createV2ContextReader>[0];
const assistant = {
  type: "assistant",
  id: "reply",
  agent: "build",
  time: { created: 30 },
  content: [
    { type: "text", text: "Inspecting", extra: 1 },
    { type: "tool", id: "call", name: "shell", state: { status: "done" } },
  ],
};

function v2(
  messages: unknown[],
  session: Record<string, unknown> = {},
  list?: (input: unknown) => unknown[],
): V2Context {
  return {
    session: {
      get: async () => ({
        id: "session",
        location: { directory: "/workspace" },
        time: { created: 10 },
        ...session,
      }),
      context: async () => messages,
    },
    ...(list
      ? { message: { list: async (input: unknown) => ({ data: list(input) }) } }
      : {}),
  } as unknown as V2Context;
}

const signal: AbortSignal = new AbortController().signal;

test("native context maps users and assistants exactly and skips other entries", async () => {
  const reader = createV2ContextReader(
    v2([
      { type: "user", id: "ask", text: "Inspect", time: { created: 20 } },
      { type: "synthetic", id: "note", text: "Injected" },
      assistant,
    ]),
    signal,
  );
  expect(
    JSON.stringify(await reader.messages("session", "/workspace", 3)),
  ).toBe(
    JSON.stringify([
      {
        info: { id: "ask", role: "user", time: { created: 20 } },
        parts: [{ type: "text", text: "Inspect" }],
      },
      {
        info: {
          id: "reply",
          role: "assistant",
          agent: "build",
          time: { created: 30 },
        },
        parts: [
          { type: "text", text: "Inspecting", extra: 1 },
          {
            type: "tool",
            callID: "call",
            tool: "shell",
            state: { status: "done" },
          },
        ],
      },
    ]),
  );
});

test("native context marks omitted history and keeps only the last messages", async () => {
  const fork = { fork: { sessionID: "parent" } };
  const reader = createV2ContextReader(
    v2(
      [
        { type: "user", id: "first", text: "First", time: { created: 1 } },
        { type: "user", id: "inherited", text: "Old", time: { created: 5 } },
        { type: "user", id: "current", text: "New", time: { created: 10 } },
      ],
      fork,
    ),
    signal,
  );
  expect(
    JSON.stringify(await reader.messages("session", "/workspace", 2)),
  ).toBe(
    JSON.stringify([
      {
        info: { role: "system" },
        parts: [
          {
            type: "text",
            synthetic: true,
            text: "Earlier session context was compacted or omitted. Summaries are not literal user authorization.",
          },
        ],
      },
      {
        info: {
          id: "inherited",
          role: "assistant",
          time: { created: 5 },
          originSessionID: "parent",
          synthetic: true,
        },
        parts: [{ type: "text", text: "Old", synthetic: true }],
      },
      {
        info: { id: "current", role: "user", time: { created: 10 } },
        parts: [{ type: "text", text: "New" }],
      },
    ]),
  );
});

test("native intent falls back to the context's last user messages", async () => {
  const reader = createV2ContextReader(
    v2(
      [
        { type: "user", id: "a", text: "A", time: { created: 11 } },
        assistant,
        { type: "user", id: "b", text: "B", time: { created: 12 } },
        { type: "user", id: "c", text: "C", time: { created: 13 } },
      ],
      { fork: { sessionID: "parent" }, time: { created: 12 } },
    ),
    signal,
  );
  const read = defined(reader.intentMessages, "reader.intentMessages");
  expect(
    JSON.stringify(await read.call(reader, "session", "/workspace", 2)),
  ).toBe(
    JSON.stringify([
      {
        info: { id: "b", role: "user", time: { created: 12 } },
        parts: [{ type: "text", text: "B" }],
      },
      {
        info: { id: "c", role: "user", time: { created: 13 } },
        parts: [{ type: "text", text: "C" }],
      },
    ]),
  );
  expect(await intentIDs(reader, 1)).toEqual(["c"]);
  expect(await intentIDs(reader, 3)).toEqual(["b", "c"]);
});

test("native intent lists recent user messages oldest first and drops other types", async () => {
  const calls: unknown[] = [];
  const reader = createV2ContextReader(
    v2([], {}, (input) => {
      calls.push(input);
      return [
        { type: "user", id: "late", text: "Late", time: { created: 12 } },
        {
          type: "assistant",
          id: "reply",
          text: "Ignored",
          time: { created: 11 },
        },
        { type: "user", id: "early", text: "Early", time: { created: 11 } },
      ];
    }),
    signal,
  );
  expect(await intentIDs(reader, 20)).toEqual(["early", "late"]);
  expect(await intentIDs(reader, 2)).toEqual(["early", "late"]);
  expect(calls).toEqual([
    { sessionID: "session", type: "user", order: "desc", limit: 50 },
    { sessionID: "session", type: "user", order: "desc", limit: 8 },
  ]);
  await expect(intentIDs(reader, 2, "/other")).rejects.toThrow(
    "Session location mismatch",
  );
});
