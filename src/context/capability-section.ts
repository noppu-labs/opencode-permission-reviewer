// The CAPABILITY_ASSESSMENT prompt section: the capability assessment flattened to its values.

import type { CapabilityAssessment } from "../capability/capability-types.ts";
import { stableJson } from "./prompt-budget.ts";

export function renderCapability(
  cap: CapabilityAssessment,
  max: number,
): string {
  return stableJson(
    {
      actionClass: cap.actionClass.value,
      summary: cap.summary,
      executesCode: cap.executesCode.value,
      createsAdHocCode: cap.createsAdHocCode.value,
      invokesPackageLifecycleScripts: cap.invokesPackageLifecycleScripts.value,
      invokesExistingTestRunner: cap.invokesExistingTestRunner.value,
      writeEffects: {
        temporaryWrite: cap.writeEffects.temporaryWrite.value,
        workspaceWrite: cap.writeEffects.workspaceWrite.value,
        externalWrite: cap.writeEffects.externalWrite.value,
        deletion: cap.writeEffects.deletion.value,
      },
      network: {
        observed: cap.network.observed.value,
        possible: cap.network.possible.value,
        ...(cap.network.destinations.length === 0
          ? {}
          : { destinations: cap.network.destinations }),
      },
      process: {
        childProcesses: cap.process.childProcesses.value,
        persistence: cap.process.persistence.value,
        privilegeEscalation: cap.process.privilegeEscalation.value,
      },
      remote: {
        enabled: cap.remote.enabled.value,
        mutationHint: cap.remote.mutationHint.value,
      },
      git: { mutation: cap.git.possible.value },
      parserCompleteness: cap.parserCompleteness,
      ...(cap.analysisWarnings.length === 0
        ? {}
        : { warnings: cap.analysisWarnings }),
    },
    max,
  );
}
