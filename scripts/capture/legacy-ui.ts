import { join } from "node:path";
import type { JSX } from "@opentui/solid";
import type { PermissionRequest } from "../../src/kernel/permission-request.ts";
import type { ReviewUiStatus } from "../../src/modules/status/models/ui-protocol.ts";
import type { ReviewTheme } from "../../src/ui/components.tsx";

// v3.0.0's signatures, written out: today's may have gained fields since.
export type Strip = (props: {
  theme: () => ReviewTheme;
  status: ReviewUiStatus;
  frame: () => number;
}) => JSX.Element;
export interface LegacyUi {
  createUiStatus(
    request: PermissionRequest,
    phase: "reviewing" | "denied",
    options: {
      model: string;
      variant: string;
      timeoutMs: number;
      emittedAt: number;
      reason?: string;
    },
  ): ReviewUiStatus;
  ReviewProgress: Strip;
  ReviewResult: Strip;
  ReviewOverlay: Strip;
}

const LEGACY_EXPORTS = [
  "createUiStatus",
  "ReviewProgress",
  "ReviewResult",
  "ReviewOverlay",
] as const;

function isLegacyUi(
  value: Record<string, unknown>,
): value is Record<string, unknown> & LegacyUi {
  return LEGACY_EXPORTS.every((name) => typeof value[name] === "function");
}

/** The v3.0.0 modules under `dir`, merged into one namespace. */
export async function legacyUi(dir: string): Promise<LegacyUi> {
  const modules: Record<string, unknown>[] = await Promise.all(
    [
      "src/ui-protocol.ts",
      "src/ui/components.tsx",
      "src/ui/review-result.tsx",
      "src/ui/review-overlay.tsx",
    ].map((path): Promise<Record<string, unknown>> => import(join(dir, path))),
  );
  const merged: Record<string, unknown> = Object.assign({}, ...modules);
  if (!isLegacyUi(merged))
    throw new Error(`${dir} does not export ${LEGACY_EXPORTS.join(", ")}`);
  return merged;
}
