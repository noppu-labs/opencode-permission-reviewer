// Token-value segments for evidence consumers.

import { normalizeShellRedirections } from "./shell-redirections.ts";
import { lexSegments } from "./shell-scanner.ts";

/** Segments flattened to plain token values plus the separators around each
 *  segment. This is the shared surface evidence consumers (SSH, Git, local
 *  scripts) build on, so the brake's lexer stays the one tokenizer. */
export interface CommandSegment {
  tokens: string[];
  preceding?: string;
  endedBy?: string;
}

export function commandSegments(command: string): CommandSegment[] {
  const segments = lexSegments(command, {
    tokensRemaining: Number.POSITIVE_INFINITY,
    substitutions: "skip",
  });
  return segments.map((segment) => {
    const normalized = normalizeShellRedirections(segment.tokens);
    return {
      tokens: normalized.tokens.map((token) => token.value),
      ...(segment.precededBy === undefined
        ? {}
        : { preceding: segment.precededBy }),
      ...(segment.endedBy === undefined ? {} : { endedBy: segment.endedBy }),
    };
  });
}
