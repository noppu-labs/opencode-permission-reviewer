// Server only: it runs the shell lexer, which the TUI never ships.

import { extractHeredocs } from "./capability/heredoc-extractor.ts";
import { lexSegments } from "./shell-scanner.ts";
import type { PermissionRequest } from "./types.ts";
import { heredocRedirects } from "./ui-heredoc-redirects.ts";
import {
  type ActionSegment,
  createUiStatus,
  type ReviewUiPhase,
  type ReviewUiStatus,
  type UiStatusOptions,
} from "./ui-protocol.ts";
import { SegmentBuilder } from "./ui-segment-builder.ts";
import { MAX_STATUS_BYTES } from "./ui-status-extras.ts";

/** Longest command segmented; a longer one keeps only the bounded `action`. */
const MAX_COMMAND_CHARS = 65_536;
/** Tokens one lexing pass may produce; running out means no segments. */
const MAX_TOKENS = 4_096;
const MAX_SEGMENTS = 24;
/** UTF-8 bytes the segments may add to a status, which must stay under the
 *  16k command cap (`decodeUiStatus`). */
const MAX_SEGMENTS_BYTES = 2_000;

/** The segments, or undefined unless they reconstruct `command`: each shown
 *  as typed, apart from whitespace, comments and collapsed heredoc bodies. */
function segmentsOf(command: string): ActionSegment[] | undefined {
  if (command.includes("\r")) return undefined;
  const extraction = extractHeredocs(command);
  const redirects = heredocRedirects(command, extraction);
  if (redirects === undefined) return undefined;
  const budget = {
    tokensRemaining: MAX_TOKENS,
    substitutions: "skip" as const,
  };
  const lexed = lexSegments(extraction.sanitizedCommand, budget);
  // The lexer stops silently at the budget and returns a prefix.
  if (budget.tokensRemaining <= 0) return undefined;
  const builder = new SegmentBuilder(extraction.sanitizedCommand, redirects);
  let previousEnd: string | undefined;
  for (const segment of lexed) {
    builder.add(segment, previousEnd);
    previousEnd = segment.endedBy;
  }
  return builder.finish();
}

function withinBudget(
  segments: ActionSegment[] | undefined,
): ActionSegment[] | undefined {
  if (
    segments === undefined ||
    segments.length === 0 ||
    segments.length > MAX_SEGMENTS
  )
    return undefined;
  const bytes = Buffer.byteLength(JSON.stringify(segments), "utf8");
  return bytes <= MAX_SEGMENTS_BYTES ? segments : undefined;
}

/** Display segments for `command`; undefined when it cannot be segmented
 *  within the bounds, so the TUI falls back to `action`. */
export function actionSegments(command: string): ActionSegment[] | undefined {
  if (command.length > MAX_COMMAND_CHARS) return undefined;
  try {
    return withinBudget(segmentsOf(command));
  } catch {
    // A display aid must never fail the status it decorates.
    return undefined;
  }
}

/** A bash request's segments, the first carrying the `$ ` prompt that
 *  `permissionAction` shows. */
function requestSegments(
  request: PermissionRequest,
): ActionSegment[] | undefined {
  const command = request.metadata.command;
  if (request.permission !== "bash" || typeof command !== "string")
    return undefined;
  const [first, ...rest] = actionSegments(command) ?? [];
  return first === undefined
    ? undefined
    : [{ ...first, text: `$ ${first.text}` }, ...rest];
}

function keepsSegments(plain: ReviewUiStatus, full: ReviewUiStatus): boolean {
  return (
    Buffer.byteLength(JSON.stringify(full), "utf8") <= MAX_STATUS_BYTES &&
    (full.configWarnings?.length ?? 0) ===
      (plain.configWarnings?.length ?? 0) &&
    (full.configDegraded?.length ?? 0) === (plain.configDegraded?.length ?? 0)
  );
}

/** `createUiStatus` plus the request's action segments: how server code
 *  builds every status it publishes. The segments are left off when they
 *  would push the status past the cap or crowd out a config entry. */
export function createServerUiStatus(
  request: PermissionRequest,
  phase: ReviewUiPhase,
  options: Omit<UiStatusOptions, "actionSegments">,
): ReviewUiStatus {
  const plain = createUiStatus(request, phase, options);
  const segments = requestSegments(request);
  if (segments === undefined) return plain;
  const full = createUiStatus(request, phase, {
    ...options,
    actionSegments: segments,
  });
  return keepsSegments(plain, full) ? full : plain;
}
