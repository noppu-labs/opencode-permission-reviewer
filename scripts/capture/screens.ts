import type { JSX } from "@opentui/solid";
import { ReviewProgress, type ReviewTheme } from "../../src/ui/components.tsx";
import { ReviewOverlay } from "../../src/ui/review-overlay.tsx";
import { ReviewResult } from "../../src/ui/review-result.tsx";
import type { ReviewUiStatus } from "../../src/ui-protocol.ts";
import { renderBefore } from "./before.ts";
import { THEME, WIDE_COLUMNS } from "./fixtures.ts";
import { configWarningBlocks, manualToastBlocks } from "./host-content.ts";
import { type Block, renderSections } from "./render.ts";
import {
  attributionSamples,
  longCommandSamples,
  progressSamples,
  resultSamples,
} from "./samples.ts";

const theme = (): ReviewTheme => THEME;

function section(
  height: number,
  view: () => JSX.Element,
  caption?: string,
  columns?: number,
): Block {
  return {
    caption,
    height,
    ...(columns === undefined ? {} : { columns }),
    view,
  };
}

const progress = (
  status: ReviewUiStatus,
  frame: number,
  caption?: string,
  columns?: number,
): Block =>
  section(
    2,
    () => ReviewProgress({ theme, status, frame: () => frame }),
    caption,
    columns,
  );

const result = (
  status: ReviewUiStatus,
  caption?: string,
  columns?: number,
): Block => section(2, () => ReviewResult({ theme, status }), caption, columns);

const overlay = (
  status: ReviewUiStatus,
  caption?: string,
  columns?: number,
): Block =>
  section(
    12,
    () => ReviewOverlay({ theme, status, frame: () => 0 }),
    caption,
    columns,
  );

function handoffProgress(): Promise<string[]> {
  const samples = progressSamples();
  return renderSections([
    progress(samples.jev, 0, "while Jev reviews"),
    progress(
      samples.handoff,
      1,
      "after Jev hands the request to the reasoning reviewer",
    ),
  ]);
}

function longCommandAfter(): Promise<string[]> {
  const samples = longCommandSamples();
  return renderSections([
    progress(samples.progress, 0, "V2 progress strip", WIDE_COLUMNS),
    result(samples.result, "result strip", WIDE_COLUMNS),
    overlay(samples.progress, "V1 overlay", WIDE_COLUMNS),
  ]);
}

export type ScreenName =
  | "handoff-progress"
  | "result-attribution"
  | "v1-overlay-handoff"
  | "result-triggers"
  | "long-command-before"
  | "long-command-after"
  | "manual-toasts"
  | "config-warnings";

const SCREENS: Record<ScreenName, () => Promise<string[]>> = {
  "handoff-progress": handoffProgress,
  "result-attribution": (): Promise<string[]> =>
    renderSections(attributionSamples().map((status) => result(status))),
  "v1-overlay-handoff": (): Promise<string[]> =>
    renderSections([overlay(progressSamples().overlay)]),
  "result-triggers": (): Promise<string[]> =>
    renderSections(
      resultSamples().map((sample) => result(sample.status, sample.caption)),
    ),
  "long-command-before": renderBefore,
  "long-command-after": longCommandAfter,
  "manual-toasts": (): Promise<string[]> => renderSections(manualToastBlocks()),
  "config-warnings": (): Promise<string[]> =>
    renderSections(configWarningBlocks()),
};

export const SCREEN_NAMES = Object.keys(SCREENS) as ScreenName[];

export function isScreenName(value: string): value is ScreenName {
  return Object.hasOwn(SCREENS, value);
}

export function renderScreen(name: ScreenName): Promise<string[]> {
  return SCREENS[name]();
}
