import { invariant } from "../../src/invariant.ts";
import type { HandoffTrigger, PermissionRequest } from "../../src/types.ts";
import type { ReviewTheme } from "../../src/ui/components.tsx";
import { resolveReviewTheme } from "../../src/ui/review-theme.ts";
import { createServerUiStatus } from "../../src/ui-action-segments.ts";
import {
  decodeUiStatus,
  encodeUiStatus,
  type ReviewUiPhase,
  type ReviewUiStatus,
} from "../../src/ui-protocol.ts";

/** The clock every screen renders at; capture-tui.ts pins Date.now to it. */
export const CAPTURE_NOW = 1_767_225_600_000;
/** Terminal width of the screens and the toast wrap width; the long-command screens use the wider one. */
export const COLUMNS = 100;
export const WIDE_COLUMNS = 120;

/** OpenCode's default theme ("opencode"), dark mode, from
 *  packages/tui/src/theme/assets/opencode.json (anomalyco/opencode@fe0c4f8). */
export const OPENCODE_DARK = {
  backgroundPanel: "#141414",
  text: "#eeeeee",
  textMuted: "#808080",
  info: "#56b6c2",
  success: "#7fd88f",
  warning: "#f5a742",
  error: "#e06c75",
} as const;
/** Captions annotate an image and are not TUI output, so they use a gray the
 *  review components never draw. */
export const CAPTION_COLOR = "#606060";
export const THEME: ReviewTheme = resolveReviewTheme(OPENCODE_DARK);

export const JEV = "typesafe-ai/jev-1.13.0";
export const LUNA = "openai/gpt-6-luna";

interface Sample {
  command: string;
  phase: ReviewUiPhase;
  reason?: string;
  /** How long ago the review started; 7.3s when absent. */
  elapsedMs?: number;
  extra?: Partial<ReviewUiStatus>;
}

export function bashRequest(command: string): PermissionRequest {
  return {
    id: "per_capture",
    sessionID: "ses_capture",
    permission: "bash",
    patterns: [command],
    metadata: { command },
    always: [],
  };
}

const DECIDED: readonly ReviewUiPhase[] = ["approved", "denied"];

/** Built by `createServerUiStatus` and round-tripped through the wire codec,
 *  so a sample can only use shapes the TUI accepts. `decidedBy` is set for
 *  approved and denied; a manual sample passes its own. */
function published(
  sample: Sample,
  model: string,
  variant: string,
): ReviewUiStatus {
  const base = createServerUiStatus(bashRequest(sample.command), sample.phase, {
    model,
    variant,
    timeoutMs: 120_000,
    emittedAt: CAPTURE_NOW - (sample.elapsedMs ?? 7_300),
    ...(sample.reason === undefined ? {} : { reason: sample.reason }),
    ...(DECIDED.includes(sample.phase) ? { decidedBy: model } : {}),
  });
  const status: ReviewUiStatus = { ...base, ...sample.extra };
  const decoded = decodeUiStatus(encodeUiStatus(status));
  invariant(decoded, `sample status for "${sample.command}" does not decode`);
  return decoded;
}

/** A status credited to Jev's run: while Jev reviews, after Jev decided alone, or a manual outcome with no hand-off. */
export function jevStatus(sample: Sample): ReviewUiStatus {
  return published(sample, JEV, "system-one");
}

/** `failureKind` is set only for `jev-failure` ("timeout", "transport", …). */
export function handoffStatus(
  trigger: HandoffTrigger,
  sample: Sample,
  failureKind?: string,
): ReviewUiStatus {
  const handoff = {
    from: JEV,
    to: LUNA,
    trigger,
    ...(failureKind === undefined ? {} : { failureKind }),
  };
  return published(
    { ...sample, extra: { ...sample.extra, handoff } },
    LUNA,
    "medium",
  );
}
