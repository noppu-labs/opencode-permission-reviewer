// Provenanced fact builders and command-shape probes for the bash capability analyzer.

import type { Provenanced } from "../actor-context-types.ts";
import { shellBasename } from "../shell-lexer.ts";
import type { ShellToken } from "../shell-token.ts";
import { INTERPRETERS } from "./bash-command-tables.ts";

/** Command substitution (`$(...)` or backticks) makes analysis opaque. */
export function hasCommandSubstitution(command: string): boolean {
  return /\$\(|`/.test(command);
}

export function staticFact(
  value: boolean | "unknown",
  notes?: string[],
): Provenanced<boolean | "unknown"> {
  return {
    value,
    source: "static-analysis",
    confidence: value === "unknown" ? "unknown" : "high",
    ...(notes === undefined || notes.length === 0 ? {} : { notes }),
  };
}

export function heuristicFact(
  value: boolean | "unknown",
  notes?: string[],
): Provenanced<boolean | "unknown"> {
  return {
    value,
    source: "heuristic",
    confidence: value === "unknown" ? "unknown" : "medium",
    ...(notes === undefined || notes.length === 0 ? {} : { notes }),
  };
}

export function hasInlineCodeOption(tokens: ShellToken[]): {
  interpreter: string;
  inline: boolean;
} {
  const first = tokens[0];
  if (first === undefined) return { interpreter: "", inline: false };
  const base = shellBasename(first.value);
  if (!INTERPRETERS.has(base)) return { interpreter: base, inline: false };
  for (const token of tokens.slice(1)) {
    const v = token.value;
    if (
      v === "-c" ||
      v === "--command" ||
      v === "-e" ||
      v.startsWith("--command=")
    ) {
      return { interpreter: base, inline: true };
    }
  }
  return { interpreter: base, inline: false };
}
