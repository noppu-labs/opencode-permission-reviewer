// What a command's stdin is after its redirections: the last one on descriptor 0 decides, and a duplicate takes what its descriptor holds.

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
 *  at that point. */
export function stdinSource(
  redirections: readonly ScriptRedirection[],
): StdinSource {
  const held = new Map<number, StdinSource>([[0, PIPE]]);
  for (const redirection of redirections) {
    const { descriptor, operator } = splitDescriptor(redirection.operator);
    held.set(
      descriptor ?? defaultDescriptor(operator),
      sourceOf(redirection, operator, held),
    );
  }
  return held.get(0) ?? PIPE;
}

function sourceOf(
  redirection: ScriptRedirection,
  operator: string,
  held: ReadonlyMap<number, StdinSource>,
): StdinSource {
  if (operator === "<<" || operator === "<<-")
    return heredocSource(redirection);
  if (operator === "<<<") return { kind: "text", text: redirection.target };
  if (operator === "<&" || operator === ">&")
    return duplicateOf(redirection.target, held);
  return OTHER;
}

function heredocSource(redirection: ScriptRedirection): StdinSource {
  return redirection.placeholder === undefined
    ? UNRECORDED
    : { kind: "script", placeholder: redirection.placeholder };
}

/** What `<&N` and `<&N-` read: the source descriptor N holds. A target that
 *  is not a descriptor number reads nothing known. */
function duplicateOf(
  target: string,
  held: ReadonlyMap<number, StdinSource>,
): StdinSource {
  const digits = target.endsWith("-") ? target.slice(0, -1) : target;
  if (digits === "" || !isDigits(digits)) return OTHER;
  return held.get(Number(digits)) ?? OTHER;
}

function defaultDescriptor(operator: string): number {
  return operator.startsWith("<") ? 0 : 1;
}

function splitDescriptor(written: string): {
  descriptor: number | undefined;
  operator: string;
} {
  let end = 0;
  while (end < written.length && isDigitCode(written.charCodeAt(end))) end += 1;
  return {
    descriptor: end === 0 ? undefined : Number(written.slice(0, end)),
    operator: written.slice(end),
  };
}

function isDigits(text: string): boolean {
  for (let index = 0; index < text.length; index += 1)
    if (!isDigitCode(text.charCodeAt(index))) return false;
  return true;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}
