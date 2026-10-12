// Recognizes the redirection operator, if any, that starts at a position in a token.

import { type ShellToken, tokenCharIsQuoted } from "./shell-token.ts";

/** Multi-character operators in match order: the three-character forms
 *  first, so `&>>` is never read as `&>`. */
const REDIRECTION_OPERATORS = [
  "&>>",
  "<<<",
  "<<-",
  "&>",
  ">>",
  ">|",
  ">&",
  "<<",
  "<&",
  "<>",
] as const;

/** The character at `offset` when it can act as an operator, else "". */
function liveChar(token: ShellToken, offset: number): string {
  return offset < token.value.length && !tokenCharIsQuoted(token, offset)
    ? token.value.charAt(offset)
    : "";
}

function redirectionOperatorAt(
  token: ShellToken,
  index: number,
): string | undefined {
  const first = liveChar(token, index);
  const tail = `${first}${liveChar(token, index + 1)}${liveChar(token, index + 2)}`;
  const operator = REDIRECTION_OPERATORS.find((candidate) =>
    tail.startsWith(candidate),
  );
  if (operator !== undefined) return operator;
  if (first === ">" || first === "<") return first;
  return undefined;
}

export function nextRedirection(
  token: ShellToken,
  start: number,
): { index: number; operator: string } | undefined {
  for (let index = start; index < token.value.length; index += 1) {
    const operator = redirectionOperatorAt(token, index);
    if (operator !== undefined) return { index, operator };
  }
  return undefined;
}
