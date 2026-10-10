import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolveRemoteTargets } from "../src/git-remote-targets.ts";
import {
  git,
  planned,
  removeRepositories,
  repository,
} from "./git-remote-fixtures.ts";

afterAll(removeRepositories);

const BOTH = [{ name: "origin", push: true, fetch: true }];

// Literal operands checked against an identical configured URL.
const MATCHES_ITSELF = [
  "https://github.com/example/fixture.git",
  "https://gitlab.example.invalid/group/project.git",
  "/srv/repos/project.git",
  "deploy@git.example.invalid:team/app.git",
  "git@github.com:example/fixture.git?x",
];
const NEVER_MATCHES_ITSELF = [
  "ssh://github.com/example/fixture.git",
  "https://github.com:8443/example/fixture.git",
  "https://github.com/example/fixture/extra",
  "https://github.com/exa mple/fixture",
  `https://gitlab.example.invalid/${"a".repeat(200)}.git`,
  "https://gitlab.example.invalid/a%20b.git",
  "https://gitlab.example.invalid/a/../b.git",
  "https://gitlab.example.invalid/a/./b.git",
  "https://gitlab.example.invalid/a\\b.git",
];
// [literal operand, origin's configured URL, configured matches]. Both are
// redacted before their repository identities are compared, so
// ssh://git@github.com never matches (its "git" user becomes <redacted>)
// and URLs differing only in credentials do.
const PAIRS: Array<[string, string, typeof BOTH | undefined]> = [
  [
    "git@github.com:Example/Fixture.git",
    "https://github.com/example/fixture",
    BOTH,
  ],
  [
    "https://github.com/Example/Fixture/",
    "git@github.com:example/fixture.git",
    BOTH,
  ],
  [
    "https://github.com:443/example/fixture.git",
    "https://github.com/example/fixture.git",
    BOTH,
  ],
  [
    "https://GitHub.com/example/fixture.GIT",
    "https://github.com/example/fixture",
    BOTH,
  ],
  [
    `https://user:${"one"}@gitlab.example.invalid/x.git`,
    `https://other:${"two"}@gitlab.example.invalid/x.git`,
    BOTH,
  ],
  [
    "ssh://git@github.com/example/fixture.git",
    "git@github.com:example/fixture.git",
    undefined,
  ],
  [
    "ssh://git@github.com:22/example/fixture.git",
    "ssh://git@github.com/example/fixture.git",
    undefined,
  ],
  [
    "git@github.com:example/fixture.git",
    "ssh://git@github.com/example/fixture.git",
    undefined,
  ],
  [
    "https://github.com/example/fixture.git#main",
    "https://github.com/example/fixture.git",
    undefined,
  ],
  [
    "https://gitlab.example.invalid/group/project.git",
    "https://gitlab.example.invalid/group/project",
    undefined,
  ],
];
const IDENTITIES: Array<[string, string, typeof BOTH | undefined]> = [
  ...MATCHES_ITSELF.map((url): [string, string, typeof BOTH] => [
    url,
    url,
    BOTH,
  ]),
  ...NEVER_MATCHES_ITSELF.map((url): [string, string, undefined] => [
    url,
    url,
    undefined,
  ]),
  ...PAIRS,
];
describe("repository identity", () => {
  let identityRepository = "";
  beforeAll(async () => {
    identityRepository = await repository();
    await git(identityRepository, "remote", "add", "origin", "/placeholder");
  });

  test("repository identity decides which literal destinations match a configured remote", async () => {
    for (const [literal, configured, matches] of IDENTITIES) {
      // biome-ignore lint/performance/noAwaitInLoops: every case rewrites the one shared origin URL, so the cases must run one at a time
      await git(identityRepository, "remote", "set-url", "origin", configured);
      const { targets } = await resolveRemoteTargets(
        identityRepository,
        planned([literal]),
        ["origin"],
        [],
      );
      expect([
        literal,
        targets[0]?.kind,
        targets[0]?.configuredMatches,
      ]).toEqual([literal, "literal", matches]);
    }
  }, 60_000);
});
