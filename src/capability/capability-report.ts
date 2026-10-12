// Builds the CapabilityAssessment from the analyzer's accumulated facts: provenanced facts, summary, completeness and warnings.

import type { Provenanced } from "../actor-context-types.ts";
import {
  hasCommandSubstitution,
  heuristicFact,
  staticFact,
} from "./bash-facts.ts";
import type { CapabilityFacts } from "./capability-facts.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
  ParserCompleteness,
} from "./capability-types.ts";

function staticFlag(flag: boolean): Provenanced<boolean | "unknown"> {
  return staticFact(flag ? true : "unknown");
}

function heuristicFlag(flag: boolean): Provenanced<boolean | "unknown"> {
  return heuristicFact(flag ? true : "unknown");
}

function analysisWarnings(
  parsed: ParsedCommand,
  heredocTruncated: boolean,
): string[] {
  const warnings: string[] = [];
  if (parsed.hasDynamicConstructs) {
    warnings.push(
      "command contains dynamic constructs (variables, substitution, or globs)",
    );
  }
  if (parsed.heredocs.some((h) => h.dynamic)) {
    warnings.push("one or more heredoc bodies have unresolvable expansion");
  }
  // An unterminated or over-bound heredoc body means the scan never saw the
  // terminator: what follows cannot be proven to be commands rather than body
  // text, so the analysis cannot claim completeness.
  if (heredocTruncated) {
    warnings.push(
      "one or more heredoc bodies were truncated or never terminated",
    );
  }
  if (parsed.analysisTruncated) {
    warnings.push(
      "command structure exceeded the static analysis depth or expansion budget",
    );
  }
  return warnings;
}

function parserCompleteness(
  parsed: ParsedCommand,
  heredocTruncated: boolean,
): ParserCompleteness {
  if (parsed.hasDynamicConstructs) {
    return hasCommandSubstitution(parsed.sanitizedCommand) ||
      parsed.heredocs.some((h) => h.dynamic)
      ? "opaque"
      : "partial";
  }
  return parsed.analysisTruncated || heredocTruncated
    ? "partial"
    : "complete-for-supported-form";
}

function summaryOf(facts: CapabilityFacts): string {
  const summaryParts: string[] = [facts.dominantClass];
  if (facts.createsAdHocCode) summaryParts.push("ad-hoc code");
  if (facts.executesRepositoryCode) summaryParts.push("repository code");
  if (facts.invokesPackageLifecycle)
    summaryParts.push("package lifecycle scripts");
  if (facts.gitMutation) summaryParts.push("git mutation");
  if (facts.networkObserved) summaryParts.push("network");
  if (facts.persistence) summaryParts.push("persistence");
  if (facts.privilegeEscalation) summaryParts.push("privilege escalation");
  return summaryParts.join(", ");
}

export function assessmentFrom(
  parsed: ParsedCommand,
  facts: CapabilityFacts,
): CapabilityAssessment {
  const heredocTruncated = parsed.heredocs.some((h) => h.truncated);
  const warnings = analysisWarnings(parsed, heredocTruncated);
  const networkPossible = facts.networkObserved || facts.networkPossible;
  return {
    actionClass: {
      value: facts.dominantClass,
      source: "static-analysis",
      confidence: facts.classConfidence,
    },
    summary: summaryOf(facts),
    executesCode: staticFlag(facts.executesCode),
    executesRepositoryCode: staticFlag(facts.executesRepositoryCode),
    createsAdHocCode: staticFlag(facts.createsAdHocCode),
    invokesExistingTestRunner: staticFlag(facts.invokesTestRunner),
    invokesPackageLifecycleScripts: staticFlag(facts.invokesPackageLifecycle),
    credentialRead: staticFlag(facts.credentialRead),
    writeEffects: {
      temporaryWrite: staticFlag(facts.temporaryWrite),
      workspaceWrite: staticFlag(facts.workspaceWrite),
      externalWrite: staticFlag(facts.externalWrite),
      deletion: staticFlag(facts.deletion),
    },
    network: {
      observed: staticFlag(facts.networkObserved),
      possible: heuristicFlag(networkPossible),
      destinations: facts.destinations,
      observedAccess: staticFlag(facts.networkObserved),
      possibleAccess: heuristicFlag(networkPossible),
    },
    process: {
      childProcesses: staticFlag(facts.childProcesses),
      persistence: staticFlag(facts.persistence),
      privilegeEscalation: staticFlag(facts.privilegeEscalation),
    },
    remote: {
      enabled: staticFlag(facts.remoteEnabled),
      mutationHint: staticFlag(facts.remoteMutation),
    },
    git: {
      observed: staticFlag(facts.gitObserved),
      possible: heuristicFlag(facts.gitMutation),
      observedAccess: staticFlag(facts.gitObserved),
      possibleAccess: heuristicFact("unknown"),
    },
    parserCompleteness: parserCompleteness(parsed, heredocTruncated),
    analysisWarnings: warnings,
  };
}
