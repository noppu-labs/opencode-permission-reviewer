import { invariant } from "../../src/invariant.ts";
import { configToasts, sidebarLine } from "../../src/ui/config-notices.ts";
import { manualToast } from "../../src/ui/manual-toast.ts";
import { textRow } from "./ansi.ts";
import { CAPTION_COLOR, COLUMNS, OPENCODE_DARK } from "./fixtures.ts";
import { manualSamples } from "./host-samples.ts";
import type { Block } from "./render.ts";

/** What the plugin asks the host to show. The host draws the frame. */
interface ToastContent {
  variant: "warning" | "error";
  title: string;
  message: string;
}

/** The V1 host's fallback sentence (src/ui/v1-host.ts); every sample below has
 *  a reason, so it never shows. */
const MANUAL_FALLBACK =
  "The reviewer could not decide. This permission now needs your approval.";
/** The reasoning reviewer the V1 host names on a budget-exhausted toast. */
const REASONING_MODEL = "openai/gpt-6-luna";
const INERT_WARNING = `systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; Jev escalations still go to you`;
const DENIAL_WARNING =
  "systemOneDenialReview is inactive: no escalationReviewer is configured; Jev denials stay final";
const DEGRADED = "global config file is malformed and was ignored";
const HOST_FRAME = "OpenCode draws the frame";

const TONE_COLORS: Record<"warning" | "error", string> = {
  warning: OPENCODE_DARK.warning,
  error: OPENCODE_DARK.error,
};

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  return line === "" ? lines : [...lines, line];
}

/** The title in the variant's color, the variant as an annotation, then the message. */
function toastRows(toast: ToastContent): string[] {
  const heading = textRow([
    { text: toast.title, fg: TONE_COLORS[toast.variant] },
    { text: ` (${toast.variant})`, fg: CAPTION_COLOR },
  ]);
  const message = wrap(toast.message, COLUMNS).map((line) =>
    textRow([{ text: line, fg: OPENCODE_DARK.text }]),
  );
  return [heading, ...message];
}

/** One toast per manual-review resolution, from manualToast() as the V1 host
 *  calls it. */
export function manualToastBlocks(): Block[] {
  return manualSamples().map(([resolution, status]) => ({
    caption: `toast, resolution ${resolution} · ${HOST_FRAME}`,
    rows: toastRows(manualToast(status, MANUAL_FALLBACK, REASONING_MODEL)),
  }));
}

function toastBlocks(
  caption: string,
  warnings: readonly string[],
  degraded: readonly string[],
): Block[] {
  return configToasts(warnings, degraded).map((toast) => ({
    caption: `${caption} · ${HOST_FRAME}`,
    rows: toastRows(toast),
  }));
}

function sidebarBlock(
  caption: string,
  warnings: readonly string[],
  degraded: readonly string[],
): Block {
  const line = sidebarLine(warnings, degraded);
  invariant(line !== undefined, `no sidebar line for ${caption}`);
  return {
    caption,
    rows: [textRow([{ text: line.text, fg: TONE_COLORS[line.tone] }])],
  };
}

/** Warning toasts, the sidebar line, and the healthy case, which shows nothing. */
export function configWarningBlocks(): Block[] {
  invariant(
    configToasts([], []).length === 0 && sidebarLine([], []) === undefined,
    "a healthy config must show no toast and no sidebar line",
  );
  return [
    ...toastBlocks("toast for an inactive setting", [INERT_WARNING], []),
    ...toastBlocks("toast for a degraded config", [], [DEGRADED]),
    sidebarBlock("sidebar line, one warning", [INERT_WARNING], []),
    sidebarBlock(
      "sidebar line, several warnings",
      [INERT_WARNING, DENIAL_WARNING],
      [],
    ),
    sidebarBlock("sidebar line, degraded config", [], [DEGRADED]),
    { caption: "healthy config: no toast and no sidebar line", rows: [] },
  ];
}
