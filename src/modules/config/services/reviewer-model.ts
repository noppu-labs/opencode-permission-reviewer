import type {
  EscalationReviewerConfig,
  ReviewerConfig,
} from "../../../kernel/reviewer-config.ts";
import { nonEmptyStringOr } from "../models/config-fields.ts";
import { boundedInteger } from "../models/config-knobs.ts";
import {
  SYSTEM_ONE_PROVIDERS,
  type SystemOneProvider,
} from "../models/system-one-providers.ts";

export interface ModelRef {
  readonly providerID: string;
  readonly modelID: string;
}

export function splitModel(model: string): ModelRef {
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

export function systemOneProviderFor(
  model: string,
): (ModelRef & { readonly provider: SystemOneProvider }) | undefined {
  let parsed: ModelRef;
  try {
    parsed = splitModel(model);
  } catch {
    return;
  }
  if (!Object.hasOwn(SYSTEM_ONE_PROVIDERS, parsed.providerID)) return;
  const provider = SYSTEM_ONE_PROVIDERS[parsed.providerID];
  if (!provider?.accepts(parsed.modelID)) return;
  return { provider, ...parsed };
}

export function isSystemOneReviewerModel(model: string): boolean {
  // System One models use the typed System One API rather than a chat-session transport.
  return systemOneProviderFor(model) !== undefined;
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
