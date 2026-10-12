import { describe, expect, test } from "bun:test";
import type { SessionLineage } from "../src/actor-context-types.ts";
import { normalizeMessages } from "../src/context.ts";
import { block, text, user } from "./intent-builders.ts";
import { CURRENT, fakeReader, lineage, resolve } from "./intent-fixtures.ts";

function withoutOrigin({
  origin: _origin,
  ...rest
}: SessionLineage): SessionLineage {
  return rest;
}

describe("resolveIntent — the current session", () => {
  test("a human root keeps its own user text as direct intent", async () => {
    const { reader, calls } = fakeReader({}, {});
    const current = [
      user("u1", [text("First goal")], 10),
      { info: { id: "a1", role: "assistant" }, parts: [text("Reply")] },
      user("u2", [text("Injected", { synthetic: true }), text("Second")], 30),
      user("u3", [text("  Magic Compact: anything")], 40),
      user("u4", [text("Ignored", { ignored: true }), text(" Third ")], 20),
      user("u5", [text("   "), text("You have 12 weighted tokens left")]),
      ...normalizeMessages([
        {
          info: { id: 7, role: "user", time: { created: "late" } },
          parts: [text("Untimed")],
        },
      ]),
    ];
    const result = await resolve(
      reader,
      current,
      lineage("human-root", [{ sessionID: CURRENT }]),
    );
    const second = block(CURRENT, "u2", "user", "Second", "session-api", 30);
    const local = [
      block(CURRENT, "u1", "user", "First goal", "session-api", 10),
      second,
      block(CURRENT, "u4", "user", " Third ", "session-api", 20),
      block(CURRENT, "", "user", "Untimed", "session-api"),
    ];
    expect(result).toStrictEqual({
      directUserIntent: local,
      delegatedTask: [],
      localSessionIntent: local,
      conflictingInstructions: [],
      latestExplicitAuthorization: second,
      completeness: "complete",
    });
    expect(result.directUserIntent).toBe(result.localSessionIntent);
    expect(calls).toEqual([]);
  });

  test("the latest authorization falls back to the last block, and ties keep the earliest", async () => {
    const { reader } = fakeReader({}, {});
    const root = lineage("human-root", [{ sessionID: CURRENT }]);
    const untimed = await resolve(
      reader,
      [user("u1", [text("one")]), user("u2", [text("two")])],
      root,
    );
    expect(untimed.latestExplicitAuthorization?.messageID).toBe("u2");
    const tied = await resolve(
      reader,
      [
        user("u1", [text("one")], 5),
        user("u2", [text("two")], 5),
        user("u3", [text("three")]),
      ],
      root,
    );
    expect(tied.latestExplicitAuthorization?.messageID).toBe("u1");
  });

  test("an unknown origin relabels the local blocks as unknown and unavailable", async () => {
    const { reader, calls } = fakeReader({}, {});
    const result = await resolve(
      reader,
      [user("u1", [text("Do it")], 3)],
      lineage("unknown", [{ sessionID: CURRENT }]),
    );
    expect(result).toStrictEqual({
      directUserIntent: [],
      delegatedTask: [],
      localSessionIntent: [
        {
          ...block(CURRENT, "u1", "user", "Do it", "session-api", 3),
          actor: "unknown",
          provenance: {
            value: "intent",
            source: "unavailable",
            confidence: "unknown",
          },
        },
      ],
      conflictingInstructions: [],
      completeness: "partial",
      reasons: [
        "delegated session: no human-authored user messages exist in this session chain window",
      ],
    });
    expect(calls).toEqual([]);
  });

  test("a missing origin is treated as delegated", async () => {
    const { reader } = fakeReader({}, {});
    const result = await resolve(
      reader,
      [user("u1", [text("Brief")])],
      withoutOrigin(lineage("delegated", [{ sessionID: CURRENT }])),
    );
    expect(result.localSessionIntent).toStrictEqual([
      block(CURRENT, "u1", "assistant", "Brief", "parent-session"),
    ]);
    expect(result.completeness).toBe("partial");
  });

  test("with no messages a human root and a delegated session report insufficient", async () => {
    const { reader } = fakeReader({}, {});
    const human = await resolve(
      reader,
      [],
      lineage("human-root", [{ sessionID: CURRENT }]),
    );
    expect(human.completeness).toBe("insufficient");
    expect(human.reasons).toEqual(["no direct user intent recovered"]);
    const orphan = await resolve(
      reader,
      [],
      lineage(
        "delegated",
        [{ sessionID: CURRENT, parentID: "ses_gone" }],
        ["ses_gone"],
      ),
    );
    expect(orphan).toStrictEqual({
      directUserIntent: [],
      delegatedTask: [],
      localSessionIntent: [],
      conflictingInstructions: [],
      completeness: "insufficient",
      reasons: [
        "missing parents: ses_gone",
        "delegated session: no human-authored user messages exist in this session chain window",
      ],
    });
  });
});

describe("context hardening batch 12", () => {
  const lines = async (
    texts: string[],
  ): Promise<Awaited<ReturnType<typeof resolve>>> => {
    const { reader } = fakeReader({}, {});
    const message = user(
      "u1",
      texts.map((value) => text(value)),
      10,
    );
    return resolve(
      reader,
      [message],
      lineage("human-root", [{ sessionID: CURRENT }]),
    );
  };

  test.each([
    "magic compact: compaction in progress...",
    "  MAGIC COMPACT: history compressed",
    "Magic Compact: anything at all",
    "you have 12 weighted tokens left",
  ])("selects the human line, not the part %j", async (value) => {
    const result = await lines([value, "Real human line"]);
    const human = block(
      CURRENT,
      "u1",
      "user",
      "Real human line",
      "session-api",
      10,
    );
    expect(result.directUserIntent).toStrictEqual([human]);
    expect(result.latestExplicitAuthorization).toStrictEqual(human);
  });

  test.each([
    "magic compact: compaction in progress...",
    "you have 12 weighted tokens left",
  ])("yields no intent from the lone part %j", async (value) => {
    const result = await lines([value]);
    expect(result.directUserIntent).toStrictEqual([]);
    expect(result.latestExplicitAuthorization).toBeUndefined();
  });

  test.each([
    "Please explain what Magic Compact: means here",
    "Note that you have 5 weighted tokens left over",
  ])("selects each message %j as human text", async (value) => {
    const result = await lines([value]);
    expect(result.latestExplicitAuthorization?.text).toBe(value);
  });
});
