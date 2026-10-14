import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, resolveConfig } from "../config.ts";
import { countInvalidPolicyRules } from "../config-policy-rules.ts";
import type { ReviewerConfig } from "../types.ts";
import { type ConfigLayer, readConfigLayer } from "./layer-read.ts";
import type { InlineOptionsTrust } from "./sources.ts";
import { mergeWithTrustBoundary } from "./trust-boundary.ts";
import { TRUST_BOUNDARY_KEYS } from "./trust-boundary-keys.ts";
import {
  globalLayerDegradation,
  inlineDegradation,
} from "./trusted-degradation.ts";

/** Optional override used by unit tests so a developer's personal global config
 *  cannot leak into loader assertions. Production always uses the real path. */
let globalConfigPathOverride: string | undefined;

/** Path to the global user config. Exposed for testability. */
export function globalConfigPath(): string {
  return (
    globalConfigPathOverride ??
    join(homedir(), ".config", "opencode", "permission-reviewer.jsonc")
  );
}

/** Test-only: redirect (or clear) the global config path. */
export function setGlobalConfigPathForTests(path: string | undefined): void {
  globalConfigPathOverride = path;
}

/** Path to the project-local config. Exposed for testability. */
export function projectConfigPath(directory: string): string {
  return join(directory, ".opencode", "permission-reviewer.jsonc");
}

export interface LoadOptions {
  /** Off for a caller that shows `configWarnings` another way, such as the TUI
   *  from server statuses. */
  printConfigWarnings?: boolean;
}

/** Load and merge config from global, project, and inline sources.
 *
 * Precedence (lowest to highest): builtin defaults → global → project → inline,
 * with one deliberate exception: security-sensitive fields cross a trust
 * boundary where the untrusted project layer can only TIGHTEN the trusted
 * baseline (see mergeWithTrustBoundary), and that hardening survives even
 * when inline set the same field.
 *
 * When no global or project files exist (the common case), the result is
 * byte-identical to calling `resolveConfig(inlineOptions)` directly. */
export function loadResolvedConfig(
  inlineOptions: Record<string, unknown> | undefined,
  directory?: string,
  inlineTrust: InlineOptionsTrust = "trusted",
  { printConfigWarnings = true }: LoadOptions = {},
): ReviewerConfig {
  const globalLayer = readConfigLayer(globalConfigPath());
  const projectLayer: ConfigLayer =
    directory !== undefined
      ? readConfigLayer(projectConfigPath(directory))
      : { raw: {}, status: "missing" };
  for (const layer of [globalLayer, projectLayer]) {
    if (layer.warning !== undefined) console.warn(layer.warning);
  }
  const degraded = [
    ...globalLayerDegradation(globalLayer),
    ...inlineDegradation(inlineOptions, inlineTrust),
  ];
  // Dropped project rules are warned about but never degrade the config:
  // configDegraded describes trusted sources only, and project rules cannot
  // weaken trusted restrictions anyway.
  const invalidProjectRules = countInvalidPolicyRules(
    projectLayer.raw.policyRules,
  );
  if (invalidProjectRules > 0) {
    console.warn(
      `permission-reviewer: ${invalidProjectRules} policy rule(s) in the project config are invalid and were dropped`,
    );
  }
  const out = mergeLayers(
    globalLayer.raw,
    projectLayer.raw,
    inlineOptions ?? {},
    inlineTrust,
  );
  if (degraded.length > 0) out.configDegraded = degraded;
  const config = resolveConfig(out);
  if (printConfigWarnings) {
    for (const warning of config.configWarnings ?? []) {
      console.warn(`permission-reviewer: ${warning}`);
    }
  }
  return config;
}

function mergeLayers(
  globalRaw: Record<string, unknown>,
  projectRaw: Record<string, unknown>,
  inline: Record<string, unknown>,
  inlineTrust: InlineOptionsTrust,
): Record<string, unknown> {
  const trustedInline = inlineTrust === "trusted";
  // The trusted baseline is seeded with builtin defaults (so clamping always
  // has a floor) and includes inline, which participates as a trusted source
  // the project layer is clamped against.
  const trusted: Record<string, unknown> = {
    ...DEFAULT_CONFIG,
    ...globalRaw,
    ...(trustedInline ? inline : {}),
  };
  const merged = mergeWithTrustBoundary(trusted, projectRaw);
  if (!trustedInline) {
    // Unknown-origin options may only contribute boundary-controlled hardening.
    return mergeWithTrustBoundary(merged, boundaryFields(inline));
  }
  // Inline keeps documented precedence over the project layer for every
  // non-security field (the boundary's own keys are exempt: re-applying inline
  // there could undo project hardening clamped against it).
  const out: Record<string, unknown> = { ...merged };
  for (const [key, value] of Object.entries(inline)) {
    if (!TRUST_BOUNDARY_KEYS.has(key)) out[key] = value;
  }
  return out;
}

function boundaryFields(
  options: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => TRUST_BOUNDARY_KEYS.has(key)),
  );
}
