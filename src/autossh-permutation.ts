// The order glibc's getopt leaves autossh's arguments in before autossh hands them to ssh.

import { AUTOSSH_VALUE_LETTERS } from "./ssh-arguments.ts";

/** Whether the option word ends in a letter that takes a value, so that
 *  its value is the next word. */
function takesNextWord(word: string): boolean {
  for (let at = 1; at < word.length; at += 1)
    if (AUTOSSH_VALUE_LETTERS.has(word.charAt(at)))
      return at === word.length - 1;
  return false;
}

function isOperand(word: string): boolean {
  return !word.startsWith("-") || word === "-";
}

/** The words with those from `start` in the order glibc's getopt permutes
 *  them for autossh, whose option string has no leading `+`: each option
 *  word, with the next word when that is its value, moves ahead of the
 *  operands. A `--` that is no option's value follows the options and ends
 *  the scan, and the words after it keep their place. */
export function permuteAutosshWords(
  words: readonly string[],
  start: number,
): string[] {
  const options: string[] = [];
  const operands: string[] = [];
  let index = start;
  while (index < words.length) {
    const word = words[index] ?? "";
    index += 1;
    if (word === "--") {
      options.push(word);
      break;
    }
    if (isOperand(word)) operands.push(word);
    else if (takesNextWord(word) && index < words.length) {
      options.push(word, words[index] ?? "");
      index += 1;
    } else options.push(word);
  }
  return [
    ...words.slice(0, start),
    ...options,
    ...operands,
    ...words.slice(index),
  ];
}
