/** @jsxImportSource @opentui/solid */

import type { ColorInput } from "@opentui/core";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { ReviewUiStatus } from "../ui-protocol.ts";
import { type ReviewTheme, singleLine } from "./components.tsx";

export function ReviewResult(props: {
  theme: () => ReviewTheme;
  status: ReviewUiStatus;
}): JSX.Element {
  const theme = props.theme;
  const appearance = (): { color: ColorInput; icon: string; title: string } => {
    if (props.status.phase === "unknown") {
      return {
        color: theme().textMuted,
        icon: "?",
        title: "Review status unavailable",
      };
    }
    if (props.status.phase === "approved") {
      return { color: theme().success, icon: "✓", title: "Review approved" };
    }
    // Fail-closed escalate→deny is distinct from an explicit reviewer/policy deny.
    if (props.status.escalationDisposition === "deny") {
      return {
        color: theme().error,
        icon: "✕",
        title: "Review blocked (fail-closed)",
      };
    }
    return { color: theme().error, icon: "✕", title: "Review blocked" };
  };
  return (
    <box
      height={props.status.reason ? 2 : 1}
      flexShrink={0}
      overflow="hidden"
      backgroundColor={theme().backgroundPanel}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={appearance().color} wrapMode="none" truncate>
        {appearance().icon} {appearance().title} · {props.status.permission} ·{" "}
        {singleLine(props.status.action)}
      </text>
      <Show when={props.status.reason}>
        <text fg={theme().textMuted} wrapMode="none" truncate>
          {singleLine(props.status.reason ?? "")}
        </text>
      </Show>
    </box>
  );
}
