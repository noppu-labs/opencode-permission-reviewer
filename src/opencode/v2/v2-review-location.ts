import type { Plugin } from "@opencode/plugin";
import type { V2HostApi } from "./host-api.ts";
import {
  forgetIsolatedContext,
  rememberIsolatedContext,
} from "./isolated-contexts.ts";
import { createIsolatedLocation } from "./isolated-location.ts";
import { waitForIsolationActive } from "./v2-isolation-activation.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

export interface ReviewerLocation {
  directory: string;
  dispose(): Promise<void>;
  release(): void;
}

/** The backend state an isolated location activates against. */
interface LocationOwner {
  closing(): boolean;
  register(ctx: Context): Promise<() => Promise<void>>;
  signal: AbortSignal;
}

/** Race a promise against a signal, so a call the host never settles cannot
 *  wedge the location activation. */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Create an isolated location and wait until the host activated its hooks. */
export async function openReviewerLocation(
  client: V2HostApi,
  owner: LocationOwner,
): Promise<ReviewerLocation> {
  const registrations = new Set<() => Promise<void>>();
  const dispose = async (): Promise<void> => {
    const results = await Promise.allSettled(
      [...registrations].map((registration) => registration()),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  };
  const isolated = await createIsolatedLocation(async (context) => {
    if (owner.closing()) return async (): Promise<void> => {};
    rememberIsolatedContext(context.location.directory, context);
    const cleanup = await owner.register(context);
    const registration = async (): Promise<void> => {
      if (!registrations.delete(registration)) return;
      await cleanup();
    };
    registrations.add(registration);
    if (owner.closing()) await registration();
    return registration;
  });
  try {
    const signal = AbortSignal.any([owner.signal, AbortSignal.timeout(15_000)]);
    // The server API loads a location on the first query; the in-process host
    // only sees locations the host has already mounted, so touch this one
    // before polling its plugin inventory. The touch races the same signal as
    // the poll, so a hung mount cannot wedge the activation.
    const touch = await withAbort(
      client.mcp.list(
        { location: { directory: isolated.directory } },
        { signal },
      ),
      signal,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await waitForIsolationActive(
        client,
        isolated.directory,
        isolated.pluginID,
        signal,
      );
      if (registrations.size === 0)
        throw new Error("Reviewer isolation hooks did not activate");
    } catch (error) {
      // Report the mount failure as the cause of the activation failure; keep
      // the activation failure's own message otherwise.
      if (
        touch !== undefined &&
        error instanceof Error &&
        error.cause === undefined &&
        error !== touch
      )
        throw new Error(error.message, { cause: touch });
      throw error;
    }
    return {
      directory: isolated.directory,
      dispose,
      release: (): void => {
        forgetIsolatedContext(isolated.directory);
        isolated.release();
      },
    };
  } catch (error) {
    await dispose().catch(() => {});
    forgetIsolatedContext(isolated.directory);
    isolated.release();
    // The host may have cached this location, so its MCP exclusion stays on disk.
    throw error;
  }
}
