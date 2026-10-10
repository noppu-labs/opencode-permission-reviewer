import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { McpListOutput, OpenCodeClient } from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import { ReviewAttempt } from "../src/core/review-attempt.ts";
import { V2ReviewerBackend } from "../src/opencode/v2/reviewer-backend.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../src/types.ts";
import { config, decision, request } from "./helpers.ts";

const OPERATIONAL = "/workspace/operational";

type Context = Parameters<Plugin.Plugin["setup"]>[0];
type McpEditor = Parameters<Parameters<Context["mcp"]["transform"]>[0]>[0];
type McpConfig = Parameters<McpEditor["set"]>[1];
type McpServer = NonNullable<ReturnType<McpEditor["get"]>>;
type Tool = {
  input: { parse(value: unknown): unknown };
  execute(value: unknown, event: { sessionID: string }): Promise<unknown>;
};
type ContextEvent = {
  sessionID: string;
  system: unknown[];
  messages: unknown[];
  tools: Record<string, unknown>;
};

interface V2Fixture {
  backend: V2ReviewerBackend;
  run: (command?: string) => Promise<ReviewExecutionResult>;
  state: () => {
    directory: string;
    directories: string[];
    sessionID: string;
    sessionIDs: string[];
    removed: boolean;
    messagesBySession: Map<string, string>;
    prompts: number;
    mcpLists: number;
    mcpTransforms: number;
    disposed: number;
    setups: number;
  };
  mcp: () => Promise<McpListOutput["data"]>;
  reload: () => Promise<void>;
  unrelated: () => Promise<unknown>;
  cleanup: () => Promise<void>;
}

type ActivationRepresentation =
  | "directory-slash"
  | "file-url"
  | "id-only"
  | "id-new-path";

function activationFailure(directory: string): { data: object[] } {
  return {
    data: [
      {
        source: { type: "local", path: `${directory}/index.js` },
        state: { status: "failed", error: "Fixture activation failure" },
      },
    ],
  };
}

function activeReport(
  directory: string,
  pluginID: string,
  { activationRepresentation: representation }: FixtureOptions,
): { data: object[] } {
  const paths: Record<ActivationRepresentation, string | undefined> = {
    "directory-slash": `${directory}/`,
    "file-url": pathToFileURL(`${directory}/index.js`).href,
    "id-new-path": `plugin://${pluginID}`,
    "id-only": undefined,
  };
  const path = representation ? paths[representation] : `${directory}/index.js`;
  const source =
    path === undefined ? { type: "local" } : { type: "local", path };
  return { data: [{ id: pluginID, source, state: { status: "active" } }] };
}

function remote(url: string): McpServer {
  return { type: "remote", url };
}

type FixtureOptions = {
  format?: ReviewerConfig["outputFormat"];
  invalid?: boolean;
  ambiguous?: boolean;
  foreignResponse?: boolean;
  missingModel?: boolean;
  noTools?: boolean;
  variant?: string;
  retain?: boolean;
  wrongLocation?: boolean;
  activationFailed?: boolean;
  failFirstActivation?: boolean;
  activationDelayed?: boolean;
  activationRepresentation?: ActivationRepresentation;
  mcpServers?: boolean | "after-first";
  pluginMcp?: boolean;
};

