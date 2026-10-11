import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliSession, cliSandbox, PKG } from "./cli-run.ts";

let tmp: string;
let project: string;
const sandbox = cliSandbox();
const cli: CliSession["cli"] = sandbox.cli;

afterEach(sandbox.remove);

function fresh(): void {
  ({ tmp, project } = sandbox.fresh());
}

describe("init output", () => {
  const v1 = (): string[] => [
    "init",
    "--host",
    "v1",
    "--binary",
    "/missing/opencode",
    "--project",
    project,
  ];
  const head = (
    entry: string,
  ): string => `init: opencode-permission-reviewer ${PKG.version}
  bun: ${process.versions.bun} (${PKG.engines.bun}) ok
  opencode: (not found) (${PKG.engines.opencode}) warning
  entry: ${entry}
`;

  test("a dry run lists the version checks, entry and planned actions", async () => {
    fresh();
    writeFileSync(join(project, "opencode.json"), '{"plugin":[]}');
    expect(await cli([...v1(), "--dry-run", "--tui"])).toEqual({
      code: 0,
      stdout: "",
      stderr: `${head('"<ROOT>"')}  <TMP>/proj/opencode.json: append
  <TMP>/proj/tui.json: create
init: dry-run, no files written
rollback: (nothing was changed)
`,
    });
  }, 15_000);

  test("the JSON report keeps its keys, targets and planned writes", async () => {
    fresh();
    writeFileSync(join(project, "opencode.json"), '{"plugins":[]}');
    const { code, stdout } = await cli([
      "init",
      "--host",
      "v2",
      "--binary",
      "/missing/opencode",
      "--project",
      project,
      "--json",
      "--tui",
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(Object.keys(report)).toEqual([
      "command",
      "host",
      "dryRun",
      "package",
      "versionChecks",
      "targets",
      "entry",
      "writes",
      "plannedWrites",
    ]);
    expect(report.package).toEqual({
      name: PKG.name,
      version: PKG.version,
      root: "<ROOT>",
    });
    expect(report.versionChecks.map((c: { name: string }) => c.name)).toEqual([
      "bun",
      "opencode",
    ]);
    expect(report.targets).toEqual([
      {
        path: "<TMP>/proj/opencode.json",
        exists: true,
        action: "append",
        backup: "<TMP>/proj/opencode.json.bak-<STAMP>",
      },
      {
        path: "<TMP>/home/.config/opencode/cli.json",
        exists: false,
        action: "create",
      },
    ]);
    expect(report.entry).toEqual({ package: "<ROOT>", options: {} });
    expect(report.plannedWrites).toEqual([
      "<TMP>/proj/opencode.json",
      "<TMP>/home/.config/opencode/cli.json",
    ]);
  }, 15_000);

  test("argument and detection failures print their messages and write nothing", async () => {
    fresh();
    expect(
      await cli(["init", "--project", join(tmp, "missing")]),
    ).toMatchObject({
      code: 1,
      stderr: "init: project directory does not exist: <TMP>/missing\n",
    });
    expect(
      await cli(["init", "--host", "v3", "--project", project]),
    ).toMatchObject({
      code: 2,
      stderr: "init: --host must be auto, v1, or v2\n",
    });
    expect(
      await cli([
        "init",
        "--binary",
        "/missing/opencode",
        "--project",
        project,
      ]),
    ).toMatchObject({
      code: 2,
      stderr:
        "init: detected host is unavailable or unsupported; no configuration was written\n",
    });
    const binary = join(tmp, "fake-opencode");
    writeFileSync(binary, "#!/bin/sh\nprintf '1.18.29\\n'\n", { mode: 0o700 });
    writeFileSync(join(project, "opencode.json"), '{"plugins":[]}');
    expect(
      await cli(["init", "--binary", binary, "--project", project]),
    ).toMatchObject({
      code: 2,
      stderr:
        "init: binary version and config format disagree; select --host explicitly\n",
    });
    expect(await cli(v1())).toMatchObject({
      code: 2,
      stderr: `${head('"<ROOT>"')}  <TMP>/proj/opencode.json: append
init: not a TTY; pass --yes to apply changes non-interactively
`,
    });
    expect(readFileSync(join(project, "opencode.json"), "utf8")).toBe(
      '{"plugins":[]}',
    );
  }, 30_000);

  test("--print emits only the npm entry for each host", async () => {
    fresh();
    expect(await cli([...v1(), "--print", "--npm"])).toEqual({
      code: 0,
      stderr: "",
      stdout: `"${PKG.name}@^${PKG.version}"\n`,
    });
    const v2 = await cli([
      "init",
      "--host",
      "v2",
      "--binary",
      "/missing/opencode",
      "--project",
      project,
      "--print",
    ]);
    expect(v2.stdout).toBe('{\n  "package": "<ROOT>",\n  "options": {}\n}\n');
  }, 15_000);
});
