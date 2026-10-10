// Deterministic credential-read detection over the effective commands: literal credential paths read by a known file reader or through a `<` redirect.

import { elementAt } from "../element-at.ts";
import { shellBasename } from "../shell-lexer.ts";
import type { ShellToken } from "../shell-token.ts";
import { CREDENTIAL_READERS } from "./bash-command-tables.ts";
import { isLiteralPathValue } from "./bash-mutation.ts";
import type { CapabilityFacts } from "./capability-facts.ts";
import type { ParsedCommand, Redirection } from "./capability-types.ts";
import { isSensitivePathToken } from "./sensitive-paths.ts";

/** A known file reader with a literal credential path operand, or any
 *  command with a literal credential path as an input (`<`) redirect target.
 *  Wrappers are already peeled in `effective`, so `sudo cat ...` arrives here
 *  as `cat ...`. Facts accumulate with OR across every command in the
 *  chain. */
export function classifyCredentialReads(
  parsed: ParsedCommand,
  facts: CapabilityFacts,
): void {
  for (const [index, cmd] of parsed.effective.entries()) {
    classifyCredentialCommand(cmd, parsed.redirections[index] ?? [], facts);
  }
}

function classifyCredentialCommand(
  cmd: ShellToken[],
  redirects: Redirection[],
  facts: CapabilityFacts,
): void {
  const first = cmd[0];
  if (first === undefined) return;
  const base = shellBasename(first.value);
  for (const r of redirects) {
    if (inputRedirectReadsCredential(r)) facts.credentialRead = true;
  }
  if (!CREDENTIAL_READERS.has(base)) return;
  for (let i = 1; i < cmd.length; i += 1) {
    const previous = elementAt(cmd, i - 1, "cmd").value;
    if (operandReadsCredential(previous, elementAt(cmd, i, "cmd").value))
      facts.credentialRead = true;
  }
}

function inputRedirectReadsCredential(r: Redirection): boolean {
  return (
    r.operator === "<" &&
    isLiteralPathValue(r.target) &&
    isSensitivePathToken(r.target)
  );
}

/** A token following a redirect operator is that redirect's target, not a
 *  path operand: `cat > .env` writes the file, it does not read it. The
 *  regex covers `<`, `>`, `>>` and `<<` as well as fd-numbered operators. */
function operandReadsCredential(previous: string, value: string): boolean {
  if (/^[0-9]*[<>]/.test(previous)) return false;
  if (value === "--") return false;
  if (value.startsWith("-") && value.length > 1) return false;
  if (value.startsWith("<") || value.startsWith(">")) return false;
  return isLiteralPathValue(value) && isSensitivePathToken(value);
}
