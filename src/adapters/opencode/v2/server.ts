import { satisfies } from "semver";
import { loadResolvedConfig } from "../../../modules/config/services/loader.ts";
import { SUPPORTED_V2_RANGE } from "../host-guard.ts";
import { withTimeout } from "../transport.ts";
import { createV2ReviewerBackend } from "./backend-factory.ts";
import { resolveV2Host } from "./connection.ts";
import { registerToolHooks, watchHostEvents } from "./server-events.ts";
import { registerPermissionHook } from "./server-permission.ts";
import {
  type Context,
  createServerState,
  type ServerServices,
  type ServerState,
} from "./server-state.ts";
import { registerStatusRpc } from "./server-status.ts";

export async function setup(ctx: Context): Promise<() => Promise<void>> {
  return setupWithServices(ctx, {
    loadConfig: loadResolvedConfig,
    connect: resolveV2Host,
    createBackend: createV2ReviewerBackend,
  });
}

/** Host effects are injectable without changing the plugin entry contract. */
export async function setupWithServices(
  ctx: Context,
  services: ServerServices,
): Promise<() => Promise<void>> {
  if (!satisfies(ctx.app.version, SUPPORTED_V2_RANGE))
    throw new Error(
      `Unsupported OpenCode V2 host ${ctx.app.version}; supported range is ${SUPPORTED_V2_RANGE}`,
    );
  const server = await registerStatusRpc(createServerState(ctx, services));
  await registerToolHooks(server);
  const eventTask = watchHostEvents(server);
  await registerPermissionHook(server);
  return () => shutdown(server, eventTask);
}

async function shutdown(
  state: ServerState,
  eventTask: Promise<void>,
): Promise<void> {
  if (state.cleanupStarted) return;
  state.cleanupStarted = true;
  state.disposed = true;
  state.subscription.abort();
  await Promise.allSettled(
    state.registrations
      .splice(0)
      .reverse()
      .map((registration) =>
        Promise.resolve().then(() => registration.dispose()),
      ),
  );
  for (const { attempt } of state.requests.values()) attempt.close("cancelled");
  await Promise.allSettled(
    [...state.requests.values()].map((request) => request.work),
  );
  await withTimeout(Promise.allSettled([...state.notifications]), 2000).catch(
    (error) =>
      state.log(
        "Review notifications did not finish before shutdown",
        String(error),
      ),
  );
  await withTimeout(state.backend.dispose(), 12_000).catch((error) =>
    state.log("Reviewer shutdown cleanup timed out", String(error)),
  );
  await eventTask;
  state.tools.clear();
  state.statuses.clear();
}