function fixture(options: FixtureOptions = {}): V2Fixture {
  let tool!: Tool;
  let contextHook!: (event: ContextEvent) => void;
  let toolHook!: (event: { sessionID: string; tool: string }) => void;
  let directory = "";
  const directories: string[] = [];
  let sessionID = "";
  const sessionIDs: string[] = [];
  const removed = new Set<string>();
  const messagesBySession = new Map<string, string>();
  const attempts: ReviewAttempt[] = [];
  let prompts = 0;
  let mcpLists = 0;
  const mcpTransforms: Array<(editor: McpEditor) => void> = [];
  let disposed = 0;
  let checks = 0;
  let setups = 0;
  let pluginID = "";
  let hostCleanup: (() => Promise<void>) | undefined;
  // Registrations made by the current bootstrap setup, which the host disposes on unload.
  const scope: Array<{ dispose(): Promise<void> }> = [];
  const registration = (
    onDispose = (): void => void disposed++,
  ): { dispose: () => Promise<void> } => {
    let active = true;
    const handle = {
      dispose: async (): Promise<void> => {
        if (active) onDispose();
        active = false;
      },
    };
    scope.push(handle);
    return handle;
  };
  const ctx = {
    location: { directory: OPERATIONAL },
    tool: {
      transform: async (
        callback: (editor: { add(definition: Tool): void }) => void,
      ) => {
        callback({
          add: (definition: Tool) => {
            tool = definition;
          },
        });
        return registration();
      },
      hook: async (_name: string, callback: typeof toolHook) => {
        toolHook = callback;
        return registration();
      },
    },
    session: {
      hook: async (_name: string, callback: typeof contextHook) => {
        contextHook = callback;
        return registration();
      },
    },
    mcp: {
      transform: async (callback: (editor: McpEditor) => void) => {
        mcpTransforms.push(callback);
        return registration(
          () => void mcpTransforms.splice(mcpTransforms.indexOf(callback), 1),
        );
      },
    },
  } as unknown as Context;
  const setUp = async (location: string): Promise<() => Promise<void>> => {
    const plugin = await import(pathToFileURL(`${location}/index.js`).href);
    pluginID = plugin.default.id;
    return plugin.default.setup({ ...ctx, location: { directory: location } });
  };
  const client = {
    plugin: {
      list: async (input: { location: { directory: string } }) => {
        directory = input.location.directory;
        checks++;
        if (!directories.includes(directory)) {
          scope.length = 0;
          hostCleanup = await setUp(directory);
          directories.push(directory);
          setups++;
        }
        if (
          options.activationFailed ||
          (options.failFirstActivation && setups === 1)
        )
          return activationFailure(directory);
        if (options.activationDelayed && checks < 3) return { data: [] };
        return activeReport(directory, pluginID, options);
      },
    },
    model: {
      list: async () => ({
        data: options.missingModel
          ? []
          : [
              {
                providerID: "fixture",
                id: "reviewer",
                capabilities: { tools: !options.noTools },
                variants: [{ id: "max" }],
              },
            ],
      }),
    },
    mcp: {
      list: async (input: { location: { directory: string } }) => {
        expect(input.location.directory).toBe(directory);
        mcpLists++;
        const servers = new Map<string, McpServer>();
        const editor: McpEditor = {
          list: () => [...servers],
          get: (name: string) => servers.get(name),
          // The host stores a mutable copy of each config, so the fixture does too.
          set: (name: string, config: McpConfig) =>
            void servers.set(name, structuredClone(config) as McpServer),
          update: () => {},
          remove: (name: string) => void servers.delete(name),
        };
        // A global plugin set up earlier adds a server, as @upstash/context7-opencode does.
        if (options.pluginMcp)
          editor.set("context7", remote("https://mcp.invalid/mcp"));
        for (const transform of mcpTransforms) transform(editor);
        // Added after every transform, so the fail-closed inventory tests still see a server.
        if (
          options.mcpServers === true ||
          (options.mcpServers === "after-first" && mcpLists > 1)
        )
          servers.set("fixture", remote("https://fixture.invalid/mcp"));
        return {
          location: input.location,
          data: [...servers.keys()].map((name) => ({ name })),
        };
      },
    },
    session: {
      create: async (input: {
        id: string;
        location: { directory: string };
        permissions: unknown[];
      }) => {
        sessionID = input.id;
        sessionIDs.push(sessionID);
        expect(input.permissions[0]).toEqual({
          action: "*",
          resource: "*",
          effect: "deny",
        });
        return {
          id: sessionID,
          location: {
            directory: options.wrongLocation ? OPERATIONAL : directory,
          },
        };
      },
      prompt: async ({ sessionID: current }: { sessionID: string }) => {
        prompts++;
        const event: ContextEvent = {
          sessionID: current,
          system: ["UNTRUSTED_SYSTEM"],
          messages: ["UNTRUSTED_HISTORY"],
          tools: { permission_reviewer_result: tool, shell: {} },
        };
        contextHook(event);
        messagesBySession.set(current, JSON.stringify(event.messages));
        expect(JSON.stringify(event.system)).not.toContain("UNTRUSTED_SYSTEM");
        expect(JSON.stringify(event.messages)).not.toContain(
          "UNTRUSTED_HISTORY",
        );
        expect(event.tools.shell).toBeUndefined();
        expect(() => toolHook({ sessionID: current, tool: "shell" })).toThrow(
          "Operational tools",
        );
        if (options.format !== "text" && !options.invalid) {
          await tool.execute(tool.input.parse(decision("allow")), {
            sessionID: current,
          });
          if (options.ambiguous)
            await expect(
              tool.execute(decision("deny"), { sessionID: current }),
            ).rejects.toThrow("ambiguous");
        }
        return { id: "inbox_fixture" };
      },
      wait: async () => {},
      context: async () => [
        {
          type: "user",
          id: options.foreignResponse ? "inbox_other" : "inbox_fixture",
          text: "evidence",
        },
        {
          type: "assistant",
          id: "message_result",
          content:
            options.format === "text"
              ? [
                  {
                    type: "text",
                    text: options.invalid
                      ? "not a decision"
                      : JSON.stringify(decision("allow")),
                  },
                ]
              : [
                  {
                    type: "tool",
                    id: "call_result",
                    name: "permission_reviewer_result",
                    state: { status: "completed" },
                  },
                ],
        },
      ],
      interrupt: async () => {},
      remove: async ({ sessionID: current }: { sessionID: string }) => {
        removed.add(current);
      },
      get: async ({ sessionID: current }: { sessionID: string }) => {
        if (removed.has(current)) throw { _tag: "SessionNotFoundError" };
        return { id: current };
      },
    },
  } as unknown as OpenCodeClient;
  const backend = new V2ReviewerBackend(
    ctx,
    config({
      model: "fixture/reviewer",
      variant: options.variant ?? "max",
      outputFormat: options.format ?? "json_schema",
      retainReviewSessions: options.retain ?? false,
    }),
  );
  const envelope: ReviewEnvelope = {
    request: request(),
    directory: OPERATIONAL,
    worktree: OPERATIONAL,
    transcript: "Run printf safe",
    intentHistory: "Run printf safe",
    enrichment: "",
    sshAudit: [],
  };
  return {
    backend,
    run: (command = "Run printf safe"): Promise<ReviewExecutionResult> => {
      const attempt = new ReviewAttempt("generation_fixture", 5000);
      attempts.push(attempt);
      return backend.review(
        { ...envelope, transcript: command, intentHistory: command },
        attempt,
        client,
      );
    },
    state: () => ({
      directory,
      directories: [...directories],
      sessionID,
      sessionIDs,
      removed: removed.has(sessionID),
      messagesBySession,
      prompts,
      mcpLists,
      mcpTransforms: mcpTransforms.length,
      disposed,
      setups,
    }),
    mcp: async (): Promise<McpListOutput["data"]> =>
      (await client.mcp.list({ location: { directory } })).data,
    reload: async (): Promise<void> => {
      await hostCleanup?.();
      await Promise.all(scope.splice(0).map((handle) => handle.dispose()));
      hostCleanup = await setUp(directory);
      setups++;
    },
    unrelated: (): Promise<unknown> => {
      const event: ContextEvent = {
        sessionID: "ses_other",
        system: [],
        messages: [],
        tools: { permission_reviewer_result: tool, shell: {} },
      };
      contextHook(event);
      expect(event.tools.permission_reviewer_result).toBeUndefined();
      expect(event.tools.shell).toBeDefined();
      toolHook({ sessionID: "ses_other", tool: "shell" });
      return tool.execute(decision("allow"), { sessionID: "ses_other" });
    },
    cleanup: async (): Promise<void> => {
      for (const attempt of attempts) attempt.close("cancelled");
      await backend.dispose();
      await Promise.all(
        directories.map((path) => rm(path, { recursive: true, force: true })),
      );
    },
  };
}

