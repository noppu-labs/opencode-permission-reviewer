/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { createSignal, Show } from "solid-js";
import type { ReviewUiStatus } from "../modules/status/models/ui-protocol.ts";
import {
  ConfigNoticeSlot,
  ReviewProgress,
  type ReviewTheme,
} from "./components.tsx";
import type { SidebarLine } from "./config-notices.ts";
import { createReviewFeed } from "./review-feed.ts";
import { ReviewResult } from "./review-result.tsx";
import { resolveReviewTheme } from "./review-theme.ts";

type Context = Parameters<Plugin.Definition["setup"]>[0];

export async function setupTuiV2(ctx: Context): Promise<() => void> {
  const [revision, touch] = createSignal(0);
  const [frame, tick] = createSignal(0);
  let popMode: (() => void) | undefined;
  let routeSession: string | undefined;
  const feed = createReviewFeed(ctx, () => refresh());
  const active = (): ReviewUiStatus | undefined => {
    revision();
    const route = ctx.ui.router.current();
    return route.type === "session"
      ? feed.state.activeFor(
          route.sessionID,
          (id) => ctx.data.session.get(id)?.parentID,
        )
      : undefined;
  };
  const theme = (): ReviewTheme =>
    resolveReviewTheme((ctx as unknown as { theme?: unknown }).theme);
  const refresh = (): void => {
    touch((value) => value + 1);
    const reviewing = active()?.phase === "reviewing";
    if (reviewing && !popMode) {
      try {
        popMode = ctx.keymap.mode.push("permission-reviewer");
      } catch {
        /* The panel remains useful without a host mode. */
      }
    }
    if (!reviewing && popMode) {
      popMode();
      popMode = undefined;
    }
  };
  void feed.connect();
  const slot = ctx.ui.slot({
    append: "app",
    render: () => {
      const reviewing = () => {
        const status = active();
        return status?.phase === "reviewing" ? status : undefined;
      };
      const terminal = () => {
        const status = active();
        return status &&
          status.phase !== "reviewing" &&
          status.phase !== "manual"
          ? status
          : undefined;
      };
      return (
        <>
          <Show when={reviewing()} keyed>
            {(current: ReviewUiStatus) => (
              <box position="absolute" bottom={0} left={0} right={0}>
                <ReviewProgress theme={theme} status={current} frame={frame} />
              </box>
            )}
          </Show>
          <Show when={terminal()} keyed>
            {(current: ReviewUiStatus) => (
              <box position="absolute" bottom={0} left={0} right={0}>
                <ReviewResult theme={theme} status={current} />
              </box>
            )}
          </Show>
        </>
      );
    },
  });
  const sidebar = ctx.ui.slot({
    append: "sidebar.content",
    render: () => {
      const line = (): SidebarLine | undefined => {
        revision();
        return feed.notices.sidebar();
      };
      return <ConfigNoticeSlot theme={theme} line={line()} />;
    },
  });
  // Refreshes on a session switch, and follows the routed session's directory.
  const followRoute = (): void => {
    const route = ctx.ui.router.current();
    const nextSession = route.type === "session" ? route.sessionID : undefined;
    if (nextSession !== routeSession) {
      routeSession = nextSession;
      refresh();
    }
    const nextDirectory =
      route.type === "session"
        ? (ctx.data.session.get(route.sessionID)?.location.directory ??
          ctx.location?.directory)
        : ctx.location?.directory;
    if (nextDirectory !== feed.directory) feed.retarget(nextDirectory);
  };
  const timer = setInterval(() => {
    tick((value) => value + 1);
    followRoute();
    feed.sweep();
  }, 250);
  return () => {
    feed.stop();
    clearInterval(timer);
    popMode?.();
    slot();
    sidebar();
  };
}
