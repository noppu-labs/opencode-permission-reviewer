import { describe, expect, test } from "bun:test";
import { gitSubcommandIndex } from "../src/git-global-options.ts";

const subcommandOf = (command: string): string | undefined => {
  const values = command.split(" ");
  return values[gitSubcommandIndex(values, 0)];
};

describe("gitSubcommandIndex", () => {
  test.each([
    ["git push origin", "push"],
    ["git -C repo push", "push"],
    ["git -c k=v push", "push"],
    ["git --git-dir .git push", "push"],
    ["git --git-dir=.git push", "push"],
    ["git --work-tree . push", "push"],
    ["git --namespace ns push", "push"],
    ["git --config-env k=ENV push", "push"],
    ["git --attr-source HEAD push", "push"],
    ["git --super-prefix p/ push", "push"],
    ["git --exec-path=/x push", "push"],
    ["git --exec-path push", "push"],
    ["git -p --no-pager push", "push"],
    ["git", undefined],
    ["git -C", undefined],
  ])("%p has subcommand %p", (command, expected) => {
    expect(subcommandOf(command)).toBe(expected);
  });
});
