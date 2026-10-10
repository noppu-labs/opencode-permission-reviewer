// The host hooks a review depends on besides the permission hook: the tool
// hooks that retain each call's exact input (and the action snapshot that
// reads it), and the host event stream that feeds ask decisions and cancels
// the reviews of an interrupted or deleted session.
import type { OpenCodeEvent } from "@opencode/client";
import type { PermissionEvaluation } from "@opencode/plugin/promise/permission";
import type { Context, ServerState } from "./server-state.ts";

type HostEvents = ReturnType<Context["event"]["subscribe"]>;
type HostEvent = HostEvents extends AsyncIterable<infer Event> ? Event : never;

interface ToolCall {
  readonly sessionID: string;
  readonly messageID: string;
  readonly id: string;
  readonly input: unknown;
}

export function toolKey(
  sessionID: string,
  messageID: string,
  id: string,
): string {
  return `${sessionID}:${messageID}:${id}`;
}

/** The pending action as the review saw it, with the exact tool input the
 *  tool hooks retain for it. */
export function snapshotAction(
  state: Pick<ServerState, "tools">,
  input: PermissionEvaluation,
): string {
  return JSON.stringify({
    sessionID: input.sessionID,
    action: input.action,
    agent: input.agent,
    resources: input.resources,
    metadata: input.metadata,
    source: input.source,
    exact: input.source
      ? state.tools.get(
          toolKey(input.sessionID, input.source.messageID, input.source.id),
        )?.input
      : undefined,
  });
}

const CANCELLING_EVENTS = new Set([
  "session.execution.interrupted",
  "session.deleted",
]);

function rememberToolCall(state: ServerState, event: ToolCall): void {
  if (state.tools.size >= 512) {
    const oldest = state.tools.keys().next();
    if (!oldest.done) state.tools.delete(oldest.value);
  }
  // Retain the event object so subsequent hooks' input replacement is visible.
  state.tools.set(toolKey(event.sessionID, event.messageID, event.id), event);
}

export async function registerToolHooks(state: ServerState): Promise<void> {
  state.registrations.push(
    await state.ctx.tool.hook("execute.before", (event) => {
      rememberToolCall(state, event);
    }),
  );
  state.registrations.push(
    await state.ctx.tool.hook("execute.after", (event) => {
      state.tools.delete(toolKey(event.sessionID, event.messageID, event.id));
    }),
  );
}

function observeHostEvent(state: ServerState, event: HostEvent): void {
  // The setup context is typed by the oldest supported host SDK while
  // reviewer events use the client library; the fields read here are
  // stable across the supported range.
  state.askDecisions?.observe(
    event as unknown as OpenCodeEvent,
    state.directory,
  );
  if ("location" in event && event.location?.directory !== state.directory)
    return;
  if (!CANCELLING_EVENTS.has(event.type)) return;
  const data = (event as unknown as { data?: { sessionID?: string } }).data;
  for (const request of state.requests.values()) {
    if (request.sessionID === data?.sessionID)
      request.attempt.close("cancelled");
  }
}

/** Follows the host event stream until it ends or fails. Without it no review
 *  can learn of a cancellation, so every pending review then closes unless the
 *  server is already shutting down. */
export function watchHostEvents(state: ServerState): Promise<void> {
  return (async () => {
    for await (const event of state.ctx.event.subscribe({
      signal: state.subscription.signal,
    }))
      observeHostEvent(state, event);
  })()
    .catch((error) => {
      if (!state.subscription.signal.aborted)
        state.log("Host event subscription failed", String(error));
    })
    .finally(() => {
      state.eventStreamHealthy = false;
      if (!state.disposed)
        for (const { attempt } of state.requests.values())
          attempt.close("cancelled");
    });
}
