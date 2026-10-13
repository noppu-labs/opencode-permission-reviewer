// The server's config warnings in the TUI: one toast per distinct entry per
// TUI session, and a one-line sidebar summary while any remain.
import { asObjectLike } from "../is-record.ts";

interface NoticeLists {
  configWarnings?: readonly string[] | undefined;
  configDegraded?: readonly string[] | undefined;
}

export interface ConfigToast {
  variant: "warning" | "error";
  title: string;
  message: string;
}

export interface SidebarLine {
  text: string;
  tone: "warning" | "error";
}

/** Sidebar wording for the inert-setting warnings; other warnings show as
 *  written. */
const SHORT_WARNINGS: Readonly<Record<string, string>> = {
  'systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; Jev escalations still go to you':
    "reasoning-first inactive (no escalationReviewer)",
  'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not Jev':
    "reasoning-first inactive (model is not Jev)",
  "systemOneDenialReview is inactive: no escalationReviewer is configured; Jev denials stay final":
    "denial review inactive (no escalationReviewer)",
  "systemOneDenialReview is inactive: the reviewer model is not Jev":
    "denial review inactive (model is not Jev)",
};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

const warningToast = (warning: string): ConfigToast => ({
  variant: "warning",
  title: "Permission reviewer config",
  message: warning,
});

const degradedToast = (reason: string): ConfigToast => ({
  variant: "error",
  title: "Permission reviewer config degraded",
  message: `Automatic approval is disabled: ${reason}.`,
});

/** Every toast the lists call for, degraded reasons first; no per-session
 *  dedupe (ConfigNotices does that). */
export function configToasts(
  warnings: readonly string[],
  degraded: readonly string[],
): ConfigToast[] {
  return [...degraded.map(degradedToast), ...warnings.map(warningToast)];
}

/** The sidebar summary: the only entry, or the count and the first, degraded
 *  reasons first; undefined for a healthy config. */
export function sidebarLine(
  warnings: readonly string[],
  degraded: readonly string[],
): SidebarLine | undefined {
  const items = [
    ...degraded.map((reason) => `auto-approval disabled (${reason})`),
    ...warnings.map((warning) => SHORT_WARNINGS[warning] ?? warning),
  ];
  const first = items[0];
  if (first === undefined) return;
  const tone: SidebarLine["tone"] = degraded.length > 0 ? "error" : "warning";
  const icon = tone === "error" ? "✕" : "⚠";
  const body =
    items.length === 1 ? first : `${items.length} config warnings · ${first}`;
  return { text: `${icon} reviewer: ${body}`, tone };
}

export class ConfigNotices {
  private readonly shown = new Set<string>();
  private warnings: readonly string[] = [];
  private degraded: readonly string[] = [];

  constructor(private readonly show: (toast: ConfigToast) => void) {}

  /** Takes the server's current lists (absent means none) and toasts each
   *  entry not yet shown in this TUI session. */
  update(lists: NoticeLists): void {
    this.warnings = lists.configWarnings ?? [];
    this.degraded = lists.configDegraded ?? [];
    for (const toast of configToasts(this.warnings, this.degraded)) {
      const key = `${toast.variant}:${toast.message}`;
      if (this.shown.has(key)) continue;
      this.shown.add(key);
      this.show(toast);
    }
  }

  /** Reads the lists from the reviewer's `status` RPC. True when applied; a
   *  failed call, or one whose connection was dropped, changes nothing. */
  async refresh(
    call: () => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      const status = asObjectLike(await call());
      if (status === undefined || signal.aborted) return false;
      this.update({
        configWarnings: strings(status.configWarnings),
        configDegraded: strings(status.configDegraded),
      });
      return true;
    } catch {
      return false;
    }
  }

  sidebar(): SidebarLine | undefined {
    return sidebarLine(this.warnings, this.degraded);
  }
}
