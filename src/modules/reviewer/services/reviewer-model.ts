import type {
  EscalationReviewerConfig,
  ReviewerConfig,
} from "../../../types.ts";
import { nonEmptyStringOr } from "../../config/models/config-fields.ts";
import { boundedInteger } from "../../config/models/config-knobs.ts";

export function splitModel(model: string): {
  providerID: string;
  modelID: string;
} {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(
      `Invalid reviewer model "${model}"; expected provider/model`,
    );
  }
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  };
}

export function isSystemOneReviewerModel(model: string): boolean {
  let parsed: { providerID: string; modelID: string };
  try {
    parsed = splitModel(model);
  } catch {
    return false;
  }
  // Jev uses the typed System One API rather than a chat-session transport.
  return (
    ((parsed.providerID === "opencode" ||
      parsed.providerID === "typesafe-ai") &&
      /^jev(?:-|$)/.test(parsed.modelID)) ||
    (parsed.providerID === "commandcode" && parsed.modelID === "typesafe/jev")
  );
}

export function isProviderModelId(value: unknown): value is string {
  return typeof value === "string" && value.includes("/");
}

/** The escalation reviewer object with a provider/model id that is not a
 *  System One model, or undefined when the value cannot be one. */
function escalationReviewerSource(
  value: unknown,
): (Record<string, unknown> & { model: string }) | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return;
  const source = value as Record<string, unknown>;
  if (
    !isProviderModelId(source.model) ||
    isSystemOneReviewerModel(source.model)
  )
    return;
  return source as Record<string, unknown> & { model: string };
}

export function resolveEscalationReviewer(
  value: unknown,
  defaults: ReviewerConfig,
): EscalationReviewerConfig | undefined {
  const source = escalationReviewerSource(value);
  if (source === undefined) return;
  return {
    model: source.model,
    variant: nonEmptyStringOr(source.variant, defaults.variant),
    outputFormat: source.outputFormat === "text" ? "text" : "json_schema",
    timeoutMs: boundedInteger(
      source.timeoutMs,
      defaults.timeoutMs,
      5_000,
      600_000,
    ),
  };
}

export function isValidEscalationReviewer(value: unknown): boolean {
  const source = escalationReviewerSource(value);
  if (source === undefined) return false;
  return (
    (source.variant === undefined ||
      (typeof source.variant === "string" && source.variant !== "")) &&
    (source.outputFormat === undefined ||
      source.outputFormat === "text" ||
      source.outputFormat === "json_schema") &&
    (source.timeoutMs === undefined || Number.isInteger(source.timeoutMs))
  );
}
