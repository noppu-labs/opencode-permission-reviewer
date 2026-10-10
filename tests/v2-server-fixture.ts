// The V2 server harness: a fake plugin context and services around
// setupWithServices, with handles to drive host events, tool hooks and reviews.
import { afterEach, spyOn } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import type { normalizeV2Permission } from "../src/opencode/v2/permission-codec.ts";
import { setupWithServices } from "../src/opencode/v2/server.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../src/types.ts";
import { config, decision, defined } from "./helpers.ts";
import { hostEventStream } from "./v2-host-event-stream.ts";

export type Input = Parameters<typeof normalizeV2Permission>[0] & {
  message?: string;
};
type ServerRpc = {
  identity(): Promise<string>;
  status(): Promise<Record<string, unknown>>;
  snapshot(): Promise<{ reviews: unknown[] }>;
};
export interface ServerFixture {
  evaluate: (value: Input) => Promise<void>;
  input: (sessionID?: string) => Input;
  rpc: ServerRpc;
  directory: string;
  reviews: () => number;
  /** Resolves once the backend has started `count` reviews. */
  started: (count: number) => Promise<void>;
  registrationDisposals: () => number;
  endEvents: () => void;
  event: (sessionID: string, location?: string) => void;
  send: (event: unknown) => void;
  failEvents: (error: Error) => void;
  tool: (name: string, event: unknown) => void;
  dispose: () => Promise<void>;
  records: () => Promise<Record<string, unknown>[]>;
  cleanup: () => Promise<void>;
}

export interface FixtureOptions {
  result?: ReviewExecutionResult;
  delay?: Promise<void>;
  connectionError?: boolean;
  budget?: number;
  hostVersion?: string;
  config?: Partial<ReviewerConfig>;
  emit?: (name: string, payload: unknown) => Promise<void>;
  inspect?: (evidence: ReviewEnvelope) => void;
  backendDispose?: () => Promise<void>;
}

function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function fixture(
  options: FixtureOptions = {},
): Promise<ServerFixture> {
  const directory = await mkdtemp(join(tmpdir(), "reviewer-server-contract-"));
  const auditPath = join(directory, "audit.jsonl");
  let evaluate!: (input: Input) => Promise<void>;
  let rpc!: ServerRpc;
  const events = hostEventStream();
  const starts = Array.from({ length: 512 }, signal);
  let reviews = 0;
  let registrationDisposals = 0;
  const toolHooks = new Map<string, (event: unknown) => void>();
  const registration = (): { dispose: () => Promise<void> } => ({
    dispose: async (): Promise<void> => {
      registrationDisposals++;
    },
  });
  const ctx = {
    app: { version: options.hostVersion ?? "2.0.3" },
    options: {},
    location: { directory, project: { directory } },
    rpc: {
      register: async (_definition: unknown, handlers: typeof rpc) => {
        rpc = handlers;
        return {
          events: { emit: options.emit ?? (async (): Promise<void> => {}) },
          ...registration(),
        };
      },
    },
    tool: {
      hook: async (name: string, callback: (event: unknown) => void) => {
        toolHooks.set(name, callback);
        return registration();
      },
    },
    permission: {
      hook: async (_name: string, callback: typeof evaluate) => {
        evaluate = callback;
        return registration();
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({
        id: sessionID,
        location: { directory },
        time: { created: 1 },
      }),
    },
    event: { subscribe: events.subscribe },
  } as unknown as Parameters<typeof setupWithServices>[0];
  const client = {
    session: {
      get: ctx.session.get,
      context: async () => [
        {
          type: "user",
          id: "msg_user",
          text: "Run printf safe",
          time: { created: 2 },
        },
      ],
    },
  } as unknown as OpenCodeClient;
  const dispose = await setupWithServices(ctx, {
    loadConfig: () =>
      config({
        audit: true,
        auditPath,
        reviewBudgetMs: options.budget ?? 5000,
        ...options.config,
      }),
    connect: async () => {
      if (options.connectionError)
        throw new Error("Connection identity mismatch");
      return client;
    },
    createBackend: () => ({
      owns: () => false,
      waitForIdle: async () => {},
      dispose: options.backendDispose ?? (async () => {}),
      review: async (evidence: ReviewEnvelope) => {
        starts[reviews]?.resolve();
        reviews++;
        options.inspect?.(evidence);
        await options.delay;
        return (
          options.result ?? {
            kind: "allow",
            reason: "Fixture decision",
            decision: decision("allow"),
            decisionSource: "llm-reviewer",
          }
        );
      },
    }),
  });
  const input = (sessionID = "ses_main"): Input => ({
    action: "shell",
    resources: ["printf *"],
    metadata: { command: "printf safe" },
    sessionID,
    effect: "ask",
  });
  return {
    evaluate: (value: Input): Promise<void> => evaluate(value),
    input,
    rpc,
    directory,
    reviews: (): number => reviews,
    started: (count: number): Promise<void> =>
      defined(starts[count - 1], "review start").promise,
    registrationDisposals: (): number => registrationDisposals,
    endEvents: events.end,
    event: (sessionID: string, location = directory): void =>
      events.push({
        type: "session.execution.interrupted",
        data: { sessionID },
        location: { directory: location },
      } as OpenCodeEvent),
    send: (event: unknown): void => events.push(event as OpenCodeEvent),
    failEvents: events.fail,
    tool: (name: string, event: unknown): void => toolHooks.get(name)?.(event),
    dispose,
    records: async (): Promise<Record<string, unknown>[]> =>
      (await readFile(auditPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    cleanup: async (): Promise<void> => {
      await dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Starts a review on the default input and waits until the backend holds it. */
export async function pendingReview(
  harness: ServerFixture,
): Promise<{ input: Input; work: Promise<void> }> {
  const input = harness.input();
  const work = harness.evaluate(input);
  await harness.started(1);
  return { input, work };
}

/** Per-test harness bookkeeping for a test file: harnesses it starts, review
 *  delays it holds and console spies it installs are released after each test. */
export function lifecycle(): {
  start: (options?: FixtureOptions) => Promise<ServerFixture>;
  held: () => Promise<void>;
  release: () => void;
  quietErrors: () => ReturnType<typeof spyOn<Console, "error">>;
} {
  const harnesses: ServerFixture[] = [];
  const releases: Array<() => void> = [];
  const restores: Array<() => void> = [];
  const release = (): void =>
    releases.splice(0).forEach((done) => {
      done();
    });
  afterEach(async () => {
    release();
    await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
    restores.splice(0).forEach((restore) => {
      restore();
    });
  });
  return {
    start: async (options: FixtureOptions = {}): Promise<ServerFixture> => {
      const harness = await fixture(options);
      harnesses.push(harness);
      return harness;
    },
    held: (): Promise<void> =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
    release,
    quietErrors: (): ReturnType<typeof spyOn<Console, "error">> => {
      const errors = spyOn(console, "error").mockImplementation(() => {});
      restores.push(() => errors.mockRestore());
      return errors;
    },
  };
}
