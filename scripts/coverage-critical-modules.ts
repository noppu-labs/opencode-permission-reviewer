// Modules whose coverage is a safety invariant: a line drop here is a likely
// behavioral regression, not a cosmetic gap.
export const CRITICAL_MODULES: ReadonlySet<string> = new Set([
  "src/decision.ts",
  "src/decision-gates.ts",
  "src/decision-schema.ts",
  "src/escalation.ts",
  "src/policy.ts",
  "src/policy/policy-engine.ts",
  "src/policy/policy-conditions.ts",
  "src/policy/profile-templates.ts",
  "src/emergency-brake.ts",
  "src/brake-arguments.ts",
  "src/brake-block-device.ts",
  "src/brake-device-copy.ts",
  "src/brake-device-tools.ts",
  "src/brake-find-root.ts",
  "src/brake-network-export.ts",
  "src/brake-rm-flags.ts",
  "src/brake-root-target.ts",
  "src/opencode/event-normalizer.ts",
  "src/opencode/reply-transport.ts",
  "src/redact.ts",
]);
