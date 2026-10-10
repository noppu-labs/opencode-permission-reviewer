// Action class resolution for a command no classifier claimed: the most specific observed surface wins, first match in a fixed order.

import type { CapabilityActionClass } from "../types.ts";
import type { CapabilityFacts, ClassConfidence } from "./capability-facts.ts";

type ResolvedClass = readonly [CapabilityActionClass, ClassConfidence];

/** Pick the class when no classifier claimed one, preferring the most
 *  specific observed surface. */
export function resolveActionClass(facts: CapabilityFacts): void {
  if (facts.dominantClass !== "unknown") return;
  const [actionClass, confidence] =
    effectClass(facts) ?? writeOrReadClass(facts);
  facts.dominantClass = actionClass;
  facts.classConfidence = confidence;
}

/** The first six rules of the chain, in order. */
function effectClass(facts: CapabilityFacts): ResolvedClass | undefined {
  if (facts.deletion) return ["destruction", "high"];
  if (facts.gitMutation) return ["git-mutation", "high"];
  if (facts.externalWrite) return ["external-write", "high"];
  if (facts.createsAdHocCode || facts.executesCode)
    return ["code-execution", facts.createsAdHocCode ? "high" : "medium"];
  if (facts.invokesPackageLifecycle) return ["package-management", "high"];
  if (facts.persistence) return ["persistence", "high"];
  return undefined;
}

/** The rest of the chain, in order, ending in the fallback. */
function writeOrReadClass(facts: CapabilityFacts): ResolvedClass {
  if (facts.privilegeEscalation) return ["privilege-escalation", "high"];
  if (facts.workspaceWrite) return ["workspace-write", "medium"];
  if (facts.temporaryWrite) return ["temporary-write", "high"];
  // An unrecognized executable is present: report unknown rather than
  // read-only. Absence of detected effects is not evidence of absence.
  if (facts.sawUnknownExecutable) return ["unknown", "low"];
  if (facts.sawReadOnlyExecutable || (facts.gitObserved && !facts.gitMutation))
    return ["read-only", "medium"];
  return ["unknown", "low"];
}
