import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewDecision } from "../../../kernel/review-decision.ts";
import type {
  EscalationDisposition,
  ManualResolution,
} from "../../../kernel/review-result.ts";
import type { ActorProfile } from "../../../kernel/reviewer-config.ts";
import type { HandoffInfo } from "../../reviewer/services/backend.ts";
import {
  boundedText,
  fitStatus,
  type StatusExtrasOptions,
  statusExtras,
} from "../services/ui-status-extras.ts";
import { parseUiStatus } from "../services/ui-status-parse.ts";
import { boundedHeadTail } from "../services/ui-text-elide.ts";

export const UI_COMMAND_PREFIX = "opencode-permission-reviewer.status.";
// Time to wait for the server's first "reviewing" ack after permission.asked.
// Short enough to surface a broken publish path, long enough to survive a busy
// event bus without flipping the panel to "manual" before the review starts.
export const UI_START_GRACE_MS = 15_000;
export const UI_WATCHDOG_GRACE_MS = 5_000;

export type ReviewUiPhase =
  | "reviewing"
  | "approved"
  | "denied"
  | "manual"
  | "unknown";

/** One command of a shell action as the server split it, for the TUI to fit
 *  to its width. Built by `src/modules/status/services/ui-action-segments.ts`. */
export interface ActionSegment {
  /** The segment as typed in the command, heredoc bodies left out,
   *  whitespace collapsed, at most 200 code points. */
  text: string;
  /** The operator that ends this segment: "|", "||", "&&", ";", "&". */
  separator?: string;
  /** Total body lines of the segment's heredocs, whose bodies are not
   *  shown. */
  heredocLines?: number;
}

export interface ReviewUiStatus {
  version: 1;
  requestID: string;
  sessionID: string;
  phase: ReviewUiPhase;
  permission: string;
  action: string;
  model: string;
  variant: string;
  emittedAt: number;
  timeoutMs: number;
  reason?: string;
  decision?: ReviewDecision;
  /**
   * When phase is `denied` and this is `"deny"`, the block came from fail-closed
   * escalation disposition rather than an explicit reviewer/policy deny.
   */
  escalationDisposition?: EscalationDisposition;
  /** Resolved actor (absent on the initial "reviewing" phase, before context
   *  collection completes). */
  actorName?: string;
  actorProfile?: ActorProfile;
  /** Jev's hand-off to the reasoning reviewer, on the second "reviewing"
   *  status and on the result of a handed-off review. */
  handoff?: HandoffInfo;
  /** How a manual outcome came about; chooses the manual-review toast. */
  resolution?: ManualResolution;
  /** The model that made the decision, on a final status a reviewer model
   *  decided; absent on a brake, policy or failure-safe result. */
  decidedBy?: string;
  /** The server's config warnings and degraded-config reasons. V1 carries them
   *  on every status; V2 reads them from the `status` RPC. */
  configWarnings?: string[];
  configDegraded?: string[];
  /** The action split at its top-level shell operators. Absent when the
   *  server did not segment it or left the segments off to fit the status
   *  cap, and from a server that predates segments. */
  actionSegments?: ActionSegment[];
}

export function permissionAction(request: PermissionRequest): string {
  const metadata = request.metadata;
  const candidates = [
    metadata.command,
    metadata.filepath,
    metadata.url,
    metadata.query,
    metadata.path,
    request.patterns.join(", "),
  ];
  const detail = candidates.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const prefix = request.permission === "bash" && detail ? "$ " : "";
  const text = `${prefix}${detail ?? request.permission}`;
  // 500 UTF-16 units at most, as the status size budget assumes: 250 code
  // points always fit.
  const bounded = boundedHeadTail(text, 500);
  return bounded.length <= 500 ? bounded : boundedHeadTail(text, 250);
}

export type UiStatusOptions = {
  model: string;
  variant: string;
  timeoutMs: number;
  reason?: string;
  decision?: ReviewDecision;
  escalationDisposition?: EscalationDisposition;
  emittedAt?: number;
  actorName?: string;
  actorProfile?: ActorProfile;
  actionSegments?: ActionSegment[];
} & StatusExtrasOptions;

export function createUiStatus(
  request: PermissionRequest,
  phase: ReviewUiPhase,
  options: UiStatusOptions,
): ReviewUiStatus {
  return fitStatus({
    version: 1,
    requestID: request.id,
    sessionID: request.sessionID,
    phase,
    permission: request.permission,
    action: permissionAction(request),
    model: boundedText(options.model, 200),
    variant: boundedText(options.variant, 100),
    emittedAt: options.emittedAt ?? Date.now(),
    timeoutMs: options.timeoutMs,
    ...(options.reason === undefined
      ? {}
      : { reason: boundedText(options.reason, 2_000) }),
    ...(options.decision === undefined ? {} : { decision: options.decision }),
    ...(options.escalationDisposition === undefined
      ? {}
      : { escalationDisposition: options.escalationDisposition }),
    ...(options.actorName === undefined
      ? {}
      : { actorName: boundedText(options.actorName, 100) }),
    ...(options.actorProfile === undefined
      ? {}
      : { actorProfile: options.actorProfile }),
    ...(options.actionSegments === undefined
      ? {}
      : { actionSegments: options.actionSegments }),
    ...statusExtras(options),
  });
}

export function encodeUiStatus(status: ReviewUiStatus): string {
  return `${UI_COMMAND_PREFIX}${Buffer.from(JSON.stringify(status), "utf8").toString("base64url")}`;
}

export function decodeUiStatus(command: string): ReviewUiStatus | undefined {
  if (!command.startsWith(UI_COMMAND_PREFIX)) return;
  const encoded = command.slice(UI_COMMAND_PREFIX.length);
  if (!encoded || encoded.length > 16_000) return;
  try {
    return parseUiStatus(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
  } catch {
    return;
  }
}
