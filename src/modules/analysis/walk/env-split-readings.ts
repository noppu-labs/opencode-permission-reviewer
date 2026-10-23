// The texts the walk re-reads for an `env -S` string and the operands after it: the shell's reading and env's own split.

import { gnuSplitWords, shellQuote } from "./env-split-words.ts";

/** A first word that, with its quotes and escapes removed, starts with `-`. */
const OPTION_FIRST = /^\s*['"\\]*-/;

/** A string and operands the shell and env split into the same words. */
const PLAIN_SCRIPT = /^[\w/.,:@%+= \t-]*$/;
const PLAIN_OPERAND = /^[\w/.,:@%+=-]+$/;

/** The string and its operands read as shell text, once as env's own words
 *  when it starts with an option and once as written, and, unless both
 *  readings split alike, as env splits it: the string's words, each
 *  `${NAME}` once set and once unset, then each operand as one word. env
 *  reads all of them as its arguments again (`env -S '#' rm` runs `rm`). */
export function envSplitReadings(script: string, operands: string[]): string[] {
  const tail = operands.join(" ");
  const text = tail ? `${script} ${tail}` : script;
  const texts = OPTION_FIRST.test(text) ? [`env ${text}`, text] : [text];
  if (PLAIN_SCRIPT.test(script) && operands.every((o) => PLAIN_OPERAND.test(o)))
    return texts;
  const quoted = operands.map(shellQuote);
  const unsetReadings = script.includes("${") ? [false, true] : [false];
  for (const unset of unsetReadings) {
    const words = gnuSplitWords(script, unset);
    const reading = words && ["env", ...words, ...quoted].join(" ");
    if (reading !== undefined && !texts.includes(reading)) texts.push(reading);
  }
  return texts;
}
