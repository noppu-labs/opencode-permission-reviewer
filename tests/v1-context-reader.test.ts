import { expect, test } from "bun:test";
import type { ClientResponse } from "../src/adapters/opencode/types.ts";
import { createV1ContextReader } from "../src/adapters/opencode/v1/context-reader.ts";
import type { MessageWithParts } from "../src/types.ts";
import { MockClient } from "./helpers.ts";
import { intentIDs } from "./intent-ids.ts";

const user = (id: string, created: unknown): MessageWithParts => ({
  info: { id, role: "user", time: { created } },
  parts: [{ type: "text", text: `Instruction ${id}` }],
});

function v1(
  messages: MessageWithParts[],
  metadata?: () => Promise<ClientResponse<unknown>>,
): { client: MockClient; limits: () => number[] } {
  const client = new MockClient();
  client.messagesImpl = async (
    input: unknown,
  ): Promise<ClientResponse<unknown>> => {
    const limit = (input as { query: { limit: number } }).query.limit;
    return { data: messages.slice(-limit) };
  };
  if (metadata) client.session.get = metadata;
  return {
    client,
    limits: () =>
      client.messageQueries.map(
        (query) => (query as { query: { limit: number } }).query.limit,
      ),
  };
}

test("legacy reader without session metadata reads one window and skips the time filter", async () => {
  const { client, limits } = v1([user("old", 1), user("new", 2)]);
  const reader = createV1ContextReader(client);
  expect(await intentIDs(reader, 100)).toEqual(["old", "new"]);
  expect(limits()).toEqual([400]);
  expect(await reader.session("session", "/workspace")).toBeUndefined();
});

test.each([
  {
    name: "rejected metadata",
    metadata: (): Promise<never> => Promise.reject(new Error("offline")),
  },
  {
    name: "a metadata error response",
    metadata: async (): Promise<ClientResponse<unknown>> => ({ error: "x" }),
  },
  {
    name: "non-object metadata",
    metadata: async (): Promise<ClientResponse<unknown>> => ({ data: "x" }),
  },
  {
    name: "a non-numeric creation time",
    metadata: async (): Promise<ClientResponse<unknown>> => ({
      data: { time: { created: "100" } },
    }),
  },
])("legacy reader with $name keeps every message", async ({ metadata }) => {
  const { client } = v1([user("old", 1), user("new", 200)], metadata);
  expect(await intentIDs(createV1ContextReader(client), 8)).toEqual([
    "old",
    "new",
  ]);
});

test("legacy reader keeps messages without a numeric time after the session start", async () => {
  const { client } = v1(
    [user("before", 50), user("untimed", "late"), user("after", 150)],
    async () => ({ data: { time: { created: 100 } } }),
  );
  expect(await intentIDs(createV1ContextReader(client), 8)).toEqual([
    "untimed",
    "after",
  ]);
});

test("legacy reader stops widening once it has enough intent messages", async () => {
  const many = Array.from({ length: 600 }, (_, index) => user(`u${index}`, 1));
  const enough = v1(many);
  const ids = await intentIDs(createV1ContextReader(enough.client), 3);
  expect(ids).toEqual(["u597", "u598", "u599"]);
  expect(enough.limits()).toEqual([200]);

  const capped = v1(many);
  const all = await intentIDs(createV1ContextReader(capped.client), 600);
  expect(all).toHaveLength(600);
  expect(capped.limits()).toEqual([2000]);
});

test("legacy reader forwards its signal and the session query to every call", async () => {
  const controller = new AbortController();
  const gets: unknown[] = [];
  const { client } = v1([user("only", 1)], async () => ({ data: {} }));
  client.session.get = async (
    input: unknown,
  ): Promise<ClientResponse<unknown>> => {
    gets.push(input);
    return { data: { id: "session" } };
  };
  const reader = createV1ContextReader(client, controller.signal);
  await intentIDs(reader, 1);
  await reader.session("session", "/workspace");
  expect(gets).toEqual([
    {
      path: { id: "session" },
      query: { directory: "/workspace" },
      signal: controller.signal,
    },
    {
      path: { id: "session" },
      query: { directory: "/workspace" },
      signal: controller.signal,
    },
  ]);
  expect(client.messageQueries).toEqual([
    {
      path: { id: "session" },
      query: { directory: "/workspace", limit: 200 },
      signal: controller.signal,
    },
  ]);
});
