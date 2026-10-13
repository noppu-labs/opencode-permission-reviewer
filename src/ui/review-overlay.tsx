/** @jsxImportSource @opentui/solid */

import type { MouseEvent } from "@opentui/core";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { ReviewUiStatus } from "../ui-protocol.ts";
import { handoffPhrase, shortModelName } from "./attribution.ts";
import { type ReviewTheme, SPINNER } from "./components.tsx";

export function ReviewOverlay(props: {
  theme: () => ReviewTheme;
  status: ReviewUiStatus;
  /** Spinner signal, read inside text children so only those update per tick. */
  frame: () => number;
}): JSX.Element {
  const theme = props.theme;
  const elapsed = (): string => {
    // Reading the tick signal inside the text child is what re-renders it every
    // 250ms: Date.now() and status.emittedAt are plain values, so a text that
    // reads no signal is evaluated once at mount and freezes.
    props.frame();
    const elapsedMs = Math.max(0, Date.now() - props.status.emittedAt);
    return `${(elapsedMs / 1_000).toFixed(1)}s`;
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: <box> is an OpenTUI terminal renderable, not a DOM element, so the ARIA role rule does not apply
    <box
      position="absolute"
      left={0}
      right={0}
      bottom={0}
      height="auto"
      maxHeight={12}
      overflow="hidden"
      backgroundColor={theme().backgroundPanel}
      border={["left"]}
      borderColor={theme().info}
      flexDirection="column"
      onMouseDown={(event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseUp={(event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <box
        flexDirection="column"
        gap={1}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={3}
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme().info}>
            {SPINNER[props.frame() % SPINNER.length] ?? "◐"}
          </text>
          <text fg={theme().text}>Reviewing this permission</text>
          <box flexGrow={1} />
          <text fg={theme().textMuted}>{elapsed()}</text>
        </box>
        <box flexDirection="row" gap={1} paddingLeft={2}>
          <text fg={theme().textMuted}>{props.status.permission}</text>
          <text fg={theme().text} wrapMode="word">
            {props.status.action}
          </text>
          <Show when={props.status.actorName}>
            <text fg={theme().textMuted}>· actor {props.status.actorName}</text>
          </Show>
        </box>
        <box paddingLeft={2} flexDirection="row" gap={1}>
          <text fg={theme().textMuted}>
            {props.status.handoff
              ? shortModelName(props.status.handoff.to)
              : props.status.model}{" "}
            · reasoning {props.status.variant}
            <Show when={handoffPhrase(props.status)} keyed>
              {(phrase: string) => (
                <span style={{ fg: theme().info }}> · {phrase}</span>
              )}
            </Show>
          </text>
          <box flexGrow={1} />
          <text fg={theme().textMuted}>No action needed</text>
        </box>
      </box>
    </box>
  );
}
