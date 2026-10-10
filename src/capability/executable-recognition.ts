// Whether an effective command's executable is a known no-effect tool, an unrecognized one, or a read-only tool in a mutating form.

import type { ShellToken } from "../shell-token.ts";
import {
  DELETION_TOOLS,
  FILE_MUTATION_TOOLS,
  FILE_WRITE_TOOLS,
  INTERPRETERS,
  NETWORK_CLIENTS,
  NO_EFFECT_BUILTINS,
  PACKAGE_MANAGERS,
  PERSISTENCE_TOOLS,
  PERSISTENCE_WRAPPERS,
  PRIVILEGE_WRAPPERS,
  READ_ONLY_TOOLS,
  SERVICE_MANAGERS,
  SSH_TOOLS,
  TEST_RUNNERS,
} from "./bash-command-tables.ts";
import {
  type AnalysisRoots,
  type CapabilityFacts,
  recordWrite,
} from "./capability-facts.ts";
import { readOnlyToolMutation } from "./read-only-tool-mutations.ts";

/** Effect families that keep a read-only or no-effect executable from
 *  counting as read-only. */
const READ_ONLY_DISQUALIFIERS: readonly ReadonlySet<string>[] = [
  INTERPRETERS,
  PACKAGE_MANAGERS,
  NETWORK_CLIENTS,
  FILE_WRITE_TOOLS,
  FILE_MUTATION_TOOLS,
  DELETION_TOOLS,
  SERVICE_MANAGERS,
  PERSISTENCE_TOOLS,
  PRIVILEGE_WRAPPERS,
];

/** Effect families the classifiers recognize, `git` aside. */
const RECOGNIZED_FAMILIES: readonly ReadonlySet<string>[] = [
  INTERPRETERS,
  TEST_RUNNERS,
  PACKAGE_MANAGERS,
  NETWORK_CLIENTS,
  SSH_TOOLS,
  FILE_WRITE_TOOLS,
  FILE_MUTATION_TOOLS,
  DELETION_TOOLS,
  SERVICE_MANAGERS,
  PERSISTENCE_TOOLS,
  PERSISTENCE_WRAPPERS,
  PRIVILEGE_WRAPPERS,
];

/** A "usually read-only" executable in a mutating form (find -delete,
 *  sort -o, yq -i) is a mutation: surface its effects here and disqualify the
 *  read-only classification. Returns whether the command is one. */
export function classifyReadOnlyToolMutation(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): boolean {
  const roMutation = readOnlyToolMutation(cmd, base);
  if (roMutation === undefined) return false;
  if (roMutation.deletion === true) facts.deletion = true;
  if (roMutation.executesCode === true) {
    facts.executesCode = true;
    facts.childProcesses = true;
  }
  for (const target of roMutation.writeTargets)
    recordWrite(facts, target, roots);
  return true;
}

/** Track whether the executable itself is a known no-effect tool. Commands
 *  that match one of the effect families override this in class resolution;
 *  for everything else, an unrecognized executable keeps the class "unknown"
 *  instead of defaulting to read-only. */
export function classifyRecognition(
  base: string,
  mutatesReadOnlyTool: boolean,
  facts: CapabilityFacts,
): void {
  if (
    (READ_ONLY_TOOLS.has(base) || NO_EFFECT_BUILTINS.has(base)) &&
    !mutatesReadOnlyTool &&
    !READ_ONLY_DISQUALIFIERS.some((family) => family.has(base))
  ) {
    facts.sawReadOnlyExecutable = true;
  } else if (
    base !== "git" &&
    !RECOGNIZED_FAMILIES.some((family) => family.has(base))
  ) {
    facts.sawUnknownExecutable = true;
  }
}
