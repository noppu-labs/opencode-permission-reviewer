import { afterAll, describe, expect, test } from "bun:test";
import { resolveRemoteTargets } from "../src/git-remote-targets.ts";
import {
  git,
  isolateGlobalGitConfig,
  planned,
  removeRepositories,
  repository,
} from "./git-remote-fixtures.ts";

isolateGlobalGitConfig();
afterAll(removeRepositories);

describe("remote target resolution", () => {
  test("duplicate operands resolve once and unique operands past the cap are omitted", async () => {
    const directory = await repository();
    await git(
      directory,
      "remote",
      "add",
      "origin",
      "https://example.invalid/o.git",
    );
    const result = await resolveRemoteTargets(
      directory,
      planned(["origin", "origin", "a", "b", "a", "c", "d", "e", "f"]),
      ["origin"],
      [],
    );
    expect(result.targets.map((target) => [target.input, target.kind])).toEqual(
      [
        ["origin", "configured-remote"],
        ["a", "unmatched"],
        ["b", "unmatched"],
        ["c", "unmatched"],
        ["d", "unmatched"],
      ],
    );
    expect(result.omitted).toBe(2);
  }, 30_000);

  test("default remotes stay unresolved without a branch or any configured candidate", async () => {
    const empty = await repository(false);
    expect(
      (await resolveRemoteTargets(empty, planned([], ["push"]), [], []))
        .defaults,
    ).toEqual([
      { source: "unresolved", note: "current branch could not be resolved" },
    ]);
    const directory = await repository();
    expect(
      (
        await resolveRemoteTargets(
          directory,
          planned([], ["push", "fetch", "remote update --all"]),
          [],
          [],
        )
      ).defaults,
    ).toEqual([
      {
        source: "unresolved",
        note: "no branch.main.remote, no remote.pushDefault, and no origin remote is configured",
      },
      {
        source: "unresolved",
        note: "no branch.main.remote, no remote.pushDefault, and no origin remote is configured",
      },
      {
        source: "all configured remotes",
        note: "remote update --all contacts every configured remote: (none configured)",
      },
    ]);
  }, 30_000);

  test("a configured default that names no remote is reported verbatim and redacted", async () => {
    const directory = await repository();
    await git(
      directory,
      "remote",
      "add",
      "origin",
      "https://example.invalid/o.git",
    );
    await git(
      directory,
      "config",
      "branch.main.pushRemote",
      `https://user:${"synthetic"}@example.invalid/direct.git`,
    );
    const { defaults } = await resolveRemoteTargets(
      directory,
      planned([], ["push", "fetch"]),
      ["origin"],
      [],
    );
    expect(defaults).toEqual([
      {
        source: "branch pushRemote",
        name: "https://<redacted>@example.invalid/direct.git",
        note: "configured value is not a named remote",
      },
      {
        source: "origin fallback",
        name: "origin",
        pushUrls: ["https://example.invalid/o.git"],
        fetchUrl: "https://example.invalid/o.git",
      },
    ]);
  }, 30_000);
});
