// File-effect classifiers for one effective command: file writers, copy/move/link tools and deletion tools.

import type { ShellToken } from "../shell-token.ts";
import {
  DELETION_TOOLS,
  FILE_MUTATION_TOOLS,
  FILE_WRITE_TOOLS,
} from "./bash-command-tables.ts";
import { isRemoteMutationOperand, mutationOperands } from "./bash-mutation.ts";
import {
  type AnalysisRoots,
  type CapabilityFacts,
  recordWrite,
} from "./capability-facts.ts";

export function classifyFileWrite(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): void {
  if (!FILE_WRITE_TOOLS.has(base)) return;
  for (const output of fileWriteOutputs(cmd, base))
    recordWrite(facts, output, roots);
}

/** dd names its output as `of=PATH`; treating the whole assignment as a
 *  relative path hides absolute destinations. Other members name output
 *  files as ordinary operands. */
function fileWriteOutputs(cmd: ShellToken[], base: string): string[] {
  const operands = cmd.slice(1).map((token) => token.value);
  if (base !== "dd") return operands;
  return operands
    .filter((value) => value.startsWith("of="))
    .map((value) => value.slice(3));
}

/** cp/mv/ln/rsync: only the DESTINATIONS are writes. Sources of cp and ln
 *  are plain reads (`cp /etc/hosts ./hosts` must not report an external
 *  write for its source); mv also changes where each source lives, so mv
 *  sources count as mutations of their origin location. Remote destinations
 *  (`user@host:/srv/app`, rsync://…) are external writes on another machine,
 *  whatever a relative-looking local classification would say. */
export function classifyFileMutation(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): void {
  if (!FILE_MUTATION_TOOLS.has(base)) return;
  const { sources, destinations, sawOperand } = mutationOperands(base, cmd);
  const writeOperands = mutatesSources(cmd, base)
    ? [...destinations, ...sources]
    : destinations;
  for (const operand of writeOperands) {
    if (base === "rsync" && isRemoteMutationOperand(operand))
      facts.externalWrite = true;
    else recordWrite(facts, operand, roots);
  }
  if (!sawOperand) facts.workspaceWrite = true;
}

function mutatesSources(cmd: ShellToken[], base: string): boolean {
  if (base === "mv") return true;
  if (base !== "rsync") return false;
  const optionEnd = cmd.findIndex((token) => token.value === "--");
  return cmd
    .slice(1, optionEnd < 0 ? cmd.length : optionEnd)
    .some((token) => token.value === "--remove-source-files");
}

export function classifyDeletion(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): void {
  if (!DELETION_TOOLS.has(base)) return;
  facts.deletion = true;
  let anyTarget = false;
  for (const token of cmd.slice(1)) {
    const v = token.value;
    if (v.startsWith("-")) continue;
    anyTarget = true;
    recordWrite(facts, v, roots);
  }
  if (!anyTarget) facts.workspaceWrite = true;
}
