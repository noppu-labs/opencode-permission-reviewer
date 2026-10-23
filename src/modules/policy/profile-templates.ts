import type { PolicyRule } from "../../types.ts";

/**
 * The conservative profile routing templates. These are NOT active by default
 * (observe mode ships with an empty rule set). They are documented here so the
 * engine can be tested against them and so enforce-mode users can opt into them.
 */
export const PROFILE_TEMPLATES: PolicyRule[] = [
  {
    id: "read-only-workspace-write",
    source: "builtin",
    when: { actorProfile: ["read-only"], writesWorkspace: true },
    effect: "manual",
    reason: "read-only actor attempting workspace write",
  },
  {
    id: "read-only-code-execution",
    source: "builtin",
    when: { actorProfile: ["read-only"], executesCode: true },
    effect: "manual",
    reason: "read-only actor attempting code execution",
  },
  {
    id: "any-actor-package-untrusted",
    source: "builtin",
    when: {
      packageManagement: true,
      repositoryTrust: ["untrusted", "unknown"],
    },
    effect: "manual",
    reason: "package management in an untrusted or unknown repository",
  },
  {
    id: "unknown-actor-remote-mutation",
    source: "builtin",
    when: { actorProfile: ["unknown"], remoteEnabled: true },
    effect: "manual",
    reason: "unknown actor attempting remote operation",
  },
  {
    id: "unknown-actor-external-write",
    source: "builtin",
    when: { actorProfile: ["unknown"], writesExternal: true },
    effect: "manual",
    reason: "unknown actor attempting external write",
  },
];
