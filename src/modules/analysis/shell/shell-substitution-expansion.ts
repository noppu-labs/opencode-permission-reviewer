// The `${…}` expansion inside double quotes, as the substitution reader finds its end.

import type {
  HeredocReading,
  ProbeCache,
  SubstitutionScan,
} from "./shell-lex-state.ts";
import type { FrameCloses, SubstitutionBody } from "./shell-substitution.ts";
import { substitutionBodyEnd } from "./shell-substitution-end.ts";

/** A `${…}` in double quotes holds quoted text and substitutions of its own,
 *  so a `}` or `"` inside it does not end the word. Only the shell's reading
 *  scans it. A `$` right after another `$` is no start: versions of the shell
 *  disagree on where such a word ends, so the previous reading stays. */
export function expansionBody(
  command: string,
  index: number,
  reading: HeredocReading,
  scan: SubstitutionScan,
  probes: ProbeCache | undefined,
): SubstitutionBody | undefined {
  if (scan !== "bash" || endsDollarPair(command, index)) return undefined;
  const closes: FrameCloses = new Map();
  const close = substitutionBodyEnd(
    command,
    index + 2,
    "brace",
    reading,
    scan,
    closes,
    probes,
  );
  return { kind: "expansion", end: close + 1, closes };
}

/** Whether the `$` at `index` is the second of a `$$` pair: an odd number
 *  of unescaped `$` end right before it. */
function endsDollarPair(command: string, index: number): boolean {
  let dollars = 0;
  while (command[index - 1 - dollars] === "$") dollars += 1;
  let slashes = 0;
  while (command[index - 1 - dollars - slashes] === "\\") slashes += 1;
  return (dollars - (slashes % 2)) % 2 === 1;
}
