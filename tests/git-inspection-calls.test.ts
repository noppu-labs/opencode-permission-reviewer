import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "./helpers.ts";

// A fake `git` on a child process's PATH answers every inspection from a
// response table and logs each invocation, so these tests pin the exact git
// argv (hardening and neutralization args included), environment and working
// directory of every call enrichGitEvidence makes, and the record it builds.
const FAKE_GIT = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
const env = {
  GIT_OPTIONAL_LOCKS: process.env.GIT_OPTIONAL_LOCKS,
  GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
};
appendFileSync(process.env.FAKE_GIT_LOG, JSON.stringify({ argv, cwd: process.cwd(), env }) + "\\n");
let start = 0;
while (argv[start] === "-c") start += 2;
const key = argv.slice(start).join(" ");
if (JSON.parse(process.env.FAKE_GIT_FAIL ?? "[]").includes(key)) {
  process.stderr.write("fatal: synthetic failure of " + key + "\\n");
  process.exit(128);
}
const responses = JSON.parse(process.env.FAKE_GIT_RESPONSES ?? "{}");
if (Object.hasOwn(responses, key)) process.stdout.write(responses[key]);
else process.exit(1);
`;

const HARDENING = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
];
const SCAN = "config -z --get-regexp ^(filter|diff)\\.";
const TOPLEVEL = "rev-parse --show-toplevel";
const STATUS = "status --porcelain=v1 --branch --untracked-files=normal";
const INSPECTION_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};
const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const MERGE = "3".repeat(40);

interface Invocation {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function inspect(
  command: string,
  responses: Record<string, string>,
  fail: string[] = [],
): Promise<{ text: string; calls: Invocation[]; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "reviewer-git-calls-"));
  directories.push(directory);
  const bin = join(directory, ".bin");
  await mkdir(bin);
  await writeFile(join(bin, "git"), FAKE_GIT);
  await chmod(join(bin, "git"), 0o755);
  const log = join(bin, "calls.jsonl");
  await writeFile(log, "");
  const entry = new URL("../src/git-evidence.ts", import.meta.url).href;
  const input = request({ patterns: [command], metadata: { command } });
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `import { enrichGitEvidence } from ${JSON.stringify(entry)};
process.stdout.write((await enrichGitEvidence(${JSON.stringify(input)}, process.cwd(), 100000)).text)`,
    ],
    cwd: directory,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GIT_LOG: log,
      FAKE_GIT_RESPONSES: JSON.stringify({
        [TOPLEVEL]: `${directory}\n`,
        ...responses,
      }),
      FAKE_GIT_FAIL: JSON.stringify(fail),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, text] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  expect(exitCode).toBe(0);
  const calls = (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Invocation);
  for (const call of calls) {
    expect(call.cwd).toBe(directory);
    expect(call.env).toEqual(INSPECTION_ENV);
  }
  return { text, calls, directory };
}

// biome-ignore lint/suspicious/noExplicitAny: returns the JSON.parse result as-is (any), and the tests read nested evidence fields by dot path
function record(text: string): any {
  expect(text.startsWith("GIT_STATE_ANALYSIS\n")).toBe(true);
  return JSON.parse(text.slice("GIT_STATE_ANALYSIS\n".length));
}

function hardened(neutralization: string[], args: string): string[] {
  return [...HARDENING, ...neutralization, ...args.split(" ")];
}

function sortedArgv(calls: Invocation[]): string[] {
  return calls.map((call) => JSON.stringify(call.argv)).sort();
}

const NEUTRALIZATION = [
  "-c",
  "filter.lfs.clean=cat",
  "-c",
  "filter.lfs.smudge=cat",
  "-c",
  "filter.lfs.process=",
  "-c",
  "filter.lfs.required=false",
  "-c",
  "diff.pdf.textconv=",
];

const FULL_COMMAND = [
  "git add new.txt",
  "git rebase main",
  "git checkout HEAD -- staged.txt",
  "git rm gone.txt",
  "git push origin",
  "git push https://github.com/example/fixture.git",
  "git push",
  "git fetch",
  "git fetch --all",
  "git commit -m done",
].join(" && ");

const FULL_RESPONSES: Record<string, string> = {
  [SCAN]:
    "filter.lfs.clean\ngit-lfs clean -- %f\0diff.pdf.textconv\npdftotext\0",
  [STATUS]:
    "## main...origin/main [ahead 1]\nM  staged.txt\n M unstaged.txt\nMM both.txt\n?? new.txt\nUU conflict.txt\nAA added-both.txt\nR  renamed.txt -> moved.txt\n",
  "rev-parse --verify --quiet MERGE_HEAD": `${MERGE}\n`,
  "rev-parse --verify --end-of-options main^{commit}": `${BASE}\n`,
  [`rev-list --count ${BASE}..HEAD`]: "3\n",
  [`rev-list --count ${BASE}..HEAD --not --remotes`]: "1\n",
  "for-each-ref --format=%(refname) refs/remotes":
    "refs/remotes/origin/main\nrefs/remotes/upstream/main\n",
  "rev-parse HEAD": `${HEAD}\n`,
  "rev-parse --symbolic-full-name @{upstream}": "refs/remotes/origin/main\n",
  remote: "origin\nupstream\n",
  "config --null --list":
    "url.https://mirror.example.invalid/.pushinsteadof\nhttps://github.com/\0core.bare\nfalse\0",
  "remote get-url --push --all origin":
    "https://github.com/example/fixture.git\n",
  "remote get-url origin": "https://github.com/example/fixture.git\n",
  "remote get-url --push --all upstream": `https://user:${"synthetic"}@gitlab.example.invalid/up.git\nhttps://second.example.invalid/up.git\n`,
  "rev-parse --abbrev-ref HEAD": "main\n",
  "config --get remote.pushDefault": "upstream\n",
  "config --get branch.main.remote": "origin\n",
  "diff --numstat --no-ext-diff -- staged.txt gone.txt": "1\t0\tstaged.txt\n",
};

