// Fake reader and providers for the assembleEvidence characterisation tests; every call lands in one shared log.

import type { AskDecision } from "../src/kernel/actor-context-types.ts";
import type { ReviewerConfig } from "../src/kernel/reviewer-config.ts";
import type { ContextReader } from "../src/modules/context/ports.ts";
import type { EvidenceAssemblyContext } from "../src/modules/context/services/evidence-assembler.ts";
import type {
  EvidenceFragment,
  EvidenceProvider,
  EvidenceProviderInput,
} from "../src/modules/evidence/providers/provider.ts";

export const CURRENT = "ses_main";
export const PARENT = "ses_parent";

export interface Scenario {
  messages?: unknown;
  /** Omit to build a reader without `intentMessages`. */
  intentMessages?: unknown;
  sessions?: Record<string, unknown>;
  /** "hang" makes that provider's collect never settle. */
  fragments?: Array<[string, EvidenceFragment | "hang"]>;
  /** Make the current session's messages read never settle. */
  hangMessages?: boolean;
  decisions?: AskDecision[];
  /** Omit to leave the ask-decision source out of the context. */
  withAskSource?: boolean;
  config?: Partial<ReviewerConfig>;
  context?: Partial<EvidenceAssemblyContext>;
}

type Read = (
  sessionID: string,
  directory: string,
  limit: number,
) => Promise<unknown>;

/** A read that logs its call and answers the current session only. */
function logged(kind: string, calls: string[], reply: unknown): Read {
  return async (
    sessionID: string,
    directory: string,
    limit: number,
  ): Promise<unknown> => {
    calls.push(`${kind} ${sessionID} ${directory} ${limit}`);
    return sessionID === CURRENT ? reply : [];
  };
}

export function reader(scenario: Scenario, calls: string[]): ContextReader {
  const sessions = scenario.sessions ?? {};
  const result: ContextReader = {
    messages: logged(
      "messages",
      calls,
      scenario.hangMessages ? new Promise(() => {}) : (scenario.messages ?? []),
    ),
    session: async (sessionID: string, directory: string): Promise<unknown> => {
      calls.push(`session ${sessionID} ${directory}`);
      return sessions[sessionID] ?? null;
    },
  };
  if ("intentMessages" in scenario)
    result.intentMessages = logged(
      "intentMessages",
      calls,
      scenario.intentMessages,
    );
  return result;
}

export function providers(
  scenario: Scenario,
  calls: string[],
): EvidenceProvider[] {
  return (scenario.fragments ?? []).map(([id, fragment]) => ({
    id,
    collect: async (
      input: EvidenceProviderInput,
    ): Promise<EvidenceFragment> => {
      const { request, ...scope } = input;
      calls.push(`collect ${id} ${request.id} ${JSON.stringify(scope)}`);
      return fragment === "hang" ? new Promise(() => {}) : fragment;
    },
  }));
}
