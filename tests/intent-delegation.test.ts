import { describe, expect, test } from "bun:test";
import type { IntentBlock } from "../src/modules/context/models/actor-context-types.ts";
import type { MessageWithParts } from "../src/types.ts";
import { block, text, user } from "./intent-builders.ts";
import { CURRENT, fakeReader, lineage, resolve } from "./intent-fixtures.ts";

const PARENT = "ses_parent";

function delegation(
  parts: Array<Record<string, unknown>>,
  id: unknown = "pm1",
): MessageWithParts {
  return { info: { id, role: "assistant" }, parts } as MessageWithParts;
}

describe("resolveIntent — delegated tasks in the parent session", () => {
  test("reads the task text from the part, then the task input, for this child only", async () => {
    const task = (extra: Record<string, unknown>): Record<string, unknown> => ({
      type: "tool",
      tool: "task",
      ...extra,
    });
    const parentMessages = [
      delegation([
        { type: "subtask", prompt: "Subtask prompt", time: { start: 100 } },
        { type: "subtask", description: "Subtask description" },
        task({
          state: {
            input: { prompt: "Tool prompt" },
            metadata: { sessionId: CURRENT },
          },
          time: { start: "x" },
        }),
        task({
          state: {
            input: { description: "Sibling" },
            metadata: { sessionId: "ses_sibling" },
          },
        }),
        task({ state: { input: { description: "Tool description" } } }),
        task({
          state: {
            input: { prompt: 5, description: "Fallback" },
            metadata: { sessionId: 42 },
          },
        }),
        task({
          prompt: "Part prompt",
          state: { input: { prompt: "Input prompt" } },
        }),
        task({ state: { input: null } }),
        task({}),
        {
          type: "tool",
          tool: "bash",
          state: { input: { prompt: "Not a task" } },
        },
        { type: "subtask", prompt: "   " },
        {
          type: "subtask",
          prompt: 3,
          description: "After a non-string prompt",
        },
        {
          type: "subtask",
          state: { input: { prompt: "Subtask state input" } },
        },
        { type: "subtask", prompt: "No start", time: { end: 5 } },
        { type: "subtask", prompt: "Null time", time: null },
      ]),
      delegation([{ type: "subtask", prompt: "Second message" }], 9),
    ];
    const { reader, calls } = fakeReader(
      { [PARENT]: parentMessages },
      { [PARENT]: [user("pu1", [text("Parent goal")], 50)] },
    );
    const result = await resolve(
      reader,
      [user("u1", [text("Briefing")], 60)],
      lineage("delegated", [
        { sessionID: CURRENT, parentID: PARENT },
        { sessionID: PARENT },
      ]),
      2,
    );
    const delegated = (
      value: string,
      messageID = "pm1",
      createdAt?: number,
    ): IntentBlock =>
      block(PARENT, messageID, "assistant", value, "parent-session", createdAt);
    const parentGoal = block(
      PARENT,
      "pu1",
      "user",
      "Parent goal",
      "session-api",
      50,
    );
    expect(result).toStrictEqual({
      directUserIntent: [parentGoal],
      delegatedTask: [
        delegated("Subtask prompt", "pm1", 100),
        delegated("Subtask description"),
        delegated("Tool prompt"),
        delegated("Tool description"),
        delegated("Fallback"),
        delegated("Part prompt"),
        delegated("After a non-string prompt"),
        delegated("No start"),
        delegated("Null time"),
        delegated("Second message", ""),
      ],
      localSessionIntent: [
        block(CURRENT, "u1", "assistant", "Briefing", "parent-session", 60),
      ],
      conflictingInstructions: [],
      latestExplicitAuthorization: parentGoal,
      completeness: "complete",
    });
    expect(calls).toEqual([
      `messages ${PARENT} /repo 4`,
      `intentMessages ${PARENT} /repo 4`,
    ]);
  });

  test("a parent with its own parent contributes no direct intent; the root does", async () => {
    const { reader, calls } = fakeReader(
      {},
      {
        [PARENT]: [user("pu1", [text("Agent brief to parent")], 5)],
        ses_root: [
          user("ru1", [text("Root goal")], 1),
          user("ru2", [text("Root restriction")], 2),
        ],
      },
    );
    const result = await resolve(
      reader,
      [],
      lineage(
        "delegated",
        [
          { sessionID: CURRENT, parentID: PARENT },
          { sessionID: PARENT, parentID: "ses_root" },
          { sessionID: "ses_root" },
        ],
        ["ses_lost"],
      ),
      12,
    );
    const restriction = block(
      "ses_root",
      "ru2",
      "user",
      "Root restriction",
      "session-api",
      2,
    );
    expect(result).toStrictEqual({
      directUserIntent: [
        block("ses_root", "ru1", "user", "Root goal", "session-api", 1),
        restriction,
      ],
      delegatedTask: [],
      localSessionIntent: [],
      conflictingInstructions: [],
      latestExplicitAuthorization: restriction,
      completeness: "partial",
      reasons: [
        "no delegation subtask located in parent session",
        "missing parents: ses_lost",
      ],
    });
    expect(calls).toEqual([
      `messages ${PARENT} /repo 12`,
      `intentMessages ${PARENT} /repo 12`,
      "intentMessages ses_root /repo 12",
    ]);
  });

  test("a root that still has a parent contributes no direct intent", async () => {
    const { reader, calls } = fakeReader(
      {},
      { ses_root: [user("ru1", [text("Not human")], 1)] },
    );
    const result = await resolve(
      reader,
      [],
      lineage("delegated", [
        { sessionID: CURRENT, parentID: PARENT },
        { sessionID: PARENT, parentID: "ses_root" },
        { sessionID: "ses_root", parentID: "ses_beyond" },
      ]),
    );
    expect(result.directUserIntent).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  test("a reader without intentMessages falls back to messages for every read", async () => {
    const { reader, calls } = fakeReader(
      {
        [PARENT]: [user("pu1", [text("Parent goal")], 4)],
        ses_root: [user("ru1", [text("Root goal")], 2)],
      },
      undefined,
    );
    const result = await resolve(
      reader,
      [],
      lineage("delegated", [
        { sessionID: CURRENT, parentID: PARENT },
        { sessionID: PARENT, parentID: "ses_root" },
        { sessionID: "ses_root" },
      ]),
    );
    expect(result.directUserIntent.map((b) => b.messageID)).toEqual(["ru1"]);
    expect(calls).toEqual([
      `messages ${PARENT} /repo 8`,
      `messages ${PARENT} /repo 8`,
      "messages ses_root /repo 8",
    ]);
  });

  test("failed or malformed reads count as empty", async () => {
    const { reader, calls } = fakeReader(
      { [PARENT]: new Error("unavailable") },
      { [PARENT]: { data: [] }, ses_root: new Error("unavailable") },
    );
    const result = await resolve(
      reader,
      [user("u1", [text("Briefing")])],
      lineage("delegated", [
        { sessionID: CURRENT, parentID: PARENT },
        { sessionID: PARENT, parentID: "ses_root" },
        { sessionID: "ses_root" },
      ]),
    );
    expect(result).toStrictEqual({
      directUserIntent: [],
      delegatedTask: [],
      localSessionIntent: [
        block(CURRENT, "u1", "assistant", "Briefing", "parent-session"),
      ],
      conflictingInstructions: [],
      completeness: "partial",
      reasons: [
        "no delegation subtask located in parent session",
        "delegated session: no human-authored user messages exist in this session chain window",
      ],
    });
    expect(calls).toHaveLength(3);
  });
});
