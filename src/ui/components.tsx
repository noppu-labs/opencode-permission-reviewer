/** @jsxImportSource @opentui/solid */

import type { ColorInput } from "@opentui/core";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { ReviewUiStatus } from "../ui-protocol.ts";

export interface ReviewTheme {
  backgroundPanel: ColorInput;
  text: ColorInput;
  textMuted: ColorInput;
  info: ColorInput;
  success: ColorInput;
  error: ColorInput;
}
export const SPINNER = ["◐", "◓", "◑", "◒"] as const;

/** Collapses line breaks and tabs so a value renders on one row. */
export const singleLine = (value: string): string =>
  value.replace(/[\r\n\t]+/g, " ");

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
            · {singleLine(props.status.model)} ·{" "}
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
        {singleLine(props.status.action)}
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
