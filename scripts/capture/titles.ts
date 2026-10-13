import type { ScreenName } from "./screens.ts";

/** One sentence per screen image; Biome's SVG accessibility rule needs a title and readers get the gist. */
export const SCREEN_TITLES: Record<ScreenName, string> = {
  "handoff-progress":
    "Two progress strips for a git push: Jev (typesafe-ai/jev-1.13.0) reviewing at 2.1s, then gpt-6-luna reviewing after Jev's escalation at 7.3s.",
  "result-attribution":
    "Three result strips: an approval by Jev, an approval by gpt-6-luna after Jev's escalation, and a block by gpt-6-luna confirming Jev's denial.",
  "v1-overlay-handoff":
    "The V1 overlay while gpt-6-luna reviews a git push after Jev failed with a timeout, 31.4s in.",
  "result-triggers":
    "Nine result strips showing who decided and why: Jev alone, or gpt-6-luna after each kind of hand-off, including a fail-closed block.",
  "long-command-before":
    "Version 3.0.0 with a long command: the progress strip, result strip and V1 overlay show the start of the heredoc and cut the command before its final commands.",
  "long-command-after":
    "The same long command now: the heredoc is collapsed to a 40-line marker and the end of the command, a curl piped to sh, stays visible in the progress strip, result strip and V1 overlay.",
  "manual-toasts":
    "Four manual-review toasts: the reasoning reviewer escalated, unavailable, out of review time, and the no hand-off case.",
  "config-warnings":
    "Config warnings: two toasts (an inactive setting and a degraded config), three sidebar lines, and the healthy case with neither.",
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/** The title element for a screen, as it appears in its SVG. */
export function titleElement(title: string): string {
  return `<title>${escapeXml(title)}</title>`;
}

/** Puts a title right after the opening root tag, so the SVG has an accessible name. */
export function withTitle(svg: string, title: string): string {
  const root = svg.match(/<svg\b[^>]*>/);
  if (root === null) throw new Error("no <svg> element to title");
  const end = (root.index ?? 0) + root[0].length;
  return `${svg.slice(0, end)}${titleElement(title)}${svg.slice(end)}`;
}
