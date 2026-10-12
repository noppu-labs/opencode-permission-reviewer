import { describe, expect, test } from "bun:test";
import {
  type PlannedGitActions,
  plannedActions,
} from "../src/git-command-plan.ts";

const EMPTY: PlannedGitActions = {
  relevant: false,
  commit: false,
  plannedAdd: [],
  discardTargets: [],
  removeTargets: [],
  commands: [],
  rewriteBases: [],
  remoteCandidates: [],
  needsDefaultRemote: [],
};

// Each row is a command planned from /work/repo and the fields its plan sets
// beyond EMPTY with relevant: true. undefined means the plan is not relevant.
const PLANS: Array<[string, Partial<PlannedGitActions> | undefined]> = [
  [
    "git push -- origin main",
    {
      commands: ["push"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git fetch -- -odd main",
    {
      commands: ["fetch"],
      remoteCandidates: ["-odd"],
      executionDirectory: "/work/repo",
    },
  ],
  ["git -C", undefined],
  ["git --no-pager", undefined],
  [
    "git add -- -dash.txt plain.txt -opt",
    {
      plannedAdd: ["-dash.txt", "plain.txt", "-opt"],
      commands: ["add"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git rm --cached -- -x.txt",
    {
      removeTargets: ["-x.txt"],
      commands: ["rm"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git -Csub add x.txt",
    {
      plannedAdd: ["x.txt"],
      commands: ["add"],
      executionDirectory: "/work/repo/sub",
    },
  ],
  [
    "git -C sub -C ../other add x.txt",
    {
      plannedAdd: ["x.txt"],
      commands: ["add"],
      executionDirectory: "/work/repo/other",
    },
  ],
  [
    "git -C '$HOME' add x.txt",
    {
      plannedAdd: ["x.txt"],
      commands: ["add"],
      directoryReason: "git -C contains unresolved shell expansion",
    },
  ],
  [
    "git -C sub* add x",
    {
      plannedAdd: ["x"],
      commands: ["add"],
      directoryReason: "git -C contains unresolved shell expansion",
    },
  ],
  [
    "git rebase --onto main topic",
    {
      commands: ["rebase"],
      rewriteBases: ["topic"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git rebase -x 'make test' -s ours -X theirs --strategy recursive --strategy-option patience --exec true main",
    {
      commands: ["rebase"],
      rewriteBases: ["main"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git rebase main topic",
    { commands: ["rebase"], executionDirectory: "/work/repo" },
  ],
  [
    "git rebase --root main",
    { commands: ["rebase"], executionDirectory: "/work/repo" },
  ],
  [
    "git rebase 'main~$N'",
    { commands: ["rebase"], executionDirectory: "/work/repo" },
  ],
  [
    "git rebase --interactive main",
    {
      commands: ["rebase"],
      rewriteBases: ["main"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git -C a add x && git -C b add y",
    {
      plannedAdd: ["x", "y"],
      commands: ["add", "add"],
      directoryReason:
        "compound command targets multiple Git working directories",
    },
  ],
  [
    "git -C a add x && git -C a commit -m m",
    {
      commit: true,
      plannedAdd: ["x"],
      commands: ["add", "commit"],
      executionDirectory: "/work/repo/a",
    },
  ],
  [
    "GIT_DIR=/x git add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      directoryReason:
        "Git repository or configuration environment overrides are unresolved",
    },
  ],
  [
    "GIT_CONFIG_GLOBAL=/x git add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      directoryReason:
        "Git repository or configuration environment overrides are unresolved",
    },
  ],
  [
    "GIT_WORK_TREE=/x git push",
    {
      commands: ["push"],
      needsDefaultRemote: ["push"],
      directoryReason:
        "Git repository or configuration environment overrides are unresolved",
    },
  ],
  [
    "git --git-dir=/x add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      directoryReason:
        "Git repository or configuration overrides are unresolved",
    },
  ],
  [
    "git --work-tree /x add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      directoryReason:
        "Git repository or configuration overrides are unresolved",
    },
  ],
  [
    "git --config-env=remote.origin.url=X push",
    {
      commands: ["push"],
      needsDefaultRemote: ["push"],
      directoryReason:
        "Git repository or configuration overrides are unresolved",
    },
  ],
  [
    "git -c remote.origin.url=https://x push origin",
    {
      commands: ["push"],
      remoteCandidates: ["origin"],
      directoryReason:
        "Git destination or worktree configuration overrides are unresolved",
    },
  ],
  [
    "git -cremote.origin.url=https://x push origin",
    {
      commands: ["push"],
      remoteCandidates: ["origin"],
      directoryReason:
        "Git destination or worktree configuration overrides are unresolved",
    },
  ],
  [
    "git -c url.https://x/.insteadOf=https://y push",
    {
      commands: ["push"],
      needsDefaultRemote: ["push"],
      directoryReason:
        "Git destination or worktree configuration overrides are unresolved",
    },
  ],
  [
    "git -c branch.main.pushRemote=evil push",
    {
      commands: ["push"],
      needsDefaultRemote: ["push"],
      directoryReason:
        "Git destination or worktree configuration overrides are unresolved",
    },
  ],
  [
    "git -c Branch.Main.Remote=evil fetch",
    {
      commands: ["fetch"],
      needsDefaultRemote: ["fetch"],
      directoryReason:
        "Git destination or worktree configuration overrides are unresolved",
    },
  ],
  [
    "git -c core.worktree=/x add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      directoryReason:
        "Git destination or worktree configuration overrides are unresolved",
    },
  ],
  [
    "git -c core.editor=vi commit",
    { commit: true, commands: ["commit"], executionDirectory: "/work/repo" },
  ],
  [
    "git -c user.name=x -C sub add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      executionDirectory: "/work/repo/sub",
    },
  ],
  [
    "cd sub && git add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      executionDirectory: "/work/repo/sub",
    },
  ],
  [
    "cd $X && git add y",
    {
      plannedAdd: ["y"],
      commands: ["add"],
      directoryReason: "working directory before Git is unresolved",
    },
  ],
  [
    "git push --repo upstream origin",
    {
      commands: ["push"],
      remoteCandidates: ["upstream"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git push --repo=upstream origin",
    {
      commands: ["push"],
      remoteCandidates: ["upstream"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git fetch --repo=upstream origin",
    {
      commands: ["fetch"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git push --repo",
    {
      commands: ["push"],
      needsDefaultRemote: ["push"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git fetch --repo",
    {
      commands: ["fetch"],
      needsDefaultRemote: ["fetch"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git fetch --depth 1 origin main",
    {
      commands: ["fetch"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git fetch -j 4 --filter blob:none upstream",
    {
      commands: ["fetch"],
      remoteCandidates: ["upstream"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git pull -s ours -X theirs origin",
    {
      commands: ["pull"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git ls-remote --sort version:refname origin",
    {
      commands: ["ls-remote"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git push -o ci.skip origin",
    {
      commands: ["push"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git push --force-with-lease origin",
    {
      commands: ["push"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git fetch --all",
    {
      commands: ["fetch"],
      needsDefaultRemote: ["fetch --all"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git pull --all",
    {
      commands: ["pull"],
      needsDefaultRemote: ["pull --all"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git push --all",
    {
      commands: ["push"],
      needsDefaultRemote: ["push"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git ls-remote",
    {
      commands: ["ls-remote"],
      needsDefaultRemote: ["ls-remote"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git push; git fetch; git pull; git ls-remote; git push; git fetch",
    {
      commands: ["push", "fetch", "pull", "ls-remote", "push", "fetch"],
      needsDefaultRemote: ["push", "fetch", "pull", "ls-remote"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git push a; git push b; git push c; git push d; git push e; git push f; git push g; git push h; git push i",
    {
      commands: [
        "push",
        "push",
        "push",
        "push",
        "push",
        "push",
        "push",
        "push",
        "push",
      ],
      remoteCandidates: ["a", "b", "c", "d", "e", "f", "g", "h"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git remote update",
    {
      commands: ["remote"],
      needsDefaultRemote: ["remote update --all"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git remote update group",
    { commands: ["remote"], executionDirectory: "/work/repo" },
  ],
  [
    "git remote set-url origin https://example.invalid/new.git",
    {
      commands: ["remote"],
      remoteCandidates: ["origin", "https://example.invalid/new.git"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git remote set-url origin",
    {
      commands: ["remote"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git remote show origin",
    {
      commands: ["remote"],
      remoteCandidates: ["origin"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git remote add new https://example.invalid/x.git",
    { commands: ["remote"], executionDirectory: "/work/repo" },
  ],
  ["git remote", { commands: ["remote"], executionDirectory: "/work/repo" }],
  ["git remote -v", { commands: ["remote"], executionDirectory: "/work/repo" }],
  [
    "git checkout main -- a.txt b.txt",
    {
      discardTargets: ["a.txt", "b.txt"],
      commands: ["checkout"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git checkout main",
    { commands: ["checkout"], executionDirectory: "/work/repo" },
  ],
  [
    "git restore -- a.txt",
    {
      discardTargets: ["a.txt"],
      commands: ["restore"],
      executionDirectory: "/work/repo",
    },
  ],
  [
    "git merge topic",
    { commands: ["merge"], executionDirectory: "/work/repo" },
  ],
  [
    "git stash push -- a.txt",
    { commands: ["stash"], executionDirectory: "/work/repo" },
  ],
  ["git status", undefined],
  [
    "/usr/bin/git add x",
    { plannedAdd: ["x"], commands: ["add"], executionDirectory: "/work/repo" },
  ],
  [
    "sudo git add x",
    { plannedAdd: ["x"], commands: ["add"], executionDirectory: "/work/repo" },
  ],
  [
    "env FOO=1 git add x",
    { plannedAdd: ["x"], commands: ["add"], executionDirectory: "/work/repo" },
  ],
  ["git ''", undefined],
];

describe("Git command planning", () => {
  test.each(PLANS)("plans %p", (command, fields) => {
    expect(plannedActions(command, "/work/repo")).toStrictEqual(
      fields === undefined ? EMPTY : { ...EMPTY, relevant: true, ...fields },
    );
  });

  test("the optional directory fields come after the collected lists", () => {
    expect(Object.keys(plannedActions("git add x", "/work/repo"))).toEqual([
      ...Object.keys(EMPTY),
      "executionDirectory",
    ]);
    expect(
      Object.keys(plannedActions("GIT_DIR=/x git add y", "/work/repo")),
    ).toEqual([...Object.keys(EMPTY), "directoryReason"]);
  });
});
