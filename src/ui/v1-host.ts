import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { decodeUiStatus, type ReviewUiStatus } from "../ui-protocol.ts";
import type { ReviewUiState } from "../ui-state.ts";
import type { ConfigNotices } from "./config-notices.ts";
import { manualToast } from "./manual-toast.ts";

const MANUAL_FALLBACK =
  "The reviewer could not decide. This permission now needs your approval.";

function routeSessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current;
  if (route.name !== "session") return;
  const params = "params" in route ? route.params : undefined;
  const sessionID = params?.sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}

function parentSessionID(
  api: TuiPluginApi,
  sessionID: string,
): string | undefined {
  return api.state.session.get(sessionID)?.parentID;
}

function notifyManual(
  api: TuiPluginApi,
  status: ReviewUiStatus,
  reasoningModel?: string,
): void {
  api.ui.toast({
    ...manualToast(status, MANUAL_FALLBACK, reasoningModel),
    duration: 8_000,
  });
}

/** Applies one server status command: the panel state, the manual toast and
 *  the config notices it carries. True when the state changed. */
export function applyCommand(
  api: TuiPluginApi,
  state: ReviewUiState,
  notices: ConfigNotices,
  command: string,
  reasoningModel?: string,
): boolean {
  const status = decodeUiStatus(command);
  if (!status || !state.apply(status)) return false;
  if (status.phase === "manual") notifyManual(api, status, reasoningModel);
  notices.update(status);
  return true;
}

/** The status the V1 panel shows for the routed session, if any. */
export function activeStatus(
  api: TuiPluginApi,
  state: ReviewUiState,
): ReviewUiStatus | undefined {
  const sessionID = routeSessionID(api);
  if (!sessionID) return;
  return state.activeFor(sessionID, (id) => parentSessionID(api, id));
}
