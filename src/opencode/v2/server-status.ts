// The reviewer RPC the TUI reads: the server's identity, status and review
// snapshot, the bounded UI status publication behind `review.updated`, and
// the bounded queue that carries statuses and audit records after a hook.
import type {
  RpcHandlers,
  RpcRegistration,
} from "@opencode/plugin/promise/rpc";
import { ReviewerRpc } from "../../ui/rpc.ts";
import type { ReviewUiStatus } from "../../ui-protocol.ts";
import { withTimeout } from "../transport.ts";
import type { ServerState } from "./server-state.ts";

/** The server state once its reviewer RPC is registered. */
export type ServerRuntime = ServerState & {
  readonly rpc: RpcRegistration<typeof ReviewerRpc>;
};

function capabilities(systemOneReviewer: boolean): {
  structuredTool: boolean;
  text: boolean;
  retention: boolean;
  nativeJsonSchema: boolean;
} {
  return systemOneReviewer
    ? {
        structuredTool: false,
        text: false,
        retention: false,
        nativeJsonSchema: false,
      }
    : {
        structuredTool: true,
        text: true,
        retention: true,
        nativeJsonSchema: false,
      };
}

function statusHandlers(state: ServerState): RpcHandlers<typeof ReviewerRpc> {
  const { config, systemOneReviewer } = state;
  return {
    identity: async () => state.identity,
    status: async () => ({
      host: "v2",
      hostVersion: state.ctx.app.version,
      generation: state.generation,
      directory: state.directory,
      adapter: "permission.evaluate",
      backend: systemOneReviewer ? "system-one" : "v2-isolated-session",
      active: !state.disposed,
      pending: state.requests.size,
      revision: state.revision,
      outputFormat: systemOneReviewer ? "system_one" : config.outputFormat,
      model: config.model,
      escalationReviewerModel: config.escalationReviewer?.model,
      variant: systemOneReviewer ? "system-one" : config.variant,
      configDegraded: config.configDegraded ?? [],
      configWarnings: config.configWarnings ?? [],
      effectiveConfigHash: state.effectiveConfigHash,
      connection: state.connectionState,
      eventConnection: state.eventStreamHealthy ? "connected" : "unavailable",
      capabilities: capabilities(systemOneReviewer),
    }),
    snapshot: async () => ({
      generation: state.generation,
      revision: state.revision,
      directory: state.directory,
      reviews: [...state.statuses.values()],
    }),
  };
}

export async function registerStatusRpc(
  state: ServerState,
): Promise<ServerRuntime> {
  const rpc = await state.ctx.rpc.register(ReviewerRpc, statusHandlers(state));
  state.registrations.push(rpc);
  return Object.assign(state, { rpc });
}

export async function publishStatus(
  server: ServerRuntime,
  status: ReviewUiStatus,
): Promise<void> {
  server.statuses.set(status.requestID, status);
  if (server.statuses.size > 256) {
    const removable = [...server.statuses.keys()].find(
      (id) => !server.requests.has(id),
    );
    if (removable) server.statuses.delete(removable);
  }
  server.revision++;
  await withTimeout(
    server.rpc.events.emit("review.updated", {
      generation: server.generation,
      revision: server.revision,
      directory: server.directory,
      status,
    }),
    1000,
  ).catch((error) => {
    if (server.config.debug)
      server.log("UI event publication failed", String(error));
  });
}

/** Queues presentation or audit work that must never delay a hook; past
 *  256 pending operations new ones are dropped and logged. */
export function notify(
  state: Pick<ServerState, "notifications" | "log">,
  operation: () => Promise<unknown>,
): void {
  if (state.notifications.size >= 256) {
    state.log("Review notification capacity exhausted; notification omitted");
    return;
  }
  const pending = Promise.resolve()
    .then(operation)
    .catch((error) => state.log("Review notification failed", String(error)))
    .finally(() => state.notifications.delete(pending));
  state.notifications.add(pending);
}