async function withFixture(
  options: FixtureOptions,
  body: (harness: V2Fixture) => Promise<void>,
): Promise<void> {
  const harness = fixture(options);
  try {
    await body(harness);
  } finally {
    await harness.cleanup();
  }
}

test.each(["json_schema", "text"] as const)(
  "isolated %s backend preserves scope, variant, and retention",
  (format) =>
    withFixture(
      { format, variant: "max", retain: format === "text" },
      async (harness) => {
        expect((await harness.run()).kind).toBe("allow");
        const state = harness.state();
        expect(state.prompts).toBe(1);
        expect(state.removed).toBe(format !== "text");
        expect(state.disposed).toBe(0);
        expect(harness.backend.owns(state.sessionID)).toBe(false);
        expect(existsSync(`${state.directory}/index.js`)).toBe(true);
        await expect(harness.unrelated()).rejects.toThrow("Not an active");
      },
    ),
);

test.each([
  { name: "invalid structured output", options: { invalid: true } },
  {
    name: "invalid text output",
    options: { format: "text" as const, invalid: true },
  },
  { name: "ambiguous structured output", options: { ambiguous: true } },
  { name: "foreign structured response", options: { foreignResponse: true } },
  {
    name: "foreign text response",
    options: { format: "text" as const, foreignResponse: true },
  },
])("$name never becomes an approval", ({ options }) =>
  withFixture(options, async (harness) => {
    expect((await harness.run()).kind).toBe("escalate");
    expect(harness.state().prompts).toBeLessThanOrEqual(3);
    expect(harness.state().removed).toBe(true);
  }),
);