describe("git inspection calls", () => {
  test("every inspection call carries the hardening and neutralization args and the inspection env", async () => {
    const { text, calls, directory } = await inspect(
      FULL_COMMAND,
      FULL_RESPONSES,
    );
    expect(calls.slice(0, 3).map((call) => call.argv)).toEqual([
      SCAN.split(" "),
      hardened(NEUTRALIZATION, TOPLEVEL),
      hardened(NEUTRALIZATION, STATUS),
    ]);
    expect(sortedArgv(calls)).toEqual(
      [
        SCAN.split(" "),
        ...[
          TOPLEVEL,
          STATUS,
          "rev-parse --verify --quiet MERGE_HEAD",
          "rev-parse --verify --end-of-options main^{commit}",
          `rev-list --count ${BASE}..HEAD`,
          `rev-list --count ${BASE}..HEAD --not --remotes`,
          "for-each-ref --format=%(refname) refs/remotes",
          "rev-parse HEAD",
          "rev-parse --symbolic-full-name @{upstream}",
          "remote",
          "config --null --list",
          "remote get-url --push --all origin",
          "remote get-url origin",
          "remote get-url --push --all upstream",
          "remote get-url upstream",
          "rev-parse --abbrev-ref HEAD",
          "config --get branch.main.pushRemote",
          "config --get remote.pushDefault",
          "rev-parse --abbrev-ref HEAD",
          "config --get branch.main.remote",
          "diff --numstat --no-ext-diff -- staged.txt gone.txt",
        ].map((args) => hardened(NEUTRALIZATION, args)),
      ]
        .map((argv) => JSON.stringify(argv))
        .sort(),
    );
    const snapshot = record(text);
    expect(Object.keys(snapshot)).toEqual([
      "status",
      "repositoryRoot",
      "branch",
      "plannedCommands",
      "commitRequested",
      "plannedAdd",
      "preexistingStaged",
      "indexContext",
      "mergeHead",
      "note",
      "unmerged",
      "rewrite",
      "unstaged",
      "untracked",
      "discardTargets",
      "removeTargets",
      "remoteTargets",
      "remoteTargetsOmitted",
      "defaultRemotes",
      "configuredRemotes",
      "unresolvedPlannedPaths",
      "affectedTargetNumstat",
    ]);
    const list = (values: string[]): { values: string[]; omitted: number } => ({
      values,
      omitted: 0,
    });
    expect(snapshot).toStrictEqual({
      status: "available",
      repositoryRoot: directory,
      branch: "main",
      plannedCommands: [
        "add",
        "rebase",
        "checkout",
        "rm",
        "push",
        "push",
        "push",
        "fetch",
        "fetch",
        "commit",
      ],
      commitRequested: true,
      plannedAdd: list(["new.txt"]),
      preexistingStaged: list([
        "staged.txt",
        "both.txt",
        "renamed.txt -> moved.txt",
      ]),
      indexContext: "merge-result-index",
      mergeHead: MERGE,
      note: "the current index includes the in-progress merge result; this does not establish ownership or approval of every staged change",
      unmerged: list(["conflict.txt", "added-both.txt"]),
      rewrite: {
        status: "available",
        base: BASE,
        head: HEAD,
        commitsInRange: 3,
        commitsAbsentFromRemoteTrackingRefs: 1,
        commitsPresentInRemoteTrackingRefs: 2,
        remoteTrackingRefs: list([
          "refs/remotes/origin/main",
          "refs/remotes/upstream/main",
        ]),
        upstream: "refs/remotes/origin/main",
        note: "read-only local snapshot; remote-tracking refs may be stale and absence is not proof of unpublished history",
      },
      unstaged: list(["unstaged.txt", "both.txt"]),
      untracked: list(["new.txt"]),
      discardTargets: list(["staged.txt"]),
      removeTargets: list(["gone.txt"]),
      remoteTargets: [
        {
          input: "origin",
          kind: "configured-remote",
          pushUrls: ["https://github.com/example/fixture.git"],
          fetchUrl: "https://github.com/example/fixture.git",
        },
        {
          input: "https://github.com/example/fixture.git",
          kind: "literal",
          url: "https://github.com/example/fixture.git",
          pushUrls: ["https://mirror.example.invalid/example/fixture.git"],
          fetchUrl: "https://github.com/example/fixture.git",
          configuredMatches: [{ name: "origin", push: false, fetch: true }],
          note: "repository identity matches configured URLs only for the marked push/fetch roles; this does not establish authorization or destination trust",
        },
      ],
      remoteTargetsOmitted: 0,
      defaultRemotes: [
        {
          source: "remote.pushDefault",
          name: "upstream",
          pushUrls: [
            "https://<redacted>@gitlab.example.invalid/up.git",
            "https://second.example.invalid/up.git",
          ],
          note: "fetch URL resolution failed",
        },
        {
          source: "branch remote",
          name: "origin",
          pushUrls: ["https://github.com/example/fixture.git"],
          fetchUrl: "https://github.com/example/fixture.git",
        },
        {
          source: "all configured remotes",
          note: "fetch --all contacts every configured remote: origin, upstream",
        },
      ],
      configuredRemotes: ["origin", "upstream"],
      unresolvedPlannedPaths: list([]),
      affectedTargetNumstat: "1\t0\tstaged.txt\n",
    });
  }, 30_000);

  test("a failed filter scan stops before any other git call", async () => {
    const { text, calls } = await inspect("git add x", {}, [SCAN]);
    expect(calls.map((call) => call.argv)).toEqual([SCAN.split(" ")]);
    const snapshot = record(text);
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.reason).toStartWith(
      "unable to verify git conversion filters before inspection (",
    );
    expect(snapshot.reason).toContain(`fatal: synthetic failure of ${SCAN}`);
  }, 30_000);

  test("fifty filters and fifty diff drivers are neutralized, and fifty-one diff drivers refuse the inspection", async () => {
    const names = Array.from({ length: 51 }, (_, index) => `n${index}`);
    const scan = (filters: number, drivers: number): string =>
      [
        ...names.slice(0, filters).map((name) => `filter.${name}.smudge\nx\0`),
        ...names.slice(0, drivers).map((name) => `diff.${name}.textconv\nx\0`),
      ].join("");
    const allowed = await inspect("git checkout main", {
      [SCAN]: scan(50, 50),
      [STATUS]: "## main\n",
    });
    const neutralization = [
      ...names
        .slice(0, 50)
        .flatMap((name) => [
          "-c",
          `filter.${name}.clean=cat`,
          "-c",
          `filter.${name}.smudge=cat`,
          "-c",
          `filter.${name}.process=`,
          "-c",
          `filter.${name}.required=false`,
        ]),
      ...names.slice(0, 50).flatMap((name) => ["-c", `diff.${name}.textconv=`]),
    ];
    expect(allowed.calls.map((call) => call.argv)).toEqual([
      SCAN.split(" "),
      hardened(neutralization, TOPLEVEL),
      hardened(neutralization, STATUS),
    ]);
    expect(record(allowed.text).status).toBe("available");
    const refused = await inspect("git add x", { [SCAN]: scan(0, 51) });
    expect(refused.calls).toHaveLength(1);
    expect(record(refused.text).reason).toBe(
      "unable to verify git conversion filters before inspection (repository configures 51 diff textconv drivers (limit 50); refusing to inspect)",
    );
  }, 30_000);

  test("a failed toplevel or status call is reported with git's stderr", async () => {
    const toplevel = await inspect("git add x", {}, [TOPLEVEL]);
    expect(toplevel.calls).toHaveLength(2);
    expect(record(toplevel.text)).toMatchObject({
      status: "unavailable",
      reason: `fatal: synthetic failure of ${TOPLEVEL}`,
    });
    const status = await inspect("git add x", {}, [STATUS]);
    expect(status.calls).toHaveLength(3);
    expect(record(status.text)).toStrictEqual({
      status: "unavailable",
      reason: `fatal: synthetic failure of ${STATUS}`,
      planned: {
        relevant: true,
        commit: false,
        plannedAdd: ["x"],
        discardTargets: [],
        removeTargets: [],
        commands: ["add"],
        rewriteBases: [],
        remoteCandidates: [],
        needsDefaultRemote: [],
        executionDirectory: status.directory,
      },
    });
  }, 30_000);

  test("status lines are sorted by their two status columns and an empty branch name is detached", async () => {
    const { text } = await inspect("git add x", {
      [STATUS]:
        "## ...origin/main\nX\nD  deleted.txt\nDD both-deleted.txt\nUA ours.txt\n?! odd.txt\n",
    });
    expect(record(text)).toMatchObject({
      branch: "<detached-or-unknown>",
      preexistingStaged: { values: ["", "deleted.txt", "odd.txt"] },
      unmerged: { values: ["both-deleted.txt", "ours.txt"] },
      unstaged: { values: ["odd.txt"] },
      untracked: { values: [] },
    });
  }, 30_000);

  test("a failed remote listing leaves the remote evidence unresolved", async () => {
    const { text, calls } = await inspect(
      "git push origin",
      { [STATUS]: "## main\n" },
      ["remote"],
    );
    expect(calls.map((call) => call.argv)).toEqual([
      SCAN.split(" "),
      hardened([], TOPLEVEL),
      hardened([], STATUS),
      hardened([], "remote"),
    ]);
    expect(record(text)).toMatchObject({
      remoteTargets: [],
      remoteTargetsOmitted: 0,
      defaultRemotes: [
        {
          source: "unresolved",
          note: "configured remote listing failed: fatal: synthetic failure of remote",
        },
      ],
      configuredRemotes: [],
    });
  }, 30_000);

  test("a literal destination without readable rewrite config carries no URLs or identity matches", async () => {
    const { text } = await inspect(
      "git push https://github.com/example/fixture.git",
      {
        [STATUS]: "## main\n",
        remote: "origin\n",
        "remote get-url --push --all origin":
          "https://github.com/example/fixture.git\n",
        "remote get-url origin": "https://github.com/example/fixture.git\n",
      },
      ["config --null --list"],
    );
    expect(record(text).remoteTargets).toStrictEqual([
      {
        input: "https://github.com/example/fixture.git",
        kind: "literal",
        url: "https://github.com/example/fixture.git",
        note: "literal URL rewrite configuration is unavailable or ambiguous",
      },
    ]);
  }, 30_000);

  test("a rewrite range whose history cannot be counted is unavailable", async () => {
    const { text } = await inspect(
      "git rebase main",
      {
        [STATUS]: "## main\n",
        "rev-parse --verify --end-of-options main^{commit}": `${BASE}\n`,
        "rev-parse HEAD": `${HEAD}\n`,
        "for-each-ref --format=%(refname) refs/remotes": "",
        [`rev-list --count ${BASE}..HEAD`]: "1\n",
      },
      [`rev-list --count ${BASE}..HEAD --not --remotes`],
    );
    expect(record(text).rewrite).toStrictEqual({
      status: "unavailable",
      reason: "rewrite range or remote-tracking state could not be inspected",
    });
  }, 30_000);
});
