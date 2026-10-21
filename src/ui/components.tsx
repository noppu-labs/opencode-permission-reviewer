/** @jsxImportSource @opentui/solid */

import type { ColorInput } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { ReviewUiStatus } from "../ui-protocol.ts";
import { type ActionFitPart, fitAction, singleLine } from "./action-fit.ts";
import { ActionSpans, stripActionColumns } from "./action-spans.tsx";
import { reviewerLabel } from "./attribution.ts";
import type { SidebarLine } from "./config-notices.ts";

export interface ReviewTheme {
  backgroundPanel: ColorInput;
  text: ColorInput;
  textMuted: ColorInput;
  info: ColorInput;
  success: ColorInput;
  error: ColorInput;
  warning: ColorInput;
}
export const SPINNER = ["◐", "◓", "◑", "◒"] as const;

/** The reviewer's config line in the host sidebar; nothing when healthy. */
export function ConfigNoticeSlot(props: {
  theme: () => ReviewTheme;
  line: SidebarLine | undefined;
}): JSX.Element {
  return (
    <Show when={props.line} keyed>
      {(line: SidebarLine) => (
        <text fg={props.theme()[line.tone]} wrapMode="none" truncate>
          {singleLine(line.text)}
        </text>
      )}
    </Show>
  );
}

/** Compact, non-modal progress strip for hosts with an editable composer. */
export function ReviewProgress(props: {
  theme: () => ReviewTheme;
  status: ReviewUiStatus;
  frame: () => number;
}): JSX.Element {
  const elapsed = (): string => {
    props.frame();
    return `${(Math.max(0, Date.now() - props.status.emittedAt) / 1_000).toFixed(1)}s`;
  };
  const terminal = useTerminalDimensions();
  const actor = (): string =>
    props.status.actorName
      ? ` · actor ${singleLine(props.status.actorName)}`
      : "";
  const action = (): ActionFitPart[] =>
    fitAction(
      props.status,
      stripActionColumns(
        terminal().width,
        `${props.status.permission} · `,
        actor(),
      ),
    );
  return (
    <box
      height={2}
      flexShrink={0}
      overflow="hidden"
      backgroundColor={props.theme().backgroundPanel}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <box height={1} flexDirection="row" gap={1}>
        <text
          fg={props.theme().info}
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
          wrapMode="none"
          truncate
        >
          {SPINNER[props.frame() % SPINNER.length] ?? "◐"} Reviewing this
          permission
          <span style={{ fg: props.theme().textMuted }}>
            {" "}
            · {singleLine(reviewerLabel(props.status))} ·{" "}
            {singleLine(props.status.variant)}
          </span>
        </text>
        <text fg={props.theme().textMuted} flexShrink={0} wrapMode="none">
          {elapsed()}
        </text>
      </box>
      <text fg={props.theme().text} wrapMode="none" truncate>
        <span style={{ fg: props.theme().textMuted }}>
          {props.status.permission} ·{" "}
        </span>
        <ActionSpans
          parts={action()}
          color={props.theme().text}
          muted={props.theme().textMuted}
        />
        <Show when={props.status.actorName}>
          <span style={{ fg: props.theme().textMuted }}>
            {" "}
            · actor {singleLine(props.status.actorName ?? "")}
          </span>
        </Show>
      </text>
    </box>
  );
}
