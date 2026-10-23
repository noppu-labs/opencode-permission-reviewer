// The find commands among a segment's effective commands, with those their exec actions run.

import type { AnalysisBudget } from "../shell/shell-lexer.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import { analyzeFind, type FindCommand } from "./brake-find-root.ts";

/** The find commands among `commands` and among the commands their exec
 *  actions run, at any depth, or `undefined` when any exec walk hits a limit.
 *  The exec walks of a nested find are charged to the shared `budget` per
 *  argv token, which keeps the nested work linear in the budget. */
export function analyzeFinds(
  commands: readonly ShellToken[][],
  budget: AnalysisBudget,
): FindCommand[] | undefined {
  const finds: FindCommand[] = [];
  const pending = commands.map((command) => ({ command, nested: false }));
  for (let next = pending.pop(); next; next = pending.pop()) {
    const find = analyzeFind(next.command, budget, next.nested);
    if (find?.exec.truncated) return undefined;
    if (find === undefined) continue;
    finds.push(find);
    for (const command of find.exec.commands)
      pending.push({ command, nested: true });
  }
  return finds;
}
