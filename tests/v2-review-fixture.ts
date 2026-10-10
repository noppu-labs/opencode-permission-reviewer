// A V2 reviewer backend over a stub client: the host loads the isolation
// bootstrap on its first plugin listing, and every client call is recorded.
import { afterEach } from "bun:test";
import { pathToFileURL } from "node:url";
import type { OpenCodeClient } from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import { ReviewAttempt } from "../src/core/review-attempt.ts";
import { V2ReviewerBackend } from "../src/opencode/v2/reviewer-backend.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../src/types.ts";
import { config, decision, request } from "./helpers.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];
type Registration = { dispose(): Promise<void> };
export type StubInput = { sessionID?: string } & Record<string, unknown>;
export type Stub = (input: StubInput) => Promise<unknown>;
export const TOOL = "permission_reviewer_result";

const registered = async (): Promise<Registration> => ({
  dispose: async (): Promise<void> => {},
});

/** A stub that resolves to `value`. */
export const returns =
  (value: unknown): Stub =>
  async (): Promise<unknown> =>
    value;

/** The hooks the reviewer registers in its isolated location. */
interface ReviewHost {
  tool: {
    execute(value: unknown, event: { sessionID: string }): Promise<unknown>;
  };
  context(event: {
    sessionID: string;
    system: unknown[];
    messages: unknown[];
    tools: Record<string, unknown>;
  }): void;
  toolHook(event: { sessionID: string; tool: string }): void;
}

export interface V2ReviewFixture {
  backend: V2ReviewerBackend;
  host: ReviewHost;
  stubs: Record<string, Stub>;
  calls: Array<[string, unknown]>;
  review: (attempt?: ReviewAttempt) => Promise<ReviewExecutionResult>;
}

const backends: V2ReviewerBackend[] = [];
afterEach(async () => {
  await Promise.allSettled(
    backends.splice(0).map((backend) => backend.dispose()),
  );
});

/** The context reply to a review prompt: the admitted user message, then `content`. */
export const answer = (...content: unknown[]): unknown[] => [
  { type: "user", id: "inbox_review", text: "evidence" },
  { type: "assistant", id: "reply", content },
];

export const completed = (name = TOOL, status = "completed"): unknown => ({
  type: "tool",
  id: `call_${status}`,
  name,
  state: { status },
});

export function v2ReviewFixture(
  overrides: Partial<ReviewerConfig> = {},
): V2ReviewFixture {
  const host = {} as ReviewHost;
  const calls: Array<[string, unknown]> = [];
  const loaded = new Map<string, Promise<string>>();
  const ctx = {
    tool: {
      transform: (
        add: (editor: { add(tool: ReviewHost["tool"]): void }) => void,
      ): Promise<Registration> => {
        add({
          add: (tool: ReviewHost["tool"]): void => {
            host.tool = tool;
          },
        });
        return registered();
      },
      hook: (
        _name: string,
        hook: ReviewHost["toolHook"],
      ): Promise<Registration> => {
        host.toolHook = hook;
        return registered();
      },
    },
    session: {
      hook: (
        _name: string,
        hook: ReviewHost["context"],
      ): Promise<Registration> => {
        host.context = hook;
        return registered();
      },
    },
    mcp: { transform: registered },
  };
  const load = async (directory: string): Promise<string> => {
    const plugin = await import(pathToFileURL(`${directory}/index.js`).href);
    await plugin.default.setup({ ...ctx, location: { directory } });
    return plugin.default.id;
  };
  const stubs: Record<string, Stub> = {
    "plugin.list": async (input: StubInput): Promise<unknown> => {
      const { directory } = input.location as { directory: string };
      loaded.set(directory, loaded.get(directory) ?? load(directory));
      const id = await loaded.get(directory);
      return {
        data: [{ id, source: { type: "local" }, state: { status: "active" } }],
      };
    },
    "mcp.list": async (input: StubInput): Promise<unknown> => ({
      location: input.location,
      data: [],
    }),
    "model.list": returns({
      data: [
        {
          providerID: "fixture",
          id: "reviewer",
          capabilities: { tools: true },
          variants: [{ id: "max" }],
        },
      ],
    }),
    "session.create": async (input: StubInput): Promise<unknown> => ({
      id: input.id,
      location: input.location,
    }),
    "session.prompt": async (input: StubInput): Promise<unknown> => {
      await host.tool.execute(decision("allow"), {
        sessionID: `${input.sessionID}`,
      });
      return { id: "inbox_review" };
    },
    "session.wait": returns(undefined),
    "session.context": returns(answer(completed())),
    "session.interrupt": returns(undefined),
    "session.remove": returns(undefined),
    "session.get": (): Promise<never> =>
      Promise.reject({ _tag: "SessionNotFoundError" }),
  };
  const client: Record<string, Record<string, Stub>> = {};
  for (const name of Object.keys(stubs)) {
    const [group = "", method = ""] = name.split(".");
    client[group] ??= {};
    client[group][method] = (input: StubInput): Promise<unknown> => {
      calls.push([name, input]);
      return (stubs[name] as Stub)(input);
    };
  }
  const backend = new V2ReviewerBackend(
    ctx as unknown as Context,
    config({ model: "fixture/reviewer", variant: "max", ...overrides }),
  );
  backends.push(backend);
  const envelope: ReviewEnvelope = {
    request: request(),
    directory: "/workspace/operational",
    worktree: "/workspace/operational",
    transcript: "Run printf safe",
    intentHistory: "Run printf safe",
    enrichment: "",
    sshAudit: [],
  };
  return {
    backend,
    host,
    stubs,
    calls,
    review: (
      attempt = new ReviewAttempt("generation_fixture", 5000),
    ): Promise<ReviewExecutionResult> =>
      backend.review(envelope, attempt, client as unknown as OpenCodeClient),
  };
}
