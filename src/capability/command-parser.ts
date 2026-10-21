import { lexSegmentsBounded, newAnalysisBudget } from "../shell-lexer.ts";
import type { ShellToken } from "../shell-token.ts";
import { walkBodyCommands } from "./body-command-walk.ts";
import type { ParsedCommand } from "./capability-types.ts";
import { newWalked, walkSegments } from "./command-walk.ts";
import { extractHeredocs } from "./heredoc-extractor.ts";
import { withScanBudget } from "./heredoc-scan-budget.ts";
import { mainFeeds } from "./walk-feeds.ts";

/*
 * Reusable command parser.
 *
 * Wraps the existing quote-aware lexer and the heredoc pre-extractor into a
 * single `ParsedCommand` structure consumed by the capability analyzer (and
 * available to evidence providers). The emergency brake uses the same bounded
 * lexer and heredoc sanitization directly, so both paths share command and
 * redirection semantics.
 *
 * Dynamic constructs (variables, globs, command substitution, dynamic heredoc
 * bodies) are flagged so the analyzer can mark `parserCompleteness` honestly.
 */

/** Parse a raw bash command into the reusable structure. */
export function parseCommand(rawCommand: string): ParsedCommand {
  return withScanBudget(rawCommand.length, () => parse(rawCommand));
}

function parse(rawCommand: string): ParsedCommand {
  const extraction = extractHeredocs(rawCommand);
  const { sanitizedCommand, heredocs, hasDynamicConstructs } = extraction;
  // Bounded from the start: oversized input or token floods stop HERE, and
  // every segment shares one effective-command budget so wide inputs cannot
  // stay under per-segment ceilings while the total grows unbounded.
  const lex = lexSegmentsBounded(sanitizedCommand);
  const budget = newAnalysisBudget("default", "bash", {
    commands: [],
    unresolved: false,
  });
  const walked = newWalked();
  const stopped = walkSegments(lex.segments, budget, walked);
  walked.truncated = lex.truncated || stopped;
  const dyn = looksDynamic(sanitizedCommand);
  const dynamic =
    hasDynamicConstructs ||
    dyn ||
    walked.segments.some((segment) => segmentHasDynamic(segment.tokens));
  // The commands the heredoc bodies run, the command strings' among them,
  // come after the command's own, and leave the dynamic flags as the command
  // alone sets them.
  const feeds = mainFeeds(
    sanitizedCommand,
    walked,
    extraction.scripts,
    lex.scripts,
  );
  walkBodyCommands(
    [...extraction.bodyCommands, ...lex.bodyCommands],
    extraction.bodyUnresolved || lex.bodyUnresolved,
    budget,
    walked,
    feeds,
    [extraction.scripts, lex.scripts],
  );

  return {
    sanitizedCommand,
    segments: walked.segments,
    effective: walked.effective,
    redirections: walked.redirections,
    heredocs,
    hasDynamicConstructs: dynamic,
    analysisTruncated: walked.truncated,
    heads: walked.heads,
    segmentRedirections: walked.parts.map((part) => part.segmentRedirections),
    ...(walked.remote.length > 0 && { remoteCommands: walked.remote }),
    ...(walked.stdinCode && { stdinCode: true }),
  };
}

/** Whether the raw command contains dynamic constructs the lexer leaves intact.
 *  Command substitution (`$(...)` or bare backticks) makes analysis OPAQUE;
 *  variables and globs make it PARTIAL. Single-quoted regions are literal and
 *  must NOT trip the detector — so we strip them before checking. */
function looksDynamic(command: string): boolean {
  // Remove single-quoted regions (everything between unescaped `'` pairs) so
  // `echo 'literal $VAR'` does not false-positive. Double quotes still allow
  // expansion in bash, so they are left intact.
  const literal = command.replace(/'[^']*'/g, "");
  return /\$\(|`|\$\{|\$[A-Za-z_]|[?*]\s|<\(|>\(|\[\[/.test(literal);
}

/** Whether a token list itself carries dynamic markers. */
function segmentHasDynamic(tokens: ShellToken[]): boolean {
  return tokens.some(
    (tok) => /\$|[*?]/.test(tok.value) && !isAllLiteral(tok.raw),
  );
}

/** A word made only of `'…'` and `$'…'` parts. `$'…'` text is literal too:
 *  its value is the decoded text, and a `$`, `*` or `?` that an escape
 *  produces is quoted data, not an expansion or a glob. */
const ALL_LITERAL = /^(?:'[^']*'|\$'(?:[^'\\]|\\[\s\S])*')+$/;

function isAllLiteral(raw: string): boolean {
  // Anything else with $ or glob chars is dynamic.
  return ALL_LITERAL.test(raw);
}
