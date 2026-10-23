import { describe, expect, test } from "bun:test";
import type { CapabilityAssessment } from "../src/modules/analysis/capability/models/capability-types.ts";
import { validateCondition } from "../src/modules/config/models/config-rule-condition.ts";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import type { Provenanced } from "../src/modules/context/models/actor-context-types.ts";
import { conditionMatches } from "../src/modules/policy/policy-conditions.ts";
import {
  capability,
  type FactValue,
  FLAGS,
  type Flag,
  someone,
} from "./policy-fixtures.ts";

type Cap = CapabilityAssessment;
type Fact = Provenanced<FactValue>;

const FACT_OF: Record<Flag, (cap: Cap) => Fact> = {
  writesWorkspace: (cap: Cap): Fact => cap.writeEffects.workspaceWrite,
  writesExternal: (cap: Cap): Fact => cap.writeEffects.externalWrite,
  writesTemporary: (cap: Cap): Fact => cap.writeEffects.temporaryWrite,
  deletion: (cap: Cap): Fact => cap.writeEffects.deletion,
  executesCode: (cap: Cap): Fact => cap.executesCode,
  createsAdHocCode: (cap: Cap): Fact => cap.createsAdHocCode,
  packageManagement: (cap: Cap): Fact => cap.invokesPackageLifecycleScripts,
  gitMutation: (cap: Cap): Fact => cap.git.possible,
  networkObserved: (cap: Cap): Fact => cap.network.observed,
  credentialRead: (cap: Cap): Fact => cap.credentialRead,
  privilegeEscalation: (cap: Cap): Fact => cap.process.privilegeEscalation,
  remoteEnabled: (cap: Cap): Fact => cap.remote.enabled,
  persistence: (cap: Cap): Fact => cap.process.persistence,
};

/** A capability whose condition-backing facts log each read into `reads`.
 *  Every fact is true except `failing`, which reads as "unknown". */
function recordingCapability(
  reads: Flag[],
  failing?: Flag,
): CapabilityAssessment {
  const cap = capability();
  for (const flag of FLAGS) {
    Object.defineProperty(FACT_OF[flag](cap), "value", {
      get: () => {
        reads.push(flag);
        return flag === failing ? "unknown" : true;
      },
    });
  }
  return cap;
}

const everyFlag = Object.fromEntries(FLAGS.map((flag) => [flag, true]));

describe("condition flag order", () => {
  test("validated flag conditions keep the canonical flag order", () => {
    const reversed = Object.fromEntries(
      [...FLAGS].reverse().map((flag) => [flag, true]),
    );
    expect(Object.keys(validateCondition(reversed) ?? {})).toEqual([...FLAGS]);
  });

  test("capability flags are read in the canonical order", () => {
    const reads: Flag[] = [];
    const cap = recordingCapability(reads);
    expect(conditionMatches(everyFlag, cap, someone, DEFAULT_CONFIG)).toBe(
      true,
    );
    expect(reads).toEqual([...FLAGS]);
  });

  test("the first flag whose fact is not true stops the reads", () => {
    for (const [index, failing] of FLAGS.entries()) {
      const reads: Flag[] = [];
      const cap = recordingCapability(reads, failing);
      expect(conditionMatches(everyFlag, cap, someone, DEFAULT_CONFIG)).toBe(
        false,
      );
      expect(reads).toEqual(FLAGS.slice(0, index + 1));
    }
  });
});
