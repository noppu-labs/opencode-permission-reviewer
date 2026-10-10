import { describe, expect, test } from "bun:test";
import { classifyPath } from "../src/capability/bash-mutation.ts";
import {
  gitSubcommandMutates,
  gitSubcommandOf,
} from "../src/capability/git-subcommand-forms.ts";
import { mutationOperands } from "../src/capability/mutation-operands.ts";
import { readOnlyToolMutation } from "../src/capability/read-only-tool-mutations.ts";
import type { ShellToken } from "../src/shell-token.ts";

// Characterisation of the capability mutation-helper branches. Each row asserts
// the current output.

function words(command: string): ShellToken[] {
  return command.split(" ").map((value) => ({ value, raw: value }));
}

function operands(command: string): ReturnType<typeof mutationOperands> {
  const cmd = words(command);
  return mutationOperands(cmd[0]?.value ?? "", cmd);
}

describe("mutationOperands", () => {
  test.each([
    ["ln a b", ["a"], ["b"], true],
    ["rename", [], [], false],
    ["rename -v", [], [], false],
    // `-t DIR` with no source: the directory is the destination, yet no
    // operand was seen.
    ["cp -t dir", [], ["dir"], false],
    ["cp -t", [], [], false],
    ["cp --target-directory", [], [], false],
    ["cp -S", [], [], false],
    ["rsync -ve", [], [], false],
    // rsync has no --target-directory option, so the long form is skipped.
    ["rsync --target-directory=x a b", ["a"], ["b"], true],
    ["rsync -e ssh a host:b", ["a"], ["host:b"], true],
    ["mv -fS .bak a b", ["a"], ["b"], true],
    ["cp a", [], ["a"], true],
    // A second `--` is an operand.
    ["cp -- -- x", ["--"], ["x"], true],
  ])("%s", (command, sources, destinations, sawOperand) => {
    expect(operands(command)).toEqual({ sources, destinations, sawOperand });
  });
});

describe("readOnlyToolMutation", () => {
  const deletes = (
    writeTargets: string[],
  ): ReturnType<typeof readOnlyToolMutation> => ({
    writeTargets,
    deletion: true,
  });
  const executes = { writeTargets: [], executesCode: true };
  test.each([
    ["find -- / -delete", deletes(["/"])],
    ["find -D tree / -delete", deletes(["/"])],
    ["find -D", undefined],
    ["find -H -L -P -O3 / -delete", deletes(["/"])],
    ["find", undefined],
    // A bare `-O` ends the option scan, so `/` is not taken as a root.
    ["find -O / -delete", deletes([])],
    ["find / ! -name x -delete", deletes(["/"])],
    ["find ( -name x ) -delete", deletes([])],
    ["find -delete", deletes([])],
    ["find . -fls out", { writeTargets: ["out"] }],
    ["find . -fprint out", { writeTargets: ["out"] }],
    ["find . -fprint0 out", { writeTargets: ["out"] }],
    ["find . -fls", undefined],
    ["find . -fls -x", undefined],
    ["find . -ok rm {} ;", executes],
    ["find . -okdir rm {} ;", executes],
    ["find . -execdir rm {} ;", executes],
    ["find . -name x", undefined],
    ["sort --output out", { writeTargets: ["out"] }],
    ["sort --output=out", { writeTargets: ["out"] }],
    ["sort -o", undefined],
    ["sort -o -x", undefined],
    ["sort -oout", { writeTargets: ["out"] }],
    ["sort a", undefined],
    ["yq e . f", undefined],
    ["yq -i . f.yaml", { writeTargets: [".", "f.yaml"] }],
    ["yq --inplace", { writeTargets: ["."] }],
    ["yq -i", { writeTargets: ["."] }],
  ])("%s", (command, expected) => {
    const cmd = words(command);
    expect(readOnlyToolMutation(cmd, cmd[0]?.value ?? "")).toEqual(expected);
  });
});

describe("classifyPath", () => {
  const none = { temporary: false, workspace: false, external: false };
  test.each([
    ["", "/w", "/w", none],
    ["&1", "/w", "/w", none],
    ["~", "/w", "/w", { temporary: false, workspace: false, external: true }],
    [
      "C:/x",
      "/w",
      "/w",
      { temporary: false, workspace: false, external: true },
    ],
    // `C:/../x` has no path class.
    ["C:/../x", "/w", "/w", none],
    [
      "/w/other",
      "/w/sub",
      "/w",
      { temporary: false, workspace: true, external: false },
    ],
    [
      "x",
      "/tmp/w",
      "/tmp/w",
      { temporary: true, workspace: true, external: false },
    ],
  ])("%p in %p (worktree %p)", (target, directory, worktree, expected) => {
    expect(classifyPath(target, directory, worktree)).toEqual(expected);
  });
});

describe("gitSubcommandOf", () => {
  test.each([
    ["git --no-pager push", { sub: "push", index: 2 }],
    ["git -C dir -c k=v status", { sub: "status", index: 5 }],
    // A lone `-` is not an option, so it is taken as the subcommand.
    ["git - push", { sub: "-", index: 1 }],
    ["git -C", {}],
    ["git --bare", {}],
    ["git", {}],
  ])("%s", (command, expected) => {
    expect(gitSubcommandOf(words(command))).toEqual(expected);
  });
});

describe("gitSubcommandMutates", () => {
  test.each([
    ["git symbolic-ref --delete HEAD", true],
    ["git symbolic-ref HEAD refs/heads/x", true],
    ["git symbolic-ref HEAD", false],
    ["git worktree", false],
    ["git worktree list", false],
    ["git worktree add x", true],
    ["git notes", false],
    ["git notes list", false],
    ["git notes show", false],
    ["git notes add -m x", true],
    ["git submodule", false],
    ["git submodule status", false],
    ["git submodule summary", false],
    ["git submodule update", true],
    ["git config user.name x", true],
    ["git config --unset user.name", true],
    ["git config user.name", false],
    // The verb pattern matches inside a key name: `preset` contains `set`.
    ["git config core.preset", true],
    ["git remote show origin", false],
    ["git remote get-url origin", false],
    ["git tag", false],
    ["git branch -a", false],
    ["git commit", true],
    ["git status", false],
  ])("%s", (command, expected) => {
    const cmd = words(command);
    expect(gitSubcommandMutates(cmd, cmd[1]?.value ?? "", 1)).toBe(expected);
  });

  test("reads the arguments after the given subcommand index", () => {
    const cmd = words("git -C dir branch -a");
    expect(gitSubcommandMutates(cmd, "branch", 3)).toBe(false);
  });
});
