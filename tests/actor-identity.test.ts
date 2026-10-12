import { describe, expect, test } from "bun:test";
import type { Provenanced } from "../src/actor-context-types.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { resolveActorContext } from "../src/context/actor-resolver.ts";
import type { ContextReader } from "../src/core/ports.ts";
import { evaluatePolicy } from "../src/policy/policy-engine.ts";
import type {
  MessageWithParts,
  PermissionRequest,
  PolicyRule,
  ReviewerConfig,
} from "../src/types.ts";
import { request } from "./helpers.ts";
import { capability } from "./policy-fixtures.ts";

const CURRENT = "ses_current";
const UNKNOWN: Provenanced<string | undefined> = {
  value: undefined,
  source: "unavailable",
  confidence: "unknown",
};
const UNKNOWN_PROFILE = {
  value: "unknown",
  source: "unavailable",
  confidence: "unknown",
};
const config: ReviewerConfig = {
  ...DEFAULT_CONFIG,
  actorProfiles: { build: "workspace" },
};

/** A reader that records each call; sessions absent from the map read as null. */
function sessionReader(sessions: Record<string, Record<string, unknown>>): {
  reader: ContextReader;
  calls: string[];
} {
  const calls: string[] = [];
  const reader: ContextReader = {
    messages: async (
      sessionID: string,
      directory: string,
      limit: number,
    ): Promise<unknown> => {
      calls.push(`messages ${sessionID} ${directory} ${limit}`);
      return [];
    },
    intentMessages: async (
      sessionID: string,
      directory: string,
      limit: number,
    ): Promise<unknown> => {
      calls.push(`intentMessages ${sessionID} ${directory} ${limit}`);
      return [];
    },
    session: async (sessionID: string, directory: string): Promise<unknown> => {
      calls.push(`session ${sessionID} ${directory}`);
      return sessions[sessionID] ?? null;
    },
  };
  return { reader, calls };
}

function toolMessage(
  info: Record<string, unknown>,
  parts: Array<Record<string, unknown>>,
): MessageWithParts {
  return {
    info: { id: "msg_tool", role: "assistant", ...info },
    parts,
  } as MessageWithParts;
}

const CALL = { type: "tool", tool: "bash", callID: "call_1" };
const OTHER_CALL = { type: "tool", tool: "bash", callID: "call_2" };
const TOOL = { messageID: "msg_tool", callID: "call_1" };

function pending(tool?: unknown): PermissionRequest {
  const base = request({ sessionID: CURRENT });
  const { tool: _omitted, ...rest } = base;
  return (tool === undefined ? rest : { ...rest, tool }) as PermissionRequest;
}

const child: Record<string, Record<string, unknown>> = {
  [CURRENT]: { id: CURRENT, parentID: "ses_parent" },
};
const childAndParent: Record<string, Record<string, unknown>> = {
  ...child,
  ses_parent: { id: "ses_parent" },
};

