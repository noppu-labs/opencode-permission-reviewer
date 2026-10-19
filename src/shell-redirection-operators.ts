// Recognizes the redirection operator, if any, that starts at a position in a token.

import { opaqueChars, operatorChars, type ShellToken } from "./shell-token.ts";

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

/** The character at `offset` when it can act as an operator, else "". The
 *  text a substitution holds never starts an operator: the characters after
 *  it are not read as part of one that begins inside it. */
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
  jumped: boolean[],
  index: number,
): string | undefined {
  const first = liveChar(token, quoted, index);
  if (first === "" && jumped[index]) return undefined;
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
  const quoted = operatorChars(token);
  const jumped = opaqueChars(token);
  const found: { index: number; operator: string }[] = [];
  let index = 0;
  while (index < token.value.length) {
    const operator = redirectionOperatorAt(token, quoted, jumped, index);
    if (operator === undefined) {
      index += 1;
    } else {
      found.push({ index, operator });
      index += operator.length;
    }
  }
  return found;
}
