// Service-manager and persistence-tool classifiers for one effective command.

import { claimUnsetClass } from "./action-class.ts";
import { PERSISTENCE_TOOLS, SERVICE_MANAGERS } from "./bash-command-tables.ts";
import type { CapabilityFacts } from "./capability-facts.ts";

export function classifyServiceManager(
  base: string,
  facts: CapabilityFacts,
): void {
  if (!SERVICE_MANAGERS.has(base)) return;
  facts.persistence = true;
  facts.childProcesses = true;
  facts.privilegeEscalation = true;
  claimUnsetClass(facts, "service-management");
}

export function classifyPersistenceTool(
  base: string,
  facts: CapabilityFacts,
): void {
  if (!PERSISTENCE_TOOLS.has(base)) return;
  facts.persistence = true;
  facts.childProcesses = true;
}
