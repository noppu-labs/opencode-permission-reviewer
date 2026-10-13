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
  configWarnings?: readonly string[];
  configDegraded?: readonly string[];
}

interface StatusExtras {
  handoff?: HandoffInfo;
  resolution?: ManualResolution;
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

/** The hand-off, resolution and config lists a status carries; an empty list
 *  is left out. */
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
    ...(configWarnings.length === 0 ? {} : { configWarnings }),
    ...(configDegraded.length === 0 ? {} : { configDegraded }),
  };
}