test("isolation activation waits for the host report and fails loudly", async () => {
  await withFixture({ activationDelayed: true }, async (delayed) => {
    expect((await delayed.run()).kind).toBe("allow");
    expect(delayed.state().prompts).toBe(1);
    expect(delayed.state().setups).toBe(1);
  });
  await withFixture({ activationFailed: true }, async (failed) => {
    const result = await failed.run();
    expect(result.kind).toBe("escalate");
    expect(result.reason).toContain("failed to activate");
    expect(failed.state().prompts).toBe(0);
  });
});

test("a failed isolation bootstrap is retried in a new location", () =>
  withFixture({ failFirstActivation: true }, async (harness) => {
    const first = await harness.run();
    expect(first.kind).toBe("escalate");
    expect(first.reason).toContain("failed to activate");
    expect(harness.state().directories).toHaveLength(1);
    expect(harness.state().disposed).toBe(3);
    const failedDirectory = harness.state().directory;

    expect((await harness.run()).kind).toBe("allow");
    const recovered = harness.state();
    expect(recovered.setups).toBe(2);
    expect(recovered.disposed).toBe(3);
    expect(recovered.directories).toHaveLength(2);
    expect(recovered.directory).not.toBe(failedDirectory);
    expect(existsSync(`${failedDirectory}/opencode.json`)).toBe(true);
  }));

test("backend disposal releases hooks registered by a later location activation", () =>
  withFixture({}, async (harness) => {
    expect((await harness.run()).kind).toBe("allow");
    await harness.reload();
    expect(harness.state().disposed).toBe(3);
    expect((await harness.run()).kind).toBe("allow");
    await harness.backend.dispose();
    expect(harness.state().disposed).toBe(6);
    expect(existsSync(`${harness.state().directory}/opencode.json`)).toBe(true);
  }));

