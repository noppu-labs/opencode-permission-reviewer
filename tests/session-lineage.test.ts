import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import type { SessionLineage } from "../src/modules/context/models/actor-context-types.ts";
import { walkLineage } from "../src/modules/context/services/session-lineage.ts";
import type { ContextReader } from "../src/modules/review/ports.ts";
import type { ReviewerConfig } from "../src/types.ts";

function fakeReader(sessions: Record<string, unknown>): {
  reader: ContextReader;
  calls: string[];
} {
  const calls: string[] = [];
  const reader: ContextReader = {
    messages: () => Promise.reject(new Error("messages are not read here")),
    session: (sessionID: string, directory: string): Promise<unknown> => {
      calls.push(`${sessionID} ${directory}`);
      const reply = sessions[sessionID];
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(reply);
    },
  };
  return { reader, calls };
}

const cfg = (overrides: Partial<ReviewerConfig> = {}): ReviewerConfig => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

const walk = (reader: ContextReader, config = cfg()): Promise<SessionLineage> =>
  walkLineage(reader, "s", "/repo", config);

function expected(
  partial: Partial<SessionLineage> & Pick<SessionLineage, "nodes">,
): SessionLineage {
  return {
    nodes: partial.nodes,
    rootSessionID: partial.rootSessionID ?? "s",
    depth: partial.depth ?? 0,
    cycleDetected: partial.cycleDetected ?? false,
    truncated: partial.truncated ?? false,
    missingParents: partial.missingParents ?? [],
    origin: partial.origin ?? "delegated",
  };
}

describe("walkLineage — the starting session", () => {
  test.each([
    ["absent", undefined],
    ["null", null],
    ["a string", "s"],
    ["another id", { id: "other" }],
    ["a mistyped parent id", { id: "s", parentID: 5 }],
    ["a rejection", new Error("down")],
  ])(
    "an unreadable starting session (%s) yields an unknown origin with a bare node",
    async (_label, reply) => {
      const { reader, calls } = fakeReader({ s: reply });
      expect(await walk(reader)).toStrictEqual(
        expected({ nodes: [{ sessionID: "s" }], origin: "unknown" }),
      );
      expect(calls).toEqual(["s /repo"]);
    },
  );

  test("a root session keeps every typed metadata field", async () => {
    const { reader } = fakeReader({
      s: {
        id: "s",
        title: "Title",
        version: "1.2.3",
        agent: "build",
        mode: "primary",
        time: { created: 5 },
        extra: true,
      },
    });
    expect(await walk(reader)).toStrictEqual(
      expected({
        nodes: [
          {
            sessionID: "s",
            title: "Title",
            version: "1.2.3",
            actorName: "build",
            mode: "primary",
            createdAt: 5,
          },
        ],
        origin: "human-root",
      }),
    );
  });

  test.each([
    ["a string created time", { created: "5" }],
    ["a null time", null],
    ["a number time", 5],
    ["an empty time", {}],
  ])("mistyped metadata fields are dropped (%s)", async (_label, time) => {
    const { reader } = fakeReader({
      s: { id: "s", title: 1, version: null, agent: {}, mode: [], time },
    });
    expect(await walk(reader)).toStrictEqual(
      expected({ nodes: [{ sessionID: "s" }], origin: "human-root" }),
    );
  });

  test("an empty parent id is delegated but stops the walk", async () => {
    const { reader, calls } = fakeReader({ s: { id: "s", parentID: "" } });
    expect(await walk(reader)).toStrictEqual(
      expected({ nodes: [{ sessionID: "s", parentID: "" }] }),
    );
    expect(calls).toEqual(["s /repo"]);
  });
});

describe("walkLineage — the ancestry walk", () => {
  const chain = {
    s: { id: "s", parentID: "p", agent: "general" },
    p: { id: "p", parentID: "r", mode: "subagent" },
    r: { id: "r", time: { created: 1 } },
  };

  test("follows parents up to the root in order", async () => {
    const { reader, calls } = fakeReader(chain);
    expect(await walk(reader)).toStrictEqual(
      expected({
        nodes: [
          { sessionID: "s", parentID: "p", actorName: "general" },
          { sessionID: "p", parentID: "r", mode: "subagent" },
          { sessionID: "r", createdAt: 1 },
        ],
        rootSessionID: "r",
        depth: 2,
      }),
    );
    expect(calls).toEqual(["s /repo", "p /repo", "r /repo"]);
  });

  test("the session depth bound truncates and records the next parent", async () => {
    const { reader, calls } = fakeReader(chain);
    expect(await walk(reader, cfg({ maxSessionDepth: 1 }))).toStrictEqual(
      expected({
        nodes: [
          { sessionID: "s", parentID: "p", actorName: "general" },
          { sessionID: "p", parentID: "r", mode: "subagent" },
        ],
        rootSessionID: "p",
        depth: 1,
        truncated: true,
        missingParents: ["r"],
      }),
    );
    expect(calls).toEqual(["s /repo", "p /repo"]);
  });

  test("the parent-session bound truncates before any parent read", async () => {
    const { reader, calls } = fakeReader(chain);
    expect(await walk(reader, cfg({ maxParentSessions: 0 }))).toStrictEqual(
      expected({
        nodes: [{ sessionID: "s", parentID: "p", actorName: "general" }],
        truncated: true,
        missingParents: ["p"],
      }),
    );
    expect(calls).toEqual(["s /repo"]);
  });

  test("a revisited parent is a cycle and is recorded as missing", async () => {
    const { reader, calls } = fakeReader({
      s: { id: "s", parentID: "p" },
      p: { id: "p", parentID: "s" },
    });
    expect(await walk(reader)).toStrictEqual(
      expected({
        nodes: [
          { sessionID: "s", parentID: "p" },
          { sessionID: "p", parentID: "s" },
        ],
        rootSessionID: "p",
        depth: 1,
        cycleDetected: true,
        missingParents: ["s"],
      }),
    );
    expect(calls).toEqual(["s /repo", "p /repo"]);
    const self = fakeReader({ s: { id: "s", parentID: "s" } });
    expect(await walk(self.reader)).toStrictEqual(
      expected({
        nodes: [{ sessionID: "s", parentID: "s" }],
        cycleDetected: true,
        missingParents: ["s"],
      }),
    );
  });

  test.each([
    ["absent", undefined],
    ["another id", { id: "other" }],
    ["a mistyped parent id", { id: "p", parentID: 7 }],
    ["a rejection", new Error("down")],
  ])(
    "an unreadable parent (%s) ends the walk as missing",
    async (_label, reply) => {
      const { reader, calls } = fakeReader({ s: chain.s, p: reply });
      expect(await walk(reader)).toStrictEqual(
        expected({
          nodes: [{ sessionID: "s", parentID: "p", actorName: "general" }],
          missingParents: ["p"],
        }),
      );
      expect(calls).toEqual(["s /repo", "p /repo"]);
    },
  );
});