describe("resolveActorContext actor identity", () => {
  test.each([
    {
      name: "agent and mode on a located call",
      tool: TOOL,
      messages: [toolMessage({ agent: "build", mode: "primary" }, [CALL])],
      agentName: {
        value: "build",
        source: "tool-message",
        confidence: "confirmed",
      },
      mode: {
        value: "primary",
        source: "tool-message",
        confidence: "confirmed",
      },
      profile: {
        value: "workspace",
        source: "global-config",
        confidence: "confirmed",
      },
      identityCompleteness: "complete",
    },
    {
      name: "agent only, call absent from the parts",
      tool: TOOL,
      messages: [toolMessage({ agent: "build" }, [OTHER_CALL])],
      agentName: { value: "build", source: "tool-message", confidence: "high" },
      mode: UNKNOWN,
      profile: {
        value: "workspace",
        source: "global-config",
        confidence: "confirmed",
      },
      identityCompleteness: "partial",
    },
    {
      name: "mode only",
      tool: TOOL,
      messages: [toolMessage({ mode: "subagent" }, [CALL])],
      agentName: UNKNOWN,
      mode: {
        value: "subagent",
        source: "tool-message",
        confidence: "confirmed",
      },
      profile: UNKNOWN_PROFILE,
      identityCompleteness: "partial",
    },
    {
      name: "an agent without a configured profile",
      tool: TOOL,
      messages: [toolMessage({ agent: "plan", mode: "primary" }, [])],
      agentName: { value: "plan", source: "tool-message", confidence: "high" },
      mode: { value: "primary", source: "tool-message", confidence: "high" },
      profile: UNKNOWN_PROFILE,
      identityCompleteness: "complete",
    },
    {
      name: "mistyped agent and mode",
      tool: TOOL,
      messages: [toolMessage({ agent: 5, mode: null }, [CALL])],
      agentName: UNKNOWN,
      mode: UNKNOWN,
      profile: UNKNOWN_PROFILE,
      identityCompleteness: "unknown",
    },
    {
      name: "a non-string callID",
      tool: { messageID: "msg_tool", callID: 7 },
      messages: [toolMessage({ agent: "build" }, [{ ...CALL, callID: 7 }])],
      agentName: { value: "build", source: "tool-message", confidence: "high" },
      mode: UNKNOWN,
      profile: {
        value: "workspace",
        source: "global-config",
        confidence: "confirmed",
      },
      identityCompleteness: "partial",
    },
    {
      name: "no pending tool",
      tool: undefined,
      messages: [toolMessage({ agent: "build", mode: "primary" }, [CALL])],
      agentName: UNKNOWN,
      mode: UNKNOWN,
      profile: UNKNOWN_PROFILE,
      identityCompleteness: "unknown",
    },
    {
      name: "an empty messageID",
      tool: { messageID: "", callID: "call_1" },
      messages: [toolMessage({ id: "", agent: "build" }, [CALL])],
      agentName: UNKNOWN,
      mode: UNKNOWN,
      profile: UNKNOWN_PROFILE,
      identityCompleteness: "unknown",
    },
    {
      name: "a tool message missing from the list",
      tool: { messageID: "msg_other", callID: "call_1" },
      messages: [toolMessage({ agent: "build" }, [CALL])],
      agentName: UNKNOWN,
      mode: UNKNOWN,
      profile: UNKNOWN_PROFILE,
      identityCompleteness: "unknown",
    },
  ])("$name", async (row) => {
    const { reader } = sessionReader(childAndParent);
    const result = await resolveActorContext(
      pending(row.tool),
      [...row.messages],
      reader,
      "/repo",
      config,
    );
    expect(result.actor).toEqual({
      agentName: row.agentName,
      mode: row.mode,
      profile: row.profile,
      sessionID: CURRENT,
      parentSessionID: {
        value: "ses_parent",
        source: "session-api",
        confidence: "confirmed",
      },
      rootSessionID: {
        value: "ses_parent",
        source: "session-api",
        confidence: "confirmed",
      },
      delegationDepth: {
        value: 1,
        source: "session-api",
        confidence: "confirmed",
      },
      identityCompleteness: row.identityCompleteness,
    } as unknown as typeof result.actor);
    expect(Object.keys(result.actor)).toEqual([
      "agentName",
      "mode",
      "profile",
      "sessionID",
      "parentSessionID",
      "rootSessionID",
      "delegationDepth",
      "identityCompleteness",
    ]);
  });

  test("a root session has no parent and unconfirmed root and depth", async () => {
    const { reader, calls } = sessionReader({ [CURRENT]: { id: CURRENT } });
    const result = await resolveActorContext(
      pending(TOOL),
      [toolMessage({ agent: "build", mode: "primary" }, [CALL])],
      reader,
      "/repo",
      config,
    );
    expect(result.actor.parentSessionID).toEqual(UNKNOWN);
    expect(result.actor.rootSessionID).toEqual({
      value: CURRENT,
      source: "session-api",
      confidence: "unknown",
    });
    expect(result.actor.delegationDepth).toEqual({
      value: 0,
      source: "session-api",
      confidence: "unknown",
    });
    expect(result.completeness.reasons).toEqual([
      "no parent lineage resolved",
      "no direct user intent recovered",
    ]);
    expect(result.completeness.overall).toBe("partial");
    expect(calls).toEqual([`session ${CURRENT} /repo`]);
  });

  test("an unreadable parent keeps the parent id with depth zero", async () => {
    const { reader, calls } = sessionReader(child);
    const result = await resolveActorContext(
      pending(TOOL),
      [],
      reader,
      "/repo",
      config,
    );
    expect(result.lineage.depth).toBe(0);
    expect(result.actor.parentSessionID).toEqual({
      value: "ses_parent",
      source: "session-api",
      confidence: "confirmed",
    });
    expect(result.actor.delegationDepth.confidence).toBe("unknown");
    expect(result.completeness).toEqual({
      permission: true,
      actor: false,
      lineage: false,
      directUserIntent: false,
      delegatedTask: false,
      purpose: false,
      capability: false,
      repositoryState: false,
      referencedCode: false,
      reasons: [
        "actor identity unavailable",
        "no parent lineage resolved",
        "missing parents: ses_parent",
        "no direct user intent recovered",
      ],
      overall: "insufficient",
    });
    expect(calls).toEqual([
      `session ${CURRENT} /repo`,
      "session ses_parent /repo",
    ]);
  });

  test("a failure after the reads falls back to the unknown resolution", async () => {
    const { reader, calls } = sessionReader(childAndParent);
    const result = await resolveActorContext(
      pending(TOOL),
      [toolMessage({ agent: "build" }, [CALL])],
      reader,
      "/repo",
      { ...config, actorProfiles: undefined } as unknown as ReviewerConfig,
    );
    expect(result.actor.identityCompleteness).toBe("unknown");
    expect(result.lineage).toEqual({
      origin: "unknown",
      nodes: [{ sessionID: CURRENT }],
      rootSessionID: CURRENT,
      depth: 0,
      cycleDetected: false,
      truncated: false,
      missingParents: [],
    });
    expect(result.completeness.reasons).toHaveLength(1);
    expect(result.completeness.reasons[0]).toStartWith(
      "actor resolution failed: ",
    );
    // Lineage and intent were read before the actor was assembled.
    expect(calls).toEqual([
      `session ${CURRENT} /repo`,
      "session ses_parent /repo",
      "messages ses_parent /repo 8",
      "intentMessages ses_parent /repo 8",
    ]);
  });

  test("a failure while locating the tool message happens before any read", async () => {
    const { reader, calls } = sessionReader(childAndParent);
    const result = await resolveActorContext(
      pending(TOOL),
      [
        {
          info: { id: "msg_tool" },
          parts: null,
        } as unknown as MessageWithParts,
      ],
      reader,
      "/repo",
      config,
    );
    expect(result.completeness.reasons[0]).toStartWith(
      "actor resolution failed: ",
    );
    expect(calls).toEqual([]);
  });
});

describe("context hardening batch 11", () => {
  const rules: PolicyRule[] = [
    {
      id: "unmapped",
      source: "global",
      when: { actorProfile: ["unknown"] },
      effect: "manual",
      reason: "unmapped",
    },
  ];

  test.each(["build", "constructor", "toString", "valueOf", "__proto__"])(
    "routes each agent %#",
    async (agent) => {
      const { reader } = sessionReader(childAndParent);
      const mapped = agent === "build";
      const result = await resolveActorContext(
        pending(TOOL),
        [toolMessage({ agent, mode: "primary" }, [CALL])],
        reader,
        "/repo",
        config,
      );
      const trace = evaluatePolicy(capability(), result.actor, config, rules);
      expect(result.actor.profile.value).toBe(mapped ? "workspace" : "unknown");
      expect(trace.finalRoute).toBe(mapped ? "review" : "manual");
    },
  );
});
