// Measuring, slicing and merging fitted action parts.

import {
  ELISION,
  elideMiddle,
  keepHead,
  keepTail,
  LINE_BREAK,
} from "../modules/status/services/ui-text-elide.ts";
import { unitsColumns } from "../utils/text-units.ts";
import type { ActionFitPart } from "./action-fit.ts";
import { columnUnits } from "./text-columns.ts";

/** A part as the fit builds it; `whole` marks one a cut may not split. */
export interface FitPart extends ActionFitPart {
  whole?: boolean;
}

const STANDALONE_BREAK = new RegExp(`(?<!\\\\)${LINE_BREAK}`);

/** Terminal columns `text` takes. */
export function textColumns(text: string): number {
  return unitsColumns(columnUnits(text));
}

export const fitHead = (text: string, max: number): string =>
  keepHead(text, max, columnUnits);

export const fitTail = (text: string, max: number): string =>
  keepTail(text, max, columnUnits);

/** `elideMiddle` by columns. When a wide character leaves no room for the
 *  tail, the tail is kept and the head gives way. */
export function fitMiddle(
  text: string,
  max: number,
): ReturnType<typeof elideMiddle> {
  const parts = elideMiddle(text, max, columnUnits);
  if (parts === undefined || parts.tail !== "") return parts;
  const budget = max - textColumns(ELISION);
  const tail = fitTail(text, budget);
  return { head: fitHead(text, budget - textColumns(tail)), tail };
}

export function partsColumns(parts: readonly FitPart[]): number {
  return parts.reduce(
    (sum: number, part: ActionFitPart): number => sum + textColumns(part.text),
    0,
  );
}

export const shown = (parts: readonly ActionFitPart[]): string =>
  parts.map((part: ActionFitPart): string => part.text).join("");

function expandPart(part: FitPart): ActionFitPart[] {
  if (part.muted || !STANDALONE_BREAK.test(part.text))
    return [{ text: part.text, muted: part.muted }];
  return part.text
    .split(STANDALONE_BREAK)
    .flatMap((piece, index) => [
      ...(index === 0 ? [] : [{ text: LINE_BREAK, muted: true }]),
      { text: piece, muted: false },
    ]);
}

/** Drops empty parts, mutes line-break markers, and merges neighbours that
 *  share `muted`. */
export function merged(parts: readonly FitPart[]): ActionFitPart[] {
  const out: ActionFitPart[] = [];
  for (const part of parts.flatMap(expandPart)) {
    const last = out.at(-1);
    if (part.text === "") continue;
    if (last !== undefined && last.muted === part.muted)
      out[out.length - 1] = {
        text: `${last.text}${part.text}`,
        muted: part.muted,
      };
    else out.push(part);
  }
  return out;
}

/** The columns `start` to `end` of `parts`; a wide character crossing either
 *  edge is dropped. A muted or `whole` part (a heredoc marker or a separator)
 *  is kept whole or dropped, never cut. */
export function sliceParts(
  parts: readonly FitPart[],
  start: number,
  end: number,
): FitPart[] {
  const out: FitPart[] = [];
  let offset = 0;
  for (const part of parts) {
    let text = "";
    for (const unit of columnUnits(part.text)) {
      const unitStart = offset;
      offset += unit.columns;
      if (unitStart >= start && offset <= end) text += unit.text;
    }
    const cut = text.trim() !== part.text.trim();
    if (text === "" || ((part.muted || part.whole === true) && cut)) continue;
    out.push({ ...part, text });
  }
  return out;
}
