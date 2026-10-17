// Recognizes the redirection operator, if any, that starts at a position in a token.

import { quotedChars, type ShellToken } from "./shell-token.ts";

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
function liveChar(
  token: ShellToken,
  quoted: boolean[],
  offset: number,
): string {
  return offset < token.value.length && !quoted[offset]
    ? token.value.charAt(offset)
    : "";
}

function redirectionOperatorAt(
  token: ShellToken,
  quoted: boolean[],
  index: number,
): string | undefined {
  const first = liveChar(token, quoted, index);
  const tail = `${first}${liveChar(token, quoted, index + 1)}${liveChar(token, quoted, index + 2)}`;
  const operator = REDIRECTION_OPERATORS.find((candidate) =>
    tail.startsWith(candidate),
  );
  if (operator !== undefined) return operator;
  if (first === ">" || first === "<") return first;
  return undefined;
}

/** Every redirection operator of the token, left to right. After an operator
 *  the scan resumes past it, so the list is the one a search from each
 *  operator's end would find. */
export function redirectionsIn(
  token: ShellToken,
): { index: number; operator: string }[] {
  const quoted = quotedChars(token);
  const found: { index: number; operator: string }[] = [];
  let index = 0;
  while (index < token.value.length) {
    const operator = redirectionOperatorAt(token, quoted, index);
    if (operator === undefined) {
      index += 1;
    } else {
      found.push({ index, operator });
      index += operator.length;
    }
  }
  return found;
}
