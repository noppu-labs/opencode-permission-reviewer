// Ships to the TUI, so it imports no shell module.

import type { ActionSegment, ReviewUiStatus } from "../ui-protocol.ts";
import { ELISION, elideMiddle, keepHead, keepTail } from "../ui-text-elide.ts";
import {
  type FitPart,
  merged,
  partsColumns,
  shown,
  sliceParts,
  textColumns,
} from "./fit-parts.ts";

export interface ActionFitPart {
  text: string;
  muted: boolean;
}

const ELLIPSIS = "⋯";
/** Narrowest width that still shows a character on each side of " ⋯ ". */
const MIN_ELIDED_COLUMNS = 5;

/** Collapses line breaks and tabs so a value renders on one row. */
export const singleLine = (value: string): string =>
  value.replace(/[\r\n\t]+/g, " ");

function separatorText(separator: string | undefined): string {
  if (separator === undefined) return "";
  return separator === ";" ? ";" : ` ${separator}`;
}

function segmentParts(segment: ActionSegment): FitPart[] {
  const parts: FitPart[] = [{ text: singleLine(segment.text), muted: false }];
  if (segment.heredocLines !== undefined)
    parts.push({
      text: ` ${ELLIPSIS} ${segment.heredocLines}-line heredoc ${ELLIPSIS}`,
      muted: true,
    });
  parts.push({
    text: separatorText(segment.separator),
    muted: false,
    whole: true,
  });
  return parts;
}

function joined(segments: readonly ActionSegment[]): FitPart[] {
  return segments.flatMap(
    (segment: ActionSegment, index: number): FitPart[] => [
      { text: index === 0 ? "" : " ", muted: false },
      ...segmentParts(segment),
    ],
  );
}

const hiddenCount = (hidden: number): string =>
  ` ${ELLIPSIS} ${hidden} more ${ELLIPSIS} `;

/** The first segment, a muted count of the hidden ones, and the most
 *  trailing segments that fit; undefined when not even the last one fits,
 *  or fewer than three segments leave nothing to hide. */
function elided(
  segments: readonly ActionSegment[],
  columns: number,
): FitPart[] | undefined {
  const [first, ...rest] = segments;
  if (first === undefined) return undefined;
  let fitted: FitPart[] | undefined;
  for (let kept = 1; kept < rest.length; kept += 1) {
    const candidate = [
      ...segmentParts(first),
      { text: hiddenCount(rest.length - kept), muted: true },
      ...joined(rest.slice(-kept)),
    ];
    if (partsColumns(candidate) > columns) break;
    fitted = candidate;
  }
  return fitted;
}

/** The muted marker at the cut: a count of the whole segments hidden when it
 *  leaves a column for each side, else " ⋯ ". */
function cutMarker(hidden: number, columns: number): string {
  const counted = hiddenCount(hidden);
  return hidden > 0 && columns - textColumns(counted) >= 2 ? counted : ELISION;
}

const headOf = (parts: readonly FitPart[], max: number): FitPart[] =>
  sliceParts(parts, 0, textColumns(keepHead(shown(parts), max)));

function tailOf(parts: readonly FitPart[], max: number): FitPart[] {
  const columns = partsColumns(parts);
  const tail = keepTail(shown(parts), max);
  return sliceParts(parts, columns - textColumns(tail), columns);
}

/** The start of the first segment and the end of the last (the same segment
 *  when there is only one) around a muted marker of their own, so a kept
 *  heredoc label never stands in for the cut. Heredocs stay collapsed, and
 *  the last segment's label is not shown without its command. */
function firstAndLast(
  segments: readonly ActionSegment[],
  first: ActionSegment,
  last: ActionSegment,
  columns: number,
): FitPart[] {
  const marker = cutMarker(Math.max(0, segments.length - 2), columns);
  const headParts = segmentParts(first);
  const tailParts = segmentParts(last);
  const budget = columns - textColumns(marker);
  let kept = headOf(
    headParts,
    Math.max(Math.ceil(budget / 2), budget - partsColumns(tailParts)),
  );
  let ending = tailOf(tailParts, budget - partsColumns(kept));
  if (first !== last && ending[0]?.muted === true) ending = [];
  if (ending.length === 0) kept = headOf(headParts, budget);
  const spaced = ending[0]?.text.startsWith(" ") ?? true;
  return [
    ...kept,
    { text: spaced ? marker.trimEnd() : marker, muted: true },
    ...ending,
  ];
}

function headAndTail(action: string, columns: number): ActionFitPart[] {
  const parts = elideMiddle(singleLine(action), columns);
  if (parts === undefined)
    return merged([{ text: singleLine(action), muted: false }]);
  return merged([
    { text: parts.head, muted: false },
    { text: ELISION, muted: true },
    { text: parts.tail, muted: false },
  ]);
}

/** A fitting `action` is shown as sent unless a segment collapses a heredoc
 *  body, which `action` shows flattened. */
export function fitAction(
  status: Pick<ReviewUiStatus, "action" | "actionSegments">,
  columns: number,
): ActionFitPart[] {
  const width = Math.floor(columns);
  if (!(width > 0)) return [];
  const segments = status.actionSegments ?? [];
  const first = segments[0];
  const last = segments.at(-1);
  const asSent = [{ text: singleLine(status.action), muted: false }];
  const collapsesBody = segments.some(
    (segment: ActionSegment): boolean => segment.heredocLines !== undefined,
  );
  if (!collapsesBody && partsColumns(asSent) <= width) return merged(asSent);
  const full = joined(segments);
  if (first !== undefined && partsColumns(full) <= width) return merged(full);
  if (width < MIN_ELIDED_COLUMNS) return [{ text: ELLIPSIS, muted: true }];
  if (first === undefined || last === undefined)
    return headAndTail(status.action, width);
  return merged(
    elided(segments, width) ?? firstAndLast(segments, first, last, width),
  );
}
