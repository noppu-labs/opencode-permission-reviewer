// What a command's stdin is after its redirections: the last one on descriptor 0 decides, and a duplicate takes what its descriptor holds.

import { elementAt } from "../../../utils/element-at.ts";
import type { ShellRedirection } from "./shell-redirections.ts";

/** A redirection with the placeholder of the heredoc body it reads, when it
 *  is a heredoc whose body was recorded. */
export interface ScriptRedirection extends ShellRedirection {
  placeholder?: string;
}

export type StdinSource =
  /** A heredoc body, recorded under its placeholder. */
  | { kind: "script"; placeholder: string }
  /** A here-string's word. */
  | { kind: "text"; text: string }
  /** What the command inherits, a pipe when one feeds it. */
  | { kind: "pipe" }
  /** A heredoc that has no placeholder: one in text that was lexed as written. */
  | { kind: "unrecorded" }
  /** A file or a closed descriptor. */
  | { kind: "other" };

const PIPE: StdinSource = { kind: "pipe" };
const OTHER: StdinSource = { kind: "other" };
const UNRECORDED: StdinSource = { kind: "unrecorded" };

/** The source of the command's stdin. The redirections apply in order: the
 *  last one on descriptor 0 wins, and `<&N` copies what descriptor N holds
 *  at that point. `placeholders[k]` is the placeholder of redirection `k`
 *  when that one does not carry its own. The list is read from its end, so
 *  the work stops at the redirection that decides. */
export function stdinSource(
  redirections: readonly ScriptRedirection[],
  placeholders: readonly (string | undefined)[] = [],
): StdinSource {
  let wanted = 0;
  for (let index = redirections.length - 1; index >= 0; index -= 1) {
    const redirection = elementAt(redirections, index, "redirections");
    const written = redirection.operator;
    const digits = digitsEnd(written);
    if (descriptorOf(written, digits) !== wanted) continue;
    const operator = digits === 0 ? written : written.slice(digits);
    if (operator !== "<&" && operator !== ">&")
      return sourceOf(redirection, operator, placeholders[index]);
    const copied = copiedDescriptor(redirection.target);
    if (copied === undefined) return OTHER;
    wanted = copied;
  }
  return wanted === 0 ? PIPE : OTHER;
}

function sourceOf(
  redirection: ScriptRedirection,
  operator: string,
  placeholder: string | undefined,
): StdinSource {
  if (operator === "<<" || operator === "<<-")
    return heredocSource(redirection.placeholder ?? placeholder);
  if (operator === "<<<") return { kind: "text", text: redirection.target };
  return OTHER;
}

function heredocSource(placeholder: string | undefined): StdinSource {
  return placeholder === undefined
    ? UNRECORDED
    : { kind: "script", placeholder };
}

/** The descriptor `<&N` and `<&N-` copy. A target that is not a descriptor
 *  number reads nothing known. */
function copiedDescriptor(target: string): number | undefined {
  const digits = target.endsWith("-") ? target.slice(0, -1) : target;
  return digits === "" || !isDigits(digits) ? undefined : Number(digits);
}

/** The length of the descriptor number that `written` starts with. */
function digitsEnd(written: string): number {
  let end = 0;
  while (end < written.length && isDigitCode(written.charCodeAt(end))) end += 1;
  return end;
}

/** The descriptor an operator `written` acts on: its number, or 0 for an
 *  input operator and 1 for an output one. A number of up to 15 digits is
 *  summed exactly, so only a longer one is cut out of the text. */
function descriptorOf(written: string, digits: number): number {
  if (digits === 0) return written.startsWith("<") ? 0 : 1;
  if (digits > 15) return Number(written.slice(0, digits));
  let value = 0;
  for (let index = 0; index < digits; index += 1)
    value = value * 10 + written.charCodeAt(index) - 48;
  return value;
}

function isDigits(text: string): boolean {
  for (let index = 0; index < text.length; index += 1)
    if (!isDigitCode(text.charCodeAt(index))) return false;
  return true;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}
