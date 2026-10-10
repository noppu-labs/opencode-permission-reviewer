import type { OpenCodeClient } from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import { createIsolatedLocation } from "./isolated-location.ts";
import { waitForIsolationActive } from "./v2-isolation-activation.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

export interface ReviewerLocation {
  directory: string;
  dispose(): Promise<void>;
  release(): void;
}

/** The backend state an isolated location activates against. */
export interface LocationOwner {
  closing(): boolean;
  register(ctx: Context): Promise<() => Promise<void>>;
  signal: AbortSignal;
}

/** Create an isolated location and wait until the host activated its hooks. */
export async function openReviewerLocation(
  client: OpenCodeClient,
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
    await waitForIsolationActive(
      client,
      isolated.directory,
      isolated.pluginID,
      signal,
    );
    if (registrations.size === 0)
      throw new Error("Reviewer isolation hooks did not activate");
    return {
      directory: isolated.directory,
      dispose,
      release: isolated.release,
    };
  } catch (error) {
    await dispose().catch(() => {});
    isolated.release();
    // The host may have cached this location, so its MCP exclusion stays on disk.
    throw error;
  }
}
