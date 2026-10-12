import type { ColorInput } from "@opentui/core";
import { asObjectLike } from "../is-record.ts";
import type { ReviewTheme } from "./components.tsx";

const color = (value: unknown): ColorInput | undefined => {
  if (typeof value === "string") return value;
  const candidate = asObjectLike(value);
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
  const host = asObjectLike(value);
  if (!host) return FALLBACK_THEME;
  const background = asObjectLike(host.background);
  const surface = asObjectLike(background?.surface);
  const raised = asObjectLike(background?.raised);
  const text = asObjectLike(host.text);
  const status = asObjectLike(text?.status);
  const feedback = asObjectLike(text?.feedback);
  const infoFeedback = asObjectLike(feedback?.info);
  const successFeedback = asObjectLike(feedback?.success);
  const errorFeedback = asObjectLike(feedback?.error);
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
