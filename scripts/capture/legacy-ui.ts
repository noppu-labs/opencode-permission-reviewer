import { join } from "node:path";
import type { JSX } from "@opentui/solid";
import type { PermissionRequest } from "../../src/types.ts";
import type { ReviewTheme } from "../../src/ui/components.tsx";
import type { ReviewUiStatus } from "../../src/ui-protocol.ts";

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
  return merged as unknown as LegacyUi;
}