test.each(["directory-slash", "file-url", "id-only", "id-new-path"] as const)(
  "isolation activation accepts the normalized %s local plugin representation",
  (activationRepresentation) =>
    withFixture({ activationRepresentation }, async (harness) => {
      expect((await harness.run()).kind).toBe("allow");
      expect(harness.state().prompts).toBe(1);
    }),
);

test.each([
  { name: "a missing model", options: { missingModel: true } },
  { name: "a model without tools", options: { noTools: true } },
  { name: "an unsupported variant", options: { variant: "unsupported" } },
  { name: "a wrong isolation location", options: { wrongLocation: true } },
])("$name fails before prompting", ({ options }) =>
  withFixture(options, async (harness) => {
    expect((await harness.run()).kind).toBe("escalate");
    expect(harness.state().prompts).toBe(0);
    expect(existsSync(`${harness.state().directory}/opencode.json`)).toBe(true);
  }),
);

test("review sessions share one MCP-free location without mixing concurrent evidence", () =>
  withFixture({}, async (harness) => {
    const commands = Array.from(
      { length: 16 },
      (_, index) => `Review unique marker[${index}]`,
    );
    const results = await Promise.all(
      commands.map((command) => harness.run(command)),
    );
    expect(results.every((result) => result.kind === "allow")).toBe(true);
    const state = harness.state();
    expect(state.setups).toBe(1);
    expect(new Set(state.sessionIDs).size).toBe(commands.length);
    const captured = state.sessionIDs.map(
      (id) => state.messagesBySession.get(id) ?? "",
    );
    const markers = captured.map((message) => {
      const matches = commands.filter((command) => message.includes(command));
      expect(matches).toHaveLength(1);
      return matches[0];
    });
    expect(new Set(markers)).toEqual(new Set(commands));
    const isolatedConfig = JSON.parse(
      await readFile(`${state.directory}/opencode.json`, "utf8"),
    );
    expect(isolatedConfig.plugins).toEqual([
      "-opencode.config.mcp",
      state.directory,
    ]);
    const extra = await harness.run("Review one more unique marker");
    expect(extra.kind).toBe("allow");
    expect(harness.state().directory).toBe(state.directory);
    expect(harness.state().setups).toBe(1);
    await harness.backend.dispose();
    expect(harness.state().disposed).toBe(3);
    expect(existsSync(`${state.directory}/opencode.json`)).toBe(true);
    expect(() => harness.run()).toThrow("shutting down");
  }));

test("reviewer fails closed when its isolated location contains MCP servers", () =>
  withFixture({ mcpServers: true }, async (harness) => {
    const result = await harness.run();
    expect(result.kind).toBe("escalate");
    expect(result.reason).toContain("contains MCP servers");
    expect(harness.state().sessionIDs).toHaveLength(0);
  }));

test("a later MCP addition prevents another review in the shared location", () =>
  withFixture({ mcpServers: "after-first" }, async (harness) => {
    expect((await harness.run()).kind).toBe("allow");
    const result = await harness.run();
    expect(result.kind).toBe("escalate");
    expect(result.reason).toContain("contains MCP servers");
    expect(harness.state().sessionIDs).toHaveLength(1);
    expect(harness.state().mcpLists).toBe(2);
  }));

test("plugin-added MCP servers are stripped from the isolated location", () =>
  withFixture({ pluginMcp: true }, async (harness) => {
    const result = await harness.run();
    expect(result.kind).toBe("allow");
    expect(result.decisionSource).toBe("llm-reviewer");
    expect(harness.state().mcpTransforms).toBe(1);
    expect(harness.state().sessionIDs).toHaveLength(1);
  }));

test("an inert bootstrap reload keeps stripping MCP after the backend releases it", () =>
  withFixture({ pluginMcp: true }, async (harness) => {
    expect((await harness.run()).kind).toBe("allow");
    await harness.backend.dispose();
    await harness.reload();
    expect(harness.state().mcpTransforms).toBe(1);
    expect(await harness.mcp()).toEqual([]);
  }));
