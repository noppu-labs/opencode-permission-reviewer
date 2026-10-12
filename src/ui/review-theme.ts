import type { ColorInput } from "@opentui/core";
import type { ReviewTheme } from "./components.tsx";
import { object } from "./host-value.ts";

const color = (value: unknown): ColorInput | undefined => {
  if (typeof value === "string") return value;
  const candidate = object(value);
  return candidate && "buffer" in candidate ? (value as ColorInput) : undefined;
};
const FALLBACK_THEME: Record<keyof ReviewTheme, string> = {
  backgroundPanel: "#111111",
  text: "#eeeeee",
  textMuted: "#999999",
  info: "#4da3ff",
  success: "#48c774",
  error: "#ff5c5c",
};

export function resolveReviewTheme(value: unknown): ReviewTheme {
  const host = object(value);
  if (!host) return FALLBACK_THEME;
  const background = object(host.background);
  const surface = object(background?.surface);
  const raised = object(background?.raised);
  const text = object(host.text);
  const status = object(text?.status);
  const feedback = object(text?.feedback);
  const infoFeedback = object(feedback?.info);
  const successFeedback = object(feedback?.success);
  const errorFeedback = object(feedback?.error);
  return {
    backgroundPanel:
      color(surface?.overlay) ??
      color(raised?.base) ??
      color(host.backgroundPanel) ??
      FALLBACK_THEME.backgroundPanel,
    text:
      color(text?.default) ??
      color(text?.base) ??
      color(host.text) ??
      FALLBACK_THEME.text,
    textMuted:
      color(text?.subdued) ??
      color(text?.muted) ??
      color(host.textMuted) ??
      FALLBACK_THEME.textMuted,
    info:
      color(status?.running) ??
      color(infoFeedback?.base) ??
      color(host.info) ??
      FALLBACK_THEME.info,
    success:
      color(successFeedback?.default) ??
      color(successFeedback?.base) ??
      color(host.success) ??
      FALLBACK_THEME.success,
    error:
      color(errorFeedback?.default) ??
      color(errorFeedback?.base) ??
      color(host.error) ??
      FALLBACK_THEME.error,
  };
}
