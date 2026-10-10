// The fact record analyzeCapability threads through its passes, and the write and class updates they share.

import type { CapabilityActionClass } from "../types.ts";
import { classifyPath } from "./bash-mutation.ts";

type ClassConfidence = "high" | "medium" | "low";

/** Facts accumulated across the analyzer's passes. Every boolean starts
 *  false and is only ever set to true. `dominantClass` and `classConfidence`
 *  change together, in pass order. */
export interface CapabilityFacts {
  executesCode: boolean;
  executesRepositoryCode: boolean;
  createsAdHocCode: boolean;
  invokesTestRunner: boolean;
  invokesPackageLifecycle: boolean;
  temporaryWrite: boolean;
  workspaceWrite: boolean;
  externalWrite: boolean;
  deletion: boolean;
  networkObserved: boolean;
  networkPossible: boolean;
  childProcesses: boolean;
  persistence: boolean;
  privilegeEscalation: boolean;
  remoteEnabled: boolean;
  remoteMutation: boolean;
  gitObserved: boolean;
  gitMutation: boolean;
  credentialRead: boolean;
  sawReadOnlyExecutable: boolean;
  sawUnknownExecutable: boolean;
  destinations: string[];
  dominantClass: CapabilityActionClass;
  classConfidence: ClassConfidence;
}

/** The directories write targets are classified against. */
export interface AnalysisRoots {
  directory: string;
  worktree: string;
}

export function newCapabilityFacts(): CapabilityFacts {
  return {
    executesCode: false,
    executesRepositoryCode: false,
    createsAdHocCode: false,
    invokesTestRunner: false,
    invokesPackageLifecycle: false,
    temporaryWrite: false,
    workspaceWrite: false,
    externalWrite: false,
    deletion: false,
    networkObserved: false,
    networkPossible: false,
    childProcesses: false,
    persistence: false,
    privilegeEscalation: false,
    remoteEnabled: false,
    remoteMutation: false,
    gitObserved: false,
    gitMutation: false,
    credentialRead: false,
    sawReadOnlyExecutable: false,
    sawUnknownExecutable: false,
    destinations: [],
    dominantClass: "unknown",
    classConfidence: "low",
  };
}

/** Record the temporary, workspace or external write a target path makes. */
export function recordWrite(
  facts: CapabilityFacts,
  target: string,
  roots: AnalysisRoots,
): void {
  const cls = classifyPath(target, roots.directory, roots.worktree);
  if (cls.temporary) facts.temporaryWrite = true;
  if (cls.workspace) facts.workspaceWrite = true;
  if (cls.external) facts.externalWrite = true;
}

/** Set the action class with high confidence, replacing any earlier one. */
export function claimClass(
  facts: CapabilityFacts,
  actionClass: CapabilityActionClass,
): void {
  facts.dominantClass = actionClass;
  facts.classConfidence = "high";
}

/** Set the action class with high confidence unless one is already set. */
export function claimUnsetClass(
  facts: CapabilityFacts,
  actionClass: CapabilityActionClass,
): void {
  if (facts.dominantClass === "unknown") claimClass(facts, actionClass);
}
