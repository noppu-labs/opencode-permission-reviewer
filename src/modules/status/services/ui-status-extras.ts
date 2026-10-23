// Bounds the routing and config fields, then fits the whole status to the TUI
// command cap. Oversized identifiers are not cut, so they can still overflow it.

import type { ReviewDecision } from "../../../kernel/review-decision.ts";
import type { ManualResolution } from "../../../kernel/review-result.ts";
import type { HandoffInfo } from "../../reviewer/services/backend.ts";

const MAX_LIST_ENTRIES = 5;
const MAX_ENTRY_CHARS = 200;
const MAX_MODEL_CHARS = 200;
const MAX_FAILURE_KIND_CHARS = 40;

/** Collapses whitespace and cuts `value` to `max` characters, ending in "…"
 *  when it was longer. */
export function boundedText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

export interface StatusExtrasOptions {
  handoff?: HandoffInfo;
  resolution?: ManualResolution;
  decidedBy?: string;
  configWarnings?: readonly string[];
  configDegraded?: readonly string[];
}

interface StatusExtras {
  handoff?: HandoffInfo;
  resolution?: ManualResolution;
  decidedBy?: string;
  configWarnings?: string[];
  configDegraded?: string[];
}

function boundedList(values: readonly string[] | undefined): string[] {
  return (values ?? [])
    .slice(0, MAX_LIST_ENTRIES)
    .map((entry) => boundedText(entry, MAX_ENTRY_CHARS))
    .filter((entry) => entry.length > 0);
}

function boundedHandoff(handoff: HandoffInfo): HandoffInfo {
  const { failureKind } = handoff;
  return {
    from: boundedText(handoff.from, MAX_MODEL_CHARS),
    to: boundedText(handoff.to, MAX_MODEL_CHARS),
    trigger: handoff.trigger,
    ...(failureKind === undefined
      ? {}
      : { failureKind: boundedText(failureKind, MAX_FAILURE_KIND_CHARS) }),
  };
}

/** The hand-off, resolution, deciding model and config lists a status
 *  carries; an empty list is left out. */
export function statusExtras(options: StatusExtrasOptions): StatusExtras {
  const configWarnings = boundedList(options.configWarnings);
  const configDegraded = boundedList(options.configDegraded);
  return {
    ...(options.handoff === undefined
      ? {}
      : { handoff: boundedHandoff(options.handoff) }),
    ...(options.resolution === undefined
      ? {}
      : { resolution: options.resolution }),
    ...(options.decidedBy === undefined
      ? {}
      : { decidedBy: boundedText(options.decidedBy, MAX_MODEL_CHARS) }),
    ...(configWarnings.length === 0 ? {} : { configWarnings }),
    ...(configDegraded.length === 0 ? {} : { configDegraded }),
  };
}

/** The JSON byte size whose base64url encoding fits the 16000-character cap
 *  `decodeUiStatus` enforces. */
export const MAX_STATUS_BYTES = 12_000;

function withoutLastEntry<T extends StatusExtras>(status: T): T | undefined {
  const key =
    (status.configWarnings?.length ?? 0) > 0
      ? "configWarnings"
      : (status.configDegraded?.length ?? 0) > 0
        ? "configDegraded"
        : undefined;
  if (key === undefined) return;
  const { [key]: list, ...rest } = status;
  const kept = (list ?? []).slice(0, -1);
  return (kept.length === 0 ? rest : { ...rest, [key]: kept }) as T;
}

/** The config lists the fit drops and the texts it shortens. */
interface FittableStatus extends StatusExtras {
  reason?: string;
  decision?: Pick<ReviewDecision, "rationale" | "script_analysis">;
}

const FITTABLE_FIELDS = ["rationale", "script_analysis", "reason"] as const;
type FittableField = (typeof FITTABLE_FIELDS)[number];

const ELLIPSIS = "…";

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Drops config list entries, warnings before degraded reasons and the last
 *  first, until the encoded status fits the cap. */
function fitConfigLists<T extends StatusExtras>(status: T): T {
  let fitted = status;
  while (jsonBytes(fitted) > MAX_STATUS_BYTES) {
    const next = withoutLastEntry(fitted);
    if (next === undefined) break;
    fitted = next;
  }
  return fitted;
}

/** Cuts on a code-point boundary so the JSON form, "…" included, is at least
 *  `excess` bytes smaller; "…" alone when even the whole text is not enough. */
function shortenedBy(text: string, excess: number): string {
  if (jsonBytes(text) <= jsonBytes(ELLIPSIS)) return text;
  let room = jsonBytes(text) - excess - jsonBytes(ELLIPSIS);
  let end = 0;
  for (const char of text) {
    room -= jsonBytes(char) - 2;
    if (room < 0) break;
    end += char.length;
  }
  return `${text.slice(0, end)}${ELLIPSIS}`;
}

function withShorter<T extends FittableStatus>(
  status: T,
  field: FittableField,
  excess: number,
): T {
  if (field === "reason") {
    const { reason } = status;
    return reason === undefined
      ? status
      : { ...status, reason: shortenedBy(reason, excess) };
  }
  const { decision } = status;
  const text = decision?.[field];
  return decision === undefined || text === undefined
    ? status
    : {
        ...status,
        decision: { ...decision, [field]: shortenedBy(text, excess) },
      };
}

/** Drops config entries, then shortens fields in FITTABLE_FIELDS order. The
 *  TUI shows only reason, and the gate paths copy the rationale into it, so the
 *  hidden fields go first. A status under the cap comes back as the same
 *  object. */
export function fitStatus<T extends FittableStatus>(status: T): T {
  let fitted = fitConfigLists(status);
  for (const field of FITTABLE_FIELDS) {
    const excess = jsonBytes(fitted) - MAX_STATUS_BYTES;
    if (excess <= 0) break;
    fitted = withShorter(fitted, field, excess);
  }
  return fitted;
}
