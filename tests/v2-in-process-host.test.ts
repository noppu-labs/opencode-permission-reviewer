import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "@opencode/plugin";
import type { V2HostApi } from "../src/opencode/v2/host-api.ts";
import { createInProcessHost } from "../src/opencode/v2/in-process-host.ts";
import {
  forgetIsolatedContext,
  isolatedContext,
  rememberIsolatedContext,
} from "../src/opencode/v2/isolated-contexts.ts";
import { openReviewerLocation } from "../src/opencode/v2/v2-review-location.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

const HOST_LOCATION = "/workspace/operational";

test("isolated contexts canonicalize both spellings of a temp directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-reviewer-test-"));
  try {
    const canonical = realpathSync.native(directory);
    const ctx = { location: { directory } } as unknown as Context;
    rememberIsolatedContext(directory, ctx);
    expect(isolatedContext(directory)).toBe(ctx);
    expect(isolatedContext(canonical)).toBe(ctx);
    forgetIsolatedContext(canonical);
    expect(isolatedContext(directory)).toBeUndefined();
    rememberIsolatedContext(canonical, ctx);
    expect(isolatedContext(directory)).toBe(ctx);
    forgetIsolatedContext(directory);
    expect(isolatedContext(canonical)).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("isolated contexts fall back to resolved paths when realpath fails", () => {
  const directory = join(tmpdir(), "opencode-reviewer-missing");
  const ctx = { location: { directory } } as unknown as Context;
  rememberIsolatedContext(directory, ctx);
  expect(isolatedContext(directory)).toBe(ctx);
  forgetIsolatedContext(directory);
  expect(isolatedContext(directory)).toBeUndefined();
});

function recordingHost(): {
  host: V2HostApi;
  calls: Array<{ name: string; input: unknown }>;
} {
  const calls: Array<{ name: string; input: unknown }> = [];
  const record =
    (name: string) =>
    async (input: unknown): Promise<{ forwarded: string }> => {
      calls.push({ name, input });
      return { forwarded: name };
    };
  const ctx = {
    location: { directory: HOST_LOCATION },
    session: {
      create: record("session.create"),
      get: record("session.get"),
      context: record("session.context"),
      prompt: record("session.prompt"),
      wait: record("session.wait"),
      interrupt: record("session.interrupt"),
      remove: record("session.remove"),
    },
    mcp: { list: record("mcp.list") },
    model: {
      list: async () => ({ location: { directory: HOST_LOCATION }, data: [] }),
    },
    plugin: {
      list: async () => ({ location: { directory: HOST_LOCATION }, data: [] }),
    },
  } as unknown as Context;
  return { host: createInProcessHost(ctx), calls };
}

test("in-process host forwards session methods and mcp.list unchanged", async () => {
  const { host, calls } = recordingHost();
  const createInput = { location: { directory: "/workspace" }, options: {} };
  const getInput = { sessionID: "ses_1" };
  const contextInput = { sessionID: "ses_1" };
  const promptInput = {
    sessionID: "ses_1",
  } as unknown as Parameters<typeof host.session.prompt>[0];
  const waitInput = { sessionID: "ses_1" };
  const interruptInput = { sessionID: "ses_1" };
  const removeInput = { sessionID: "ses_1" };
  const createOut: unknown = await host.session.create(createInput);
  expect(createOut).toEqual({ forwarded: "session.create" });
  const getOut: unknown = await host.session.get(getInput);
  expect(getOut).toEqual({ forwarded: "session.get" });
  const contextOut: unknown = await host.session.context(contextInput);
  expect(contextOut).toEqual({ forwarded: "session.context" });
  const promptOut: unknown = await host.session.prompt(promptInput);
  expect(promptOut).toEqual({ forwarded: "session.prompt" });
  const waitOut: unknown = await host.session.wait(waitInput);
  expect(waitOut).toEqual({ forwarded: "session.wait" });
  const interruptOut: unknown = await host.session.interrupt(interruptInput);
  expect(interruptOut).toEqual({ forwarded: "session.interrupt" });
  const removeOut: unknown = await host.session.remove(removeInput);
  expect(removeOut).toEqual({ forwarded: "session.remove" });
  const mcpInput = { location: { directory: "/other" } };
  const mcpOut: unknown = await host.mcp.list(mcpInput);
  expect(mcpOut).toEqual({ forwarded: "mcp.list" });
  expect(calls).toEqual([
    { name: "session.create", input: createInput },
    { name: "session.get", input: getInput },
    { name: "session.context", input: contextInput },
    { name: "session.prompt", input: promptInput },
    { name: "session.wait", input: waitInput },
    { name: "session.interrupt", input: interruptInput },
    { name: "session.remove", input: removeInput },
    { name: "mcp.list", input: mcpInput },
  ]);
});

test("in-process host model.list uses the isolated ctx's inventory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-reviewer-test-"));
  try {
    const models = [{ id: "model_a" }];
    const modelCalls: Array<unknown[]> = [];
    const isolated = {
      location: { directory },
      model: {
        list: async (...args: unknown[]) => {
          modelCalls.push(args);
          return { location: { directory }, data: models };
        },
      },
    } as unknown as Context;
    rememberIsolatedContext(directory, isolated);
    const { host } = recordingHost();
    const out: unknown = await host.model.list({
      location: { directory: realpathSync.native(directory) },
    });
    expect(out).toEqual({ location: { directory }, data: models });
    expect(modelCalls).toEqual([[]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("in-process host model.list requires the isolated location", async () => {
  const { host } = recordingHost();
  await expect(host.model.list()).rejects.toThrow(
    "Reviewer host call requires the isolated location",
  );
  await expect(host.model.list({})).rejects.toThrow(
    "Reviewer host call requires the isolated location",
  );
});

test("in-process host model.list throws before the isolated ctx registers", async () => {
  const { host } = recordingHost();
  await expect(
    host.model.list({ location: { directory: "/nowhere" } }),
  ).rejects.toThrow("Reviewer isolated location is not active");
});

test("in-process host plugin.list resolves empty until the isolated ctx registers", async () => {
  const { host } = recordingHost();
  const out = await host.plugin.list({
    location: { directory: "/nowhere" },
  });
  expect(out).toEqual({ location: { directory: HOST_LOCATION }, data: [] });
});

test("in-process host plugin.list uses the isolated ctx's inventory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-reviewer-test-"));
  try {
    const plugins = [{ source: { type: "local", path: "/p" } }];
    const pluginCalls: Array<unknown[]> = [];
    const isolated = {
      location: { directory },
      plugin: {
        list: async (...args: unknown[]) => {
          pluginCalls.push(args);
          return { location: { directory }, data: plugins };
        },
      },
    } as unknown as Context;
    rememberIsolatedContext(directory, isolated);
    const { host } = recordingHost();
    const out: unknown = await host.plugin.list({
      location: { directory: realpathSync.native(directory) },
    });
    expect(out).toEqual({ location: { directory }, data: plugins });
    expect(pluginCalls).toEqual([[]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("in-process host plugin.list requires the isolated location", async () => {
  const { host } = recordingHost();
  await expect(host.plugin.list()).rejects.toThrow(
    "Reviewer host call requires the isolated location",
  );
  await expect(host.plugin.list({})).rejects.toThrow(
    "Reviewer host call requires the isolated location",
  );
});

function bootstrapContext(directory: string): Context {
  return {
    location: { directory },
    mcp: {
      transform: async (
        callback: (editor: {
          list(): [string, unknown][];
          remove(name: string): void;
        }) => void,
      ) => {
        callback({
          list: () => [],
          remove: (_name: string) => {},
        });
        return async (): Promise<void> => {};
      },
    },
  } as unknown as Context;
}

function isolationClient(
  drive: (directory: string) => Promise<void>,
  data: (directory: string) => object[],
): { client: V2HostApi; directories: string[] } {
  const directories: string[] = [];
  const client = {
    plugin: {
      list: async (input?: { location?: { directory?: string } }) => {
        const directory = input?.location?.directory ?? "";
        directories.push(directory);
        await drive(directory);
        return {
          location: { directory },
          data: data(directory),
        };
      },
    },
  } as unknown as V2HostApi;
  return { client, directories };
}

test("openReviewerLocation remembers the isolated ctx until release", async () => {
  let activated = false;
  let registered: Context | undefined;
  const { client, directories } = isolationClient(
    async (directory) => {
      if (activated) return;
      activated = true;
      const module = await import(
        pathToFileURL(join(directory, "index.js")).href
      );
      await module.default.setup(bootstrapContext(directory));
    },
    (directory) => [
      {
        source: { type: "local", path: join(directory, "index.js") },
        state: { status: "active" },
      },
    ],
  );
  const owner = {
    closing: () => false,
    register: async (ctx: Context) => {
      registered = ctx;
      return async (): Promise<void> => {};
    },
    signal: new AbortController().signal,
  };
  const location = await openReviewerLocation(client, owner);
  const directory = directories[0];
  if (!directory)
    throw new Error("client never received an isolated directory");
  try {
    expect(isolatedContext(directory)).toBe(registered);
    expect(String(registered?.location.directory)).toBe(directory);
  } finally {
    location.release();
  }
  expect(isolatedContext(directory)).toBeUndefined();
});

test("openReviewerLocation forgets the isolated ctx when activation fails", async () => {
  let activated = false;
  const { client, directories } = isolationClient(
    async (directory) => {
      if (activated) return;
      activated = true;
      const module = await import(
        pathToFileURL(join(directory, "index.js")).href
      );
      await module.default.setup(bootstrapContext(directory));
    },
    (directory) => [
      {
        source: { type: "local", path: join(directory, "index.js") },
        state: { status: "failed", error: "Fixture activation failure" },
      },
    ],
  );
  const owner = {
    closing: () => false,
    register: async (_ctx: Context) => async (): Promise<void> => {},
    signal: new AbortController().signal,
  };
  await expect(openReviewerLocation(client, owner)).rejects.toThrow(
    "Reviewer isolation failed to activate: Fixture activation failure",
  );
  const directory = directories[0];
  if (!directory)
    throw new Error("client never received an isolated directory");
  expect(isolatedContext(directory)).toBeUndefined();
});
