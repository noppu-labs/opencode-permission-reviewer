import {
  createUiStatus,
  type ReviewUiPhase,
  type ReviewUiStatus,
} from "../src/modules/status/models/ui-protocol.ts";
import { defined, request } from "./helpers.ts";

/**
 * Fake V2 TUI host state and payload builders for the reviewer feed tests
 * (tui-v2-feed.test.ts and tui-v2-routes.test.ts). The tests observe the
 * plugin only through what it touches on the host: the rendered slot, toasts,
 * the keymap mode, snapshot calls and event subscriptions.
 */

export const DIRECTORY = "/workspace/fixture";
export const SECOND = "/workspace/second";

export interface Channel {
  signal: AbortSignal;
  queue: unknown[];
  ended: boolean;
  /** Yield queued events even after the subscription is aborted. */
  drain: boolean;
  wake?: () => void;
}

export interface Host {
  route: { type: "session"; sessionID: string } | { type: "home" };
  /** What the host returns for the routed session. */
  session: { location: { directory: string } } | undefined;
  location: { directory: string } | undefined;
  /** Directory of every snapshot request, in call order. */
  snapshots: string[];
  /** The `status` RPC's answer per directory; unset rejects like an older server. */
  status?: (directory: string) => unknown;
  /** Directory of every status request, in call order. */
  statusCalls: string[];
  /** One responder per snapshot request; an empty snapshot once exhausted. */
  respond: Array<(directory: string) => unknown>;
  channels: Channel[];
  toasts: Array<{ variant?: string; title?: string; message?: string }>;
  mode: { depth: number; throws: boolean };
}

export function host(overrides: Partial<Host> = {}): Host {
  return {
    route: { type: "session", sessionID: "ses_main" },
    session: { location: { directory: DIRECTORY } },
    location: { directory: DIRECTORY },
    snapshots: [],
    statusCalls: [],
    respond: [],
    channels: [],
    toasts: [],
    mode: { depth: 0, throws: false },
    ...overrides,
  };
}

/** Moves both the routed session and the host location to `directory`. */
export function moveTo(state: Host, directory: string): void {
  state.location = { directory };
  state.session = { location: { directory } };
}

export function status(
  phase: ReviewUiPhase,
  options: { id?: string; emittedAt?: number; reason?: string } = {},
): ReviewUiStatus {
  const { id = "per_1", emittedAt = Date.now(), reason } = options;
  const base = createUiStatus(request({ id }), phase, {
    model: "fixture/reviewer",
    variant: "max",
    timeoutMs: 10_000,
    emittedAt,
  });
  return reason === undefined ? base : { ...base, reason };
}

export function snapshot(
  reviews: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = { directory: DIRECTORY, generation: "generation_one" };
  return { ...base, revision: 1, reviews, ...extra };
}

export function event(
  data: Record<string, unknown> | null,
  directory = DIRECTORY,
): { location: { directory: string }; data: unknown } {
  return { location: { directory }, data };
}

export function update(
  revision: unknown,
  value: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = { directory: DIRECTORY, generation: "generation_one" };
  return { ...base, revision, status: value, ...extra };
}

/** A promise the test settles by hand. */
export interface Gate {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function gate(): Gate {
  return Promise.withResolvers<unknown>();
}

export function latest(state: Host): Channel {
  return defined(state.channels.at(-1), "latest channel");
}

export function push(channel: Channel, ...events: unknown[]): void {
  channel.queue.push(...events);
  channel.wake?.();
}
