/** @jsxImportSource @opentui/solid */

import type { ColorInput } from "@opentui/core";
import type { JSX } from "solid-js";
import { For } from "solid-js";
import type { ActionFitPart } from "./action-fit.ts";
import { textColumns } from "./fit-parts.ts";

/** Rows the v1 overlay's action may wrap over; with the overlay's six other
 *  rows this stays inside its 12-row cap. */
const OVERLAY_ACTION_ROWS = 3;
/** Overlay action-row columns that are not the permission, the action or the
 *  actor: the left border, the panel's side padding (2 + 3), the row's indent
 *  (2) and the gap after the permission. */
const OVERLAY_ACTION_INSET = 9;

const less = (columns: number, fixed: readonly string[]): number =>
  fixed.reduce(
    (left: number, text: string): number => left - textColumns(text),
    columns,
  );

/** Columns a strip row leaves for the action: the terminal width less the
 *  strip's one-column side padding and the fixed text sharing the row. */
export function stripActionColumns(
  columns: number,
  ...fixed: string[]
): number {
  return less(columns - 2, fixed);
}

export function overlayActionColumns(
  columns: number,
  permission: string,
  actorName: string | undefined,
): number {
  const actor = actorName ? ` · actor ${actorName}` : "";
  return (
    OVERLAY_ACTION_ROWS *
    less(columns - OVERLAY_ACTION_INSET, [permission, actor])
  );
}

/** A fitted action as inline spans: muted parts in `muted`, the rest in
 *  `color`. */
export function ActionSpans(props: {
  parts: ActionFitPart[];
  color: ColorInput;
  muted: ColorInput;
}): JSX.Element {
  return (
    <For each={props.parts}>
      {(part: ActionFitPart): JSX.Element => (
        <span style={{ fg: part.muted ? props.muted : props.color }}>
          {part.text}
        </span>
      )}
    </For>
  );
}
