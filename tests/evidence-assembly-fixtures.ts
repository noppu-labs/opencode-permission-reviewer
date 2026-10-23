// The assembleEvidence call shared by the characterisation tests, over the fakes in evidence-assembly-fakes.ts.

import type { AskDecision } from "../src/kernel/actor-context-types.ts";
import type { PermissionRequest } from "../src/kernel/permission-request.ts";
import type { ReviewerConfig } from "../src/kernel/reviewer-config.ts";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import type { ReviewEnvelope } from "../src/modules/context/models/review-envelope.ts";
import { assembleEvidence } from "../src/modules/context/services/evidence-assembler.ts";
import {
  CURRENT,
  PARENT,
  providers,
  reader,
  type Scenario,
} from "./evidence-assembly-fakes.ts";

export interface Run {
  envelope: ReviewEnvelope;
  calls: string[];
  config: ReviewerConfig;
}

export async function assemble(
  pending: PermissionRequest,
  scenario: Scenario = {},
  calls: string[] = [],
): Promise<Run> {
  const config = { ...DEFAULT_CONFIG, ...scenario.config };
  const askDecisions = {
    recentFor: (sessionIDs: string[], limit?: number): AskDecision[] => {
      calls.push(`recentFor ${sessionIDs.join(",")} ${limit}`);
      return scenario.decisions ?? [];
    },
  };
  const envelope = await assembleEvidence(pending, providers(scenario, calls), {
    reader: reader(scenario, calls),
    directory: "/repo",
    worktree: "/repo",
    config,
    ...(scenario.withAskSource ? { askDecisions } : {}),
    ...scenario.context,
  });
  return { envelope, calls, config };
}

export function delegatedSessions(): Record<string, unknown> {
  return {
    [CURRENT]: { id: CURRENT, parentID: PARENT },
    [PARENT]: { id: PARENT },
  };
}
