import { globalLayerDegradation } from "../../src/config/trusted-degradation.ts";
import { resolveConfig } from "../../src/config.ts";
import { invariant } from "../../src/invariant.ts";
import { systemOneRoutingWarnings } from "../../src/system-one-routing.ts";
import {
  type ConfigToast,
  configToasts,
  type SidebarLine,
  sidebarLine,
} from "../../src/ui/config-notices.ts";
import { type ManualToast, manualToast } from "../../src/ui/manual-toast.ts";
import { textRow } from "./ansi.ts";
import {
  CAPTION_COLOR,
  COLUMNS,
  JEV,
  LUNA,
  OPENCODE_DARK,
} from "./fixtures.ts";
import { manualSamples } from "./host-samples.ts";
import type { Block } from "./render.ts";

/** What the plugin asks the host to show. The host draws the frame. */
type ToastContent = ConfigToast | ManualToast;
type Tone = ToastContent["variant"] | SidebarLine["tone"];

/** The V1 host's fallback sentence (src/ui/v1-host.ts); every sample below has
 *  a reason, so it never shows. */
const MANUAL_FALLBACK =
  "The reviewer could not decide. This permission now needs your approval.";

function serverText(texts: readonly string[], index: number): string {
  const text = texts[index];
  invariant(
    text !== undefined,
    "the server no longer sends a sampled config warning",
  );
  return text;
}

/** The server's warnings for Jev with both settings on and no escalationReviewer. */
const WARNINGS = systemOneRoutingWarnings(
  resolveConfig({
    model: JEV,
    systemOneEscalation: "reasoning-first",
    systemOneDenialReview: true,
  }),
);
const INERT_WARNING = serverText(WARNINGS, 0);
const DENIAL_WARNING = serverText(WARNINGS, 1);
const DEGRADED = serverText(
  globalLayerDegradation({ raw: {}, status: "malformed", warning: "" }),
  0,
);
const HOST_FRAME = "OpenCode draws the frame";

const TONE_COLORS: Record<Tone, string> = {
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
    rows: toastRows(manualToast(status, MANUAL_FALLBACK, LUNA)),
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
