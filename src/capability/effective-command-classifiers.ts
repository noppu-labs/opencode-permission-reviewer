// The per-command classifiers analyzeCapability runs on each effective command, in their fixed order.

import { shellBasename } from "../shell-lexer.ts";
import type { ShellToken } from "../shell-token.ts";
import type { CapabilityFacts } from "./capability-facts.ts";
import {
  classifyReadOnlyToolMutation,
  classifyRecognition,
} from "./executable-recognition.ts";
import {
  type CommandContext,
  classifyInterpreter,
  classifyPackageManager,
  classifyTestRunner,
  classifyTestSubcommand,
} from "./execution-classifiers.ts";
import {
  classifyDeletion,
  classifyFileMutation,
  classifyFileWrite,
} from "./file-effect-classifiers.ts";
import {
  classifyGit,
  classifyNetworkClient,
  classifySshTool,
} from "./network-classifiers.ts";
import {
  classifyPersistenceTool,
  classifyServiceManager,
} from "./process-classifiers.ts";

/** Every classifier runs on every command, in this order: a command can
 *  match several (bun is an interpreter and a package manager, rsync a
 *  network client and a mutation tool, shred a writer and a deleter). */
export function classifyEffectiveCommand(
  cmd: ShellToken[],
  facts: CapabilityFacts,
  context: CommandContext,
): void {
  const first = cmd[0];
  if (first === undefined) return;
  const base = shellBasename(first.value);
  const mutatesReadOnlyTool = classifyReadOnlyToolMutation(
    cmd,
    base,
    facts,
    context,
  );
  classifyRecognition(base, mutatesReadOnlyTool, facts);
  classifyInterpreter(cmd, base, facts, context);
  classifyTestRunner(base, facts);
  classifyTestSubcommand(cmd, base, facts);
  classifyPackageManager(cmd, base, facts);
  classifyNetworkClient(cmd, base, facts);
  classifySshTool(cmd, base, facts);
  classifyFileWrite(cmd, base, facts, context);
  classifyFileMutation(cmd, base, facts, context);
  classifyDeletion(cmd, base, facts, context);
  classifyGit(cmd, base, facts);
  // Privilege wrappers were already detected on the segment head; the lexer
  // peels them so `effective` starts at the real executable.
  classifyServiceManager(base, facts);
  classifyPersistenceTool(base, facts);
  // Background operator `&` is already a segment separator; `disown`/`nohup`
  // are handled on the segment head. A trailing `&` inside one logical
  // command is rare with our lexer but `setsid`/`nohup` cover the common
  // persistence cases.
}
