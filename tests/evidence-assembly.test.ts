import { describe, expect, test } from "bun:test";
import { parseCommand } from "../src/capability/command-parser.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { buildIntentHistory, buildTranscript } from "../src/context.ts";
import type { MessageWithParts, ReviewEnvelope } from "../src/types.ts";
import { CURRENT, PARENT } from "./evidence-assembly-fakes.ts";
import { assemble, delegatedSessions } from "./evidence-assembly-fixtures.ts";
import { MockClient, request } from "./helpers.ts";

const TOOL_MESSAGE = {
  info: { id: "msg_1", role: "assistant", agent: "build", mode: "primary" },
  parts: [
    { type: "text", text: "Running the build." },
    { type: "tool", tool: "bash", callID: "call_1" },
  ],
} as MessageWithParts;
const USER = {
  info: { id: "msg_0", role: "user", time: { created: 1 } },
  parts: [{ type: "text", text: "Please build the project." }],
} as MessageWithParts;
const SCOPE = JSON.stringify({
  directory: "/repo",
  worktree: "/repo",
  maxChars: DEFAULT_CONFIG.maxEnrichmentChars,
});
const LIMIT = Math.max(
  DEFAULT_CONFIG.historyMessages,
  DEFAULT_CONFIG.transcriptMessages * 2,
  20,
);

/** The envelope keys in order, with the two timings checked and dropped. */
function shape(envelope: ReviewEnvelope): string[] {
  expect(envelope.timings).toEqual({
    contextMs: expect.any(Number),
    enrichmentMs: expect.any(Number),
  });
  return Object.keys(envelope);
}

describe("assembleEvidence", () => {
  test("a delegated bash request: reads, providers, ask decisions and envelope order", async () => {
    const pending = request({ metadata: { command: "npm run build" } });
    const { envelope, calls, config } = await assemble(pending, {
      messages: [USER, TOOL_MESSAGE],
      intentMessages: [USER],
      sessions: delegatedSessions(),
      fragments: [
        ["git", { kind: "git", text: "GIT" }],
        [
          "ssh",
          {
            kind: "ssh",
            text: "",
            audit: [{ destination: "h", stdinStatus: "absent" }],
          },
        ],
        [
          "local",
          { kind: "local_script", text: "LOCAL", preflightDenial: "first" },
        ],
        ["late", { kind: "git", text: "", preflightDenial: "second" }],
      ],
      decisions: [{ at: 1, question: "Build?", answer: "Yes" }],
      withAskSource: true,
    } as never);
    expect(calls).toEqual([
      `messages ${CURRENT} /repo ${LIMIT}`,
      `intentMessages ${CURRENT} /repo ${DEFAULT_CONFIG.intentMessages}`,
      `session ${CURRENT} /repo`,
      `session ${PARENT} /repo`,
      `messages ${PARENT} /repo 8`,
      `intentMessages ${PARENT} /repo 8`,
      `collect git per_1 ${SCOPE}`,
      `collect ssh per_1 ${SCOPE}`,
      `collect local per_1 ${SCOPE}`,
      `collect late per_1 ${SCOPE}`,
      `recentFor ${CURRENT},${CURRENT},${PARENT} undefined`,
    ]);
    expect(shape(envelope)).toEqual([
      "request",
      "directory",
      "worktree",
      "timings",
      "transcript",
      "intentHistory",
      "enrichment",
      "sshAudit",
      "preflightDenial",
      "actor",
      "lineage",
      "intent",
      "actionPurpose",
      "actionEvidenceComplete",
      "evidenceCompleteness",
      "parsedCommand",
      "capability",
      "askDecisions",
    ]);
    expect(envelope.request).toBe(pending);
    expect(envelope.transcript).toBe(
      buildTranscript([USER, TOOL_MESSAGE], config, {
        omitUserMessages: false,
        pendingTool: { messageID: "msg_1", callID: "call_1" },
      }),
    );
    expect(envelope.intentHistory).toBe(
      buildIntentHistory([USER], config, { delegatedSession: true }),
    );
    expect(envelope.enrichment).toBe("GIT\n\nLOCAL");
    expect(envelope.sshAudit).toEqual([
      { destination: "h", stdinStatus: "absent" },
    ]);
    expect(envelope.preflightDenial).toBe("first");
    expect(envelope.actionPurpose).toEqual({
      text: "Running the build.",
      source: "agent-context",
      confidence: "medium",
    });
    expect(envelope.actionEvidenceComplete).toBe(true);
    expect(envelope.parsedCommand).toEqual(parseCommand("npm run build"));
    expect(envelope.evidenceCompleteness).toEqual({
      permission: true,
      actor: true,
      lineage: true,
      directUserIntent: false,
      delegatedTask: false,
      purpose: true,
      capability: true,
      repositoryState: false,
      referencedCode: false,
      reasons: [
        "no direct user intent recovered",
        "no delegation task located",
      ],
      overall: "partial",
    });
    expect(envelope.askDecisions).toEqual([
      { at: 1, question: "Build?", answer: "Yes" },
    ]);
  });

  test("a human root without intentMessages omits user messages from the transcript", async () => {
    const pending = request({ metadata: { command: "npm run build" } });
    const { envelope, calls, config } = await assemble(pending, {
      messages: [USER, TOOL_MESSAGE],
      sessions: { [CURRENT]: { id: CURRENT } },
      withAskSource: true,
    });
    expect(calls).toEqual([
      `messages ${CURRENT} /repo ${LIMIT}`,
      `session ${CURRENT} /repo`,
      `recentFor ${CURRENT},${CURRENT} undefined`,
    ]);
    expect(envelope.transcript).toBe(
      buildTranscript([USER, TOOL_MESSAGE], config, {
        omitUserMessages: true,
        pendingTool: { messageID: "msg_1", callID: "call_1" },
      }),
    );
    expect(envelope.intentHistory).toBe(
      buildIntentHistory([USER, TOOL_MESSAGE], config, {
        delegatedSession: false,
      }),
    );
    expect(envelope.enrichment).toBe("");
    expect(envelope.sshAudit).toEqual([]);
    expect(shape(envelope)).not.toContain("askDecisions");
    expect(shape(envelope)).not.toContain("preflightDenial");
  });

  test("a human root with no direct intent keeps user messages and no pending tool", async () => {
    const { tool: _omitted, ...rest } = request();
    const { envelope, config } = await assemble(rest, {
      messages: [TOOL_MESSAGE],
      sessions: { [CURRENT]: { id: CURRENT } },
    });
    expect(envelope.transcript).toBe(
      buildTranscript([TOOL_MESSAGE], config, { omitUserMessages: false }),
    );
    expect(envelope.actionPurpose).toEqual({
      source: "unavailable",
      confidence: "unknown",
    });
    expect(envelope.evidenceCompleteness?.purpose).toBe(false);
    expect(envelope.evidenceCompleteness?.reasons.at(-1)).toBe(
      "action purpose unavailable",
    );
  });

  test("an unreadable session is resolved as unknown origin", async () => {
    const { envelope, config } = await assemble(request(), {
      messages: [USER],
      intentMessages: [USER],
    });
    expect(envelope.lineage?.origin).toBe("unknown");
    expect(envelope.intentHistory).toBe(
      buildIntentHistory([USER], config, { delegatedSession: true }),
    );
  });

  test.each([
    {
      name: "ask decisions disabled",
      config: { askDecisions: false },
      withAskSource: true,
    },
    {
      name: "no ask-decision source",
      config: { askDecisions: true },
      withAskSource: false,
    },
  ])("$name: the source is not queried", async ({ config, withAskSource }) => {
    const { envelope, calls } = await assemble(request(), {
      config,
      withAskSource,
      decisions: [{ at: 1, question: "Q", answer: "A" }],
    });
    expect(calls.some((call) => call.startsWith("recentFor"))).toBe(false);
    expect(shape(envelope)).not.toContain("askDecisions");
  });

  test("a v1 client is wrapped in a context reader", async () => {
    const client = new MockClient();
    const { envelope } = await assemble(request(), {
      context: { client },
    });
    expect(client.messageQueries.length).toBeGreaterThan(0);
    expect(envelope.request.id).toBe("per_1");
  });
});

