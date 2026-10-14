// The optional status fields that carry routing and config state, bounded so
// an encoded status always fits the TUI command cap.
import type { HandoffInfo } from "./system-one/backend.ts";
import type { ManualResolution, ReviewDecision } from "./types.ts";

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

/** The status fields the fit may drop or shorten. */
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

/** The start of `text`, cut on a code-point boundary and ending in "…", whose
 *  JSON form is at least `excess` bytes smaller; just "…" when the whole text
 *  is not enough, and `text` itself when it is no longer than "…". */
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

/** Fits the encoded status to the cap: drops config list entries first, then
 *  shortens the decision rationale, then its script analysis, then the reason.
 *  A status already under the cap comes back as the same object. */
export function fitStatus<T extends FittableStatus>(status: T): T {
  let fitted = fitConfigLists(status);
  for (const field of FITTABLE_FIELDS) {
    const excess = jsonBytes(fitted) - MAX_STATUS_BYTES;
    if (excess <= 0) break;
    fitted = withShorter(fitted, field, excess);
  }
  return fitted;
}
