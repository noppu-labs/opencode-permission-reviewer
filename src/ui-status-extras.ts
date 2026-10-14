// The optional status fields that carry routing and config state, bounded so
// an encoded status always fits the TUI command cap.
import type { HandoffInfo } from "./system-one/backend.ts";
import type { ManualResolution } from "./types.ts";

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

/** Drops config list entries, warnings before degraded reasons and the last
 *  first, until the encoded status fits the cap. */
export function fitConfigLists<T extends StatusExtras>(status: T): T {
  let fitted = status;
  while (Buffer.byteLength(JSON.stringify(fitted), "utf8") > MAX_STATUS_BYTES) {
    const next = withoutLastEntry(fitted);
    if (next === undefined) break;
    fitted = next;
  }
  return fitted;
}