describe("assembleEvidence bash capability", () => {
  test("a non-bash request is not parsed", async () => {
    const { envelope } = await assemble(
      request({ permission: "edit", metadata: { command: "npm run build" } }),
    );
    expect(shape(envelope)).not.toContain("parsedCommand");
    expect(shape(envelope)).not.toContain("capability");
    expect(envelope.evidenceCompleteness?.capability).toBe(false);
  });

  test("a non-string command falls back to the string patterns", async () => {
    const { envelope } = await assemble(
      request({
        metadata: { command: 5 },
        patterns: ["echo a", 7, "echo b"] as never,
      }),
    );
    expect(envelope.parsedCommand).toEqual(parseCommand("echo a\necho b"));
    expect(envelope.evidenceCompleteness?.capability).toBe(true);
  });

  test("a blank command is not parsed", async () => {
    const { envelope } = await assemble(
      request({ metadata: { command: "  \n " } }),
    );
    expect(shape(envelope)).not.toContain("parsedCommand");
    expect(envelope.evidenceCompleteness?.capability).toBe(false);
  });

  test("an analyzer failure keeps the parsed command without capability", async () => {
    const { envelope } = await assemble(
      request({ metadata: { command: "echo hi > out.txt" } }),
      { context: { directory: 42 as never } },
    );
    expect(envelope.parsedCommand).toEqual(parseCommand("echo hi > out.txt"));
    expect(shape(envelope)).not.toContain("capability");
    expect(envelope.evidenceCompleteness?.capability).toBe(false);
  });

  test("an elided pending command marks the action evidence incomplete", async () => {
    const command = `echo ${"x".repeat(DEFAULT_CONFIG.maxPartChars * 4)}`;
    const { envelope } = await assemble(request({ metadata: { command } }));
    expect(envelope.actionEvidenceComplete).toBe(false);
    expect(envelope.evidenceCompleteness?.reasons.at(-1)).toBe(
      "pending action was elided or truncated in the evidence",
    );
  });
});

describe("assembleEvidence time bounds", () => {
  test("a transcript read that never settles times out before any provider runs", async () => {
    const calls: string[] = [];
    const run = assemble(
      request(),
      {
        hangMessages: true,
        config: { timeoutMs: 15 },
        fragments: [["git", { kind: "git", text: "GIT" }]],
      },
      calls,
    );
    await expect(run).rejects.toThrow("Reviewer timed out after 15ms");
    expect(calls).toEqual([`messages ${CURRENT} /repo ${LIMIT}`]);
  });

  test("a provider that never settles times out the assembly after every provider started", async () => {
    const calls: string[] = [];
    const run = assemble(
      request(),
      {
        config: { timeoutMs: 15 },
        fragments: [
          ["git", { kind: "git", text: "GIT" }],
          ["hung", "hang"],
        ],
        withAskSource: true,
      },
      calls,
    );
    await expect(run).rejects.toThrow("Reviewer timed out after 15ms");
    expect(calls.slice(-2)).toEqual([
      `collect git per_1 ${SCOPE}`,
      `collect hung per_1 ${SCOPE}`,
    ]);
  });
});
