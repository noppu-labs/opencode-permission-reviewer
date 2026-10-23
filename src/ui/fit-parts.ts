// Measuring, slicing and merging fitted action parts.

import { LINE_BREAK } from "../modules/status/services/ui-text-elide.ts";
import type { ActionFitPart } from "./action-fit.ts";

/** A part as the fit builds it; `whole` marks one a cut may not split. */
export interface FitPart extends ActionFitPart {
  whole?: boolean;
}

const STANDALONE_BREAK = new RegExp(`(?<!\\\\)${LINE_BREAK}`);

/** Columns `text` takes, one per code point. */
export function textColumns(text: string): number {
  return Array.from(text).length;
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

/** The code points `start` to `end` of `parts`. A muted or `whole` part (a
 *  heredoc marker or a separator) is kept whole or dropped, never cut. */
export function sliceParts(
  parts: readonly FitPart[],
  start: number,
  end: number,
): FitPart[] {
  const out: FitPart[] = [];
  let offset = 0;
  for (const part of parts) {
    const chars = Array.from(part.text);
    const from = Math.max(start - offset, 0);
    const to = Math.max(0, Math.min(end - offset, chars.length));
    offset += chars.length;
    const text = chars.slice(from, to).join("");
    const cut = text.trim() !== part.text.trim();
    if (text === "" || ((part.muted || part.whole === true) && cut)) continue;
    out.push({ ...part, text });
  }
  return out;
}
