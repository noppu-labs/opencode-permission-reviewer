import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setGlobalConfigPathForTests } from "../src/config/loader.ts";
import { server } from "../src/index.ts";
import { MockClient, request } from "./helpers.ts";

/**
 * Characterises the V1 plugin entry's host version probe: the raw client's
 * health route, its 2 s bound, and the version that reaches the audit record.
 */

type Get = (options: { url: string; signal: AbortSignal }) => Promise<unknown>;

const roots: string[] = [];
afterEach(async () => {
  setGlobalConfigPathForTests(undefined);
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

// /tmp/opencode is one of the plugin's approved enrichment roots; it does not
// exist on a fresh CI runner.
beforeAll(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
});

async function auditConfig(): Promise<string> {
  const root = await mkdtemp("/tmp/reviewer-entry-probe-");
  roots.push(root);
  const auditPath = join(root, "audit.jsonl");
  const config = join(root, "permission-reviewer.jsonc");
  await writeFile(
    config,
    JSON.stringify({
      model: "openai/gpt-5.6-luna",
      variant: "max",
      audit: true,
      auditPath,
    }),
  );
  setGlobalConfigPathForTests(config);
  return auditPath;
}

/** Starts the plugin, reviews one permission and returns its audit record. */
async function review(
  raw: Record<string, unknown>,
): Promise<{ record: Record<string, unknown>; keys: string[] }> {
  const auditPath = await auditConfig();
  const client = new MockClient();
  // The second status publish is the review's terminal state.
  const published = Promise.withResolvers<void>();
  let publishes = 0;
  const post = (): Promise<{ data: boolean }> => {
    publishes++;
    if (publishes === 2) published.resolve();
    return Promise.resolve({ data: true });
  };
  const hooks = await server(
    {
      client: {
        session: client.session,
        tool: client.tool,
        mcp: client.mcp,
        _client: { post, ...raw },
      },
      directory: "/workspace/project",
      worktree: "/workspace/project",
    } as never,
    {},
  );
  await hooks.event?.({
    event: { type: "permission.asked", properties: request() } as never,
  });
  await published.promise;
  // Disposal waits for the in-flight review, its audit write included.
  await hooks.dispose?.();
  const [line] = (await readFile(auditPath, "utf8")).split("\n");
  return { record: JSON.parse(line ?? "{}"), keys: Object.keys(hooks) };
}

describe("V1 plugin entry host version probe", () => {
  test("asks the raw client's health route, as a method call with an abort signal, and audits the version", async () => {
    const calls: Array<{ self: unknown; url: string; signal: unknown }> = [];
    const raw: { get: Get } = {
      get(options: { url: string; signal: AbortSignal }): Promise<unknown> {
        calls.push({ self: this, url: options.url, signal: options.signal });
        return Promise.resolve({ data: { version: "1.18.35" } });
      },
    };
    const { record, keys } = await review(raw);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("/global/health");
    expect(call?.signal).toBeInstanceOf(AbortSignal);
    // `this` is the raw client the plugin received, so get ran as its method.
    const self = call?.self as { get?: unknown; post?: unknown } | undefined;
    expect(self?.get).toBe(raw.get);
    expect(self?.post).toBeFunction();
    expect(record.hostVersion).toBe("1.18.35");
    expect(keys).toEqual(["event", "dispose"]);
  });

  test.each([
    ["has no get", {}],
    ["fails", { get: (): Promise<never> => Promise.reject(new Error("down")) }],
    [
      "answers without a version",
      { get: (): Promise<unknown> => Promise.resolve({}) },
    ],
    [
      "answers with an empty version",
      {
        get: (): Promise<unknown> => Promise.resolve({ data: { version: "" } }),
      },
    ],
  ])("audits an unknown host version when the probe %s", async (_name, raw) => {
    const { record } = await review(raw);
    expect(record.hostVersion).toBe("unknown");
  });

  test("gives up on a probe that never answers after 2 s", async () => {
    const started = Date.now();
    const { record } = await review({
      get: (): Promise<never> => new Promise<never>(() => {}),
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    expect(record.hostVersion).toBe("unknown");
  }, 10_000);
});
