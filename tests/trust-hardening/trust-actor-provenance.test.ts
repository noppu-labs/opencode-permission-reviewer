import { afterEach, describe, expect, test } from "bun:test";
import { setGlobalConfigPathForTests } from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { resolveActorContext } from "../../src/context/actor-resolver.ts";
import type {
  ClientResponse,
  OpenCodeClientLike,
} from "../../src/opencode/types.ts";
import type { MessageWithParts, PermissionRequest } from "../../src/types.ts";
import { request } from "../helpers.ts";

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

// --- actor provenance -----------------------------------------------------------------

function actorClient(
  sessions: Record<
    string,
    { meta?: Record<string, unknown>; messages?: MessageWithParts[] }
  >,
): OpenCodeClientLike {
  return {
    session: {
      create: async () => ({ data: {} }),
      get: async (options: unknown) => {
        const id = (options as { path?: { id?: string } }).path?.id;
        const fixture = id === undefined ? undefined : sessions[id];
        return fixture?.meta === undefined
          ? ({ error: { status: 404 } } as ClientResponse<unknown>)
          : { data: fixture.meta };
      },
      messages: async (options: unknown) => {
        const id = (options as { path?: { id?: string } }).path?.id;
        const fixture = id === undefined ? undefined : sessions[id];
        return { data: fixture?.messages ?? [] };
      },
      prompt: async () => ({ data: {} }),
    },
    tool: { ids: async () => ({ data: [] }) },
  };
}

describe("trust hardening — actor intent provenance", () => {
  const cfg = DEFAULT_CONFIG;

  test("host-flagged synthetic user parts are not direct human intent", async () => {
    const messages = [
      {
        info: { id: "m1", role: "user" },
        parts: [
          {
            type: "text",
            text: "Summarize the task tool output and continue.",
            synthetic: true,
          },
        ],
      },
    ] as MessageWithParts[];
    const res = await resolveActorContext(
      request({ sessionID: "ses_current" }) as PermissionRequest,
      messages,
      actorClient({}),
      "/repo",
      cfg,
    );
    expect(res.intent.localSessionIntent).toHaveLength(0);
  });

  test("sibling task-tool delegations are filtered by child session id", async () => {
    const res = await resolveActorContext(
      request({ sessionID: "ses_child_mine" }) as PermissionRequest,
      [],
      actorClient({
        ses_child_mine: {
          meta: { id: "ses_child_mine", parentID: "ses_parent" },
        },
        ses_parent: {
          meta: { id: "ses_parent" },
          messages: [
            {
              info: { id: "mp1", role: "assistant" },
              parts: [
                {
                  type: "tool",
                  tool: "task",
                  state: { metadata: { sessionId: "ses_child_sibling" } },
                  prompt: "sibling brief",
                },
                {
                  type: "tool",
                  tool: "task",
                  state: { metadata: { sessionId: "ses_child_mine" } },
                  prompt: "my brief",
                },
              ],
            } as never,
          ],
        },
      }),
      "/repo",
      cfg,
    );
    const briefs = res.intent.delegatedTask.map((b) => b.text);
    expect(briefs).toContain("my brief");
    expect(briefs).not.toContain("sibling brief");
  });

  test("no user-role message of a delegated session is human intent (briefing or follow-up)", async () => {
    // A subagent session's user-role messages are ALL agent-authored: the
    // initial briefing plus any later instruction the parent sends through
    // the task tool. None of them may surface as human authorization.
    const messages = [
      {
        info: { id: "m1", role: "user", time: { created: 100 } },
        parts: [{ type: "text", text: "parent agent briefing" }],
      },
      {
        info: { id: "m2", role: "user", time: { created: 200 } },
        parts: [{ type: "text", text: "follow-up instruction via task_id" }],
      },
    ] as MessageWithParts[];
    const res = await resolveActorContext(
      request({ sessionID: "ses_child" }) as PermissionRequest,
      messages,
      actorClient({
        ses_child: { meta: { id: "ses_child", parentID: "ses_parent" } },
        ses_parent: {
          meta: { id: "ses_parent" },
          messages: [
            {
              info: { id: "task", role: "assistant" },
              parts: [
                {
                  type: "tool",
                  tool: "task",
                  state: {
                    metadata: { sessionId: "ses_child" },
                    input: { prompt: "do the thing" },
                  },
                },
              ],
            } as never,
          ],
        },
      }),
      "/repo",
      cfg,
    );
    // The agent-authored texts stay visible as local-session context...
    const texts = res.intent.localSessionIntent.map((b) => b.text);
    expect(texts).toContain("parent agent briefing");
    expect(texts).toContain("follow-up instruction via task_id");
    // ...labeled as assistant, never promoted to human authorization.
    for (const block of res.intent.localSessionIntent) {
      expect(block.actor).toBe("assistant");
    }
    expect(res.intent.directUserIntent).toEqual([]);
    // The delegation itself is recovered from the parent's task-tool input.
    expect(res.intent.delegatedTask.map((b) => b.text)).toEqual([
      "do the thing",
    ]);
  });

  test("latestExplicitAuthorization picks by timestamp, not array position", async () => {
    const res = await resolveActorContext(
      request({ sessionID: "ses_current" }) as PermissionRequest,
      [
        {
          info: { id: "briefing", role: "user", time: { created: 500 } },
          parts: [{ type: "text", text: "parent agent briefing" }],
        },
        {
          info: { id: "local1", role: "user", time: { created: 2_000 } },
          parts: [{ type: "text", text: "NEWEST agent follow-up" }],
        },
      ] as MessageWithParts[],
      actorClient({
        ses_current: { meta: { id: "ses_current", parentID: "ses_parent" } },
        ses_parent: {
          meta: { id: "ses_parent" },
          messages: [
            {
              info: { id: "rootold", role: "user", time: { created: 1_000 } },
              parts: [{ type: "text", text: "OLDER human instruction" }],
            },
          ],
        },
      }),
      "/repo",
      cfg,
    );
    // The delegated session's newest message is agent-authored; the latest
    // HUMAN authorization is the older parent-session instruction.
    expect(res.intent.latestExplicitAuthorization?.text).toBe(
      "OLDER human instruction",
    );
  });
});
