/** @jsxImportSource @opentui/solid */
import type { PluginOptions } from "@opencode-ai/plugin";
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import { loadResolvedConfig } from "./config/loader.ts";
import { reviewBudgetMs } from "./config.ts";
// Import the normalizer directly: `./index.ts` re-exports it, but importing that
// would evaluate the whole server engine (git/ssh evidence, `node:child_process`)
// inside the TUI process.
import { extractPermissionRequest } from "./opencode/event-normalizer.ts";
import { ConfigNoticeSlot, SPINNER } from "./ui/components.tsx";
import { ReviewOverlay } from "./ui/review-overlay.tsx";
import { ReviewResult } from "./ui/review-result.tsx";
import { activeStatus, createV1Host } from "./ui/v1-host.ts";
import { setupTuiV2 } from "./ui/v2.tsx";
import type { ReviewUiStatus } from "./ui-protocol.ts";
import { ReviewUiState } from "./ui-state.ts";

const REVIEW_MODE = "permission-reviewer";

export const tui: TuiPlugin = async (
  api: TuiPluginApi,
  options: PluginOptions | undefined,
) => {
  // The server's own view: it loads inline options as unknown origin, so the
  // TUI budget and model match it, and routing warnings come from its statuses
  // instead of a trusted-inline view the server does not use.
  const config = loadResolvedConfig(options, undefined, "unknown", {
    printConfigWarnings: false,
  });
  const state = new ReviewUiState({
    model: config.model,
    variant: config.variant,
    timeoutMs: reviewBudgetMs(config),
  });
  const host = createV1Host(api, state, config.escalationReviewer?.model);

  // Signal bumps whenever the UI state changes. Both slot factories read it
  // directly in their bodies, which makes the host re-render each panel:
  // a factory that only returns a component without reading any signal in its
  // own scope renders exactly once at boot and never updates again.
  const [revision, setRevision] = createSignal(0);
  const [frame, setFrame] = createSignal(0);
  const touch = (): void => {
    syncMode();
    setRevision((value) => value + 1);
  };

  const active = (): ReviewUiStatus | undefined => activeStatus(api, state);

  let popMode: (() => void) | undefined;
  const syncMode = (): void => {
    const status = active();
    const wanted = status?.phase === "reviewing";
    if (wanted && popMode === undefined) {
      try {
        popMode = api.mode.push(REVIEW_MODE);
      } catch {
        // mode.push can throw if the host rejects unknown modes; keep the panel.
      }
    } else if (!wanted && popMode !== undefined) {
      popMode();
      popMode = undefined;
    }
  };

  api.event.on("permission.asked", (event) => {
    const request = extractPermissionRequest(event);
    if (!request) return;
    state.asked(request);
    touch();
  });
  api.event.on("permission.replied", (event) => {
    state.replied(event.properties.requestID);
    touch();
  });
  api.event.on("tui.command.execute", (event) => {
    if (host.apply(event.properties.command)) touch();
  });

  // Keep watchdog and result expiry running even when the UI is hidden.
  const ticker = setInterval(() => {
    if (active()?.phase === "reviewing")
      setFrame((value) => (value + 1) % SPINNER.length);
    const expired = state.expire();
    const dismissed = state.dismissResults();
    if (expired.length > 0 || dismissed.length > 0) touch();
  }, 250);

  api.lifecycle.onDispose(() => {
    clearInterval(ticker);
    popMode?.();
    popMode = undefined;
  });

  api.slots.register({
    order: 1_000,
    slots: {
      app(): JSX.Element {
        // Load-bearing direct read: it subscribes the slot's render pass to
        // every state transition (touch), so the factory re-runs and renders
        // the current status. The spinner frame is deliberately NOT read here
        // (only inside the panel's text children) so 250ms ticks update those
        // texts without re-running this factory.
        revision();
        const status = active();
        syncMode();
        return (
          <Show when={status?.phase === "reviewing" ? status : undefined} keyed>
            {(current: ReviewUiStatus) => (
              <ReviewOverlay
                theme={() => api.theme.current}
                status={current}
                frame={frame}
              />
            )}
          </Show>
        );
      },
      app_bottom(): JSX.Element {
        revision();
        const status = active();
        syncMode();
        return (
          <Show
            when={
              status?.phase === "approved" ||
              status?.phase === "denied" ||
              status?.phase === "unknown"
                ? status
                : undefined
            }
            keyed
          >
            {(current: ReviewUiStatus) => (
              <ReviewResult theme={() => api.theme.current} status={current} />
            )}
          </Show>
        );
      },
      sidebar_content(): JSX.Element {
        revision();
        return (
          <ConfigNoticeSlot
            theme={() => api.theme.current}
            line={host.sidebar()}
          />
        );
      },
    },
  });
};

const module: { id: string; tui: TuiPlugin; setup: typeof setupTuiV2 } = {
  id: "opencode-permission-reviewer",
  tui,
  setup: setupTuiV2,
};

export default module;
