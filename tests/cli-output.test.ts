import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliSession, cliSandbox, PKG } from "./cli-run.ts";
import { toJsonl } from "./helpers.ts";

let tmp: string;
let home: string;
const sandbox = cliSandbox();
const cli: CliSession["cli"] = sandbox.cli;

afterEach(sandbox.remove);

function fresh(): void {
  ({ tmp, home } = sandbox.fresh());
}

const USAGE = `Usage:
  opencode-permission-reviewer init [--project <dir>] [--global] [--tui] [--dry-run] [--print] [--yes]
  opencode-permission-reviewer explain [--event <file>] [--project <dir>]
  opencode-permission-reviewer doctor [--project <dir>] [--json]
  opencode-permission-reviewer config print-effective [--project <dir>]
  opencode-permission-reviewer audit report [--path <file>] [--project <dir>] [--json]
  opencode-permission-reviewer script command --file <path> --host <host> [--port <port>] [--shell bash|sh]`;

describe("cli dispatcher", () => {
  test("an unknown command prints the usage and exits 2", async () => {
    fresh();
    expect(await cli(["bogus"])).toEqual({
      code: 2,
      stdout: "",
      stderr: `unknown command: bogus\n${USAGE}\n`,
    });
  }, 15_000);

  test("an unknown option and a thrown error print their message and exit 2", async () => {
    fresh();
    const option = await cli(["doctor", "--bogus"]);
    expect(option.code).toBe(2);
    expect(option.stderr).toStartWith("Unknown option '--bogus'");
    expect(
      await cli(["explain", "--event", join(tmp, "missing.json")]),
    ).toEqual({
      code: 2,
      stdout: "",
      stderr: `ENOENT: no such file or directory, open '<TMP>/missing.json'\n`,
    });
  }, 15_000);
});

describe("explain output", () => {
  test("help, invalid JSON and missing fields print their messages", async () => {
    fresh();
    expect(await cli(["explain", "--help"])).toEqual({
      code: 0,
      stdout: "",
      stderr:
        "Usage: explain --event <fixture.json> [--project <dir>]\nReads a permission request JSON, runs the capability analyzer and policy engine\n(observe mode), and prints the result as JSON.\n",
    });
    expect(await cli(["explain"], { stdin: "not json" })).toEqual({
      code: 2,
      stdout: "",
      stderr: "explain: input is not valid JSON\n",
    });
    const results = await Promise.all(
      ["null", "5", '{"permission":5}', '{"foo":"bar"}'].map((stdin) =>
        cli(["explain"], { stdin }),
      ),
    );
    expect(results).toEqual(
      Array(4).fill({
        code: 2,
        stdout: "",
        stderr:
          'explain: input must have "permission" and "metadata.command" or "patterns"\n',
      }),
    );
  }, 30_000);

  test("a legacy request joins string patterns when metadata has no command", async () => {
    fresh();
    const event = join(tmp, "event.json");
    writeFileSync(
      event,
      JSON.stringify({
        permission: "bash",
        patterns: ["git status", 3, "ls -la"],
        metadata: { command: 5 },
      }),
    );
    const { code, stdout } = await cli(["explain", "--event", event]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(Object.keys(result)).toEqual([
      "permission",
      "command",
      "configuration",
      "model",
      "capability",
      "policyTrace",
    ]);
    expect(result.command).toBe("git status\nls -la");
    expect(result.configuration).toBe("effective");
    expect(result.capability).not.toBeNull();
  }, 15_000);

  test("a native request reports its resources and evidence before the analysis", async () => {
    fresh();
    const { code, stdout } = await cli(["explain", "--defaults"], {
      stdin: JSON.stringify({
        action: "shell",
        resources: ["git push"],
        agent: "build",
        metadata: { command: "git push" },
        input: { command: "git push" },
      }),
    });
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(Object.keys(result)).toEqual([
      "permission",
      "command",
      "configuration",
      "model",
      "resources",
      "actionEvidenceComplete",
      "nativeAction",
      "capability",
      "policyTrace",
    ]);
    expect(result).toMatchObject({
      permission: "bash",
      command: "git push",
      configuration: "defaults",
      resources: ["git push"],
      actionEvidenceComplete: true,
      nativeAction: "shell",
    });
    expect(result.capability.actionClass.value).toBe("git-mutation");
  }, 15_000);

  test("a bash request with a blank command has no capability", async () => {
    fresh();
    const { code, stdout } = await cli(["explain"], {
      stdin: JSON.stringify({ permission: "bash", metadata: { command: " " } }),
    });
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.command).toBe("");
    expect(result.capability).toBeNull();
    expect(result.policyTrace.mode).toBe("observe");
  }, 15_000);
});

describe("audit report output", () => {
  const rows = [
    {
      schemaVersion: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
      requestID: "r1",
      sessionID: "s1",
      permission: "bash",
      outcome: "allow",
      reason: "ok",
      decisionSource: "llm-reviewer",
      riskLevel: "low",
    },
    {
      schemaVersion: 2,
      timestamp: "2026-01-02T00:00:00.000Z",
      requestID: "r2",
      sessionID: "s1",
      permission: "edit",
      outcome: "deny",
      reason: "no",
      decisionSource: "emergency-brake",
      riskLevel: "critical",
      actor: { name: "mystery" },
    },
    { schemaVersion: 2, requestID: "r3" },
    {
      schemaVersion: 1,
      timestamp: "2026-01-03T00:00:00.000Z",
      outcome: "allow",
    },
  ];

  test("the human report prints every section in order", async () => {
    fresh();
    const file = join(tmp, "audit.jsonl");
    writeFileSync(file, `${toJsonl(rows)}{bad}\n`);
    expect(await cli(["audit", "report", "--path", file])).toEqual({
      code: 0,
      stderr: "",
      stdout: `audit report: <TMP>/audit.jsonl
  valid records:     4 (invalid lines: 1)
  schema versions:   2 3 | 1 1
  host generations:  legacy-unspecified 4
  application states:(none)
  time range:        2026-01-01T00:00:00.000Z → 2026-01-03T00:00:00.000Z
  by outcome:        allow 2 | deny 1
  by risk level:     (none) 2 | low 1 | critical 1
  by decision source:llm-reviewer 1 | emergency-brake 1
  by permission:     bash 1 | edit 1
  unknown actors:    2
    (no actor field) (3)
    mystery (1)
  missing required fields: 2
    line 3: missing timestamp, sessionID, permission, outcome, reason
    line 4: missing requestID, sessionID, permission, reason
`,
    });
  }, 15_000);

  test("the human report counts hand-off triggers and resolutions when records carry them", async () => {
    fresh();
    const file = join(tmp, "audit.jsonl");
    const from = {
      model: "opencode/jev-1.13-free",
      reason: "r",
      trigger: "jev-escalate",
    };
    writeFileSync(
      file,
      toJsonl([
        { ...rows[0], reviewerEscalatedFrom: from },
        {
          ...rows[0],
          requestID: "r4",
          outcome: "escalate",
          reviewerEscalatedFrom: from,
          resolution: "reasoning-escalated",
        },
        {
          ...rows[0],
          requestID: "r5",
          outcome: "escalate",
          resolution: "budget-exhausted",
        },
      ]),
    );
    const lines = (await cli(["audit", "report", "--path", file])).stdout.split(
      "\n",
    );
    const permission = lines.indexOf("  by permission:     bash 3");
    expect(lines.slice(permission + 1, permission + 3)).toEqual([
      "  by hand-off:       jev-escalate 2",
      "  by resolution:     reasoning-escalated 1 | budget-exhausted 1",
    ]);
  }, 15_000);

  test("an empty report omits the optional sections and caps lists at ten", async () => {
    fresh();
    const file = join(tmp, "audit.jsonl");
    writeFileSync(file, "");
    expect((await cli(["audit", "report", "--path", file])).stdout).toBe(
      `audit report: <TMP>/audit.jsonl
  valid records:     0 (invalid lines: 0)
  schema versions:   (none)
  host generations:  (none)
  application states:(none)
  by outcome:        (none)
  by risk level:     (none)
`,
    );
    writeFileSync(
      file,
      toJsonl([
        ...Array.from({ length: 11 }, (_, i) => ({
          ...rows[1],
          requestID: `q${i}`,
          actor: { name: `actor-${i}` },
        })),
        ...Array.from({ length: 11 }, (_, i) => ({
          schemaVersion: 2,
          requestID: `m${i}`,
        })),
      ]),
    );
    const lines = (await cli(["audit", "report", "--path", file])).stdout.split(
      "\n",
    );
    const actors = lines.indexOf("  unknown actors:    12");
    expect(lines.slice(actors + 1, actors + 12)).toEqual([
      "    (no actor field) (11)",
      "    actor-0 (1)",
      "    actor-1 (1)",
      "    actor-10 (1)",
      "    actor-2 (1)",
      "    actor-3 (1)",
      "    actor-4 (1)",
      "    actor-5 (1)",
      "    actor-6 (1)",
      "    actor-7 (1)",
      "  missing required fields: 11",
    ]);
    expect(lines.filter((l) => l.startsWith("    line "))).toHaveLength(10);
  }, 15_000);

  test("a report over the read cap notes that only the tail was summarized", async () => {
    fresh();
    const file = join(tmp, "big.jsonl");
    const line = `${JSON.stringify(rows[0])}\n`;
    writeFileSync(
      file,
      line.repeat(Math.ceil((65 * 1024 * 1024) / line.length)),
    );
    const { stdout } = await cli(["audit", "report", "--path", file]);
    expect(stdout.split("\n").slice(0, 4)).toEqual([
      "audit report: <TMP>/big.jsonl",
      "  NOTE: only the most recent 64 MiB were summarized; counts and",
      "  timestamps describe that tail, not the whole file.",
      expect.stringMatching(/^ {2}valid records: {5}\d+ \(invalid lines: 0\)$/),
    ]);
  }, 30_000);
});

const NOT_JEV =
  'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not Jev';
const DEGRADED =
  'global config escalationMode "DENY" is invalid and was ignored';

describe("doctor output", () => {
  test("the human report lists versions, config and audit lines", async () => {
    fresh();
    const result = await cli(["doctor"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(
      result.stderr.replace(
        /(effectivePolicyHash: )[0-9a-f]{16}\)/,
        "$1<HASH>)",
      ),
    ).toBe(`opencode-permission-reviewer doctor ${PKG.version}
diagnostic mode: local-only
version
  package:    ${PKG.version}
  opencode:   ${PKG.engines.opencode} (engines.opencode)
  runtime:    bun/<BUN>
config
  global:     <TMP>/home/.config/opencode/permission-reviewer.jsonc  exists=no  sha256=-
  project:    <TMP>/proj/.opencode/permission-reviewer.jsonc  exists=no  sha256=-
  model:      openai/gpt-6-luna
  mode:       observe (declarative rules audited only; reviewer auto-allow/deny remains active)
  trust:      unknown
  rules:      0 (effectivePolicyHash: <HASH>)
audit
  path:       <TMP>/home/.local/share/opencode/permission-reviewer-audit.jsonl
  writable:   yes
`);
  }, 15_000);

  test("an unwritable audit path and enforce mode are reported in both formats", async () => {
    fresh();
    const global = join(home, ".config", "opencode");
    mkdirSync(global, { recursive: true });
    writeFileSync(
      join(global, "permission-reviewer.jsonc"),
      JSON.stringify({
        auditPath: "/dev/null/sub/audit.jsonl",
        enforcementMode: "enforce",
      }),
    );
    const human = await cli(["doctor"]);
    expect(human.code).toBe(0);
    expect(human.stderr).toContain(
      "  global:     <TMP>/home/.config/opencode/permission-reviewer.jsonc  exists=yes  sha256=",
    );
    expect(human.stderr).toContain(
      "  mode:       enforce (declarative rules enforced; reviewer decisions unchanged)\n",
    );
    expect(human.stderr).toEndWith(
      "audit\n  path:       /dev/null/sub/audit.jsonl\n  writable:   no (ENOTDIR: not a directory, mkdir '/dev/null/sub')\n",
    );
    const json = await cli(["doctor", "--json"]);
    const report = JSON.parse(json.stdout);
    expect(Object.keys(report)).toEqual([
      "mode",
      "host",
      "version",
      "config",
      "audit",
    ]);
    expect(Object.keys(report.config)).toEqual([
      "global",
      "project",
      "model",
      "enforcementMode",
      "repositoryTrust",
      "policyRuleCount",
      "effectivePolicyHash",
      "configWarnings",
      "configDegraded",
    ]);
    expect(report.config.configWarnings).toEqual([]);
    expect(report.config.configDegraded).toEqual([]);
    expect(report.audit).toEqual({
      path: "/dev/null/sub/audit.jsonl",
      writable: false,
      error: "ENOTDIR: not a directory, mkdir '/dev/null/sub'",
    });
  }, 15_000);

  test("config warnings and degradation are listed in both formats", async () => {
    fresh();
    const global = join(home, ".config", "opencode");
    mkdirSync(global, { recursive: true });
    writeFileSync(
      join(global, "permission-reviewer.jsonc"),
      JSON.stringify({
        escalationMode: "DENY",
        systemOneEscalation: "reasoning-first",
      }),
    );
    const human = await cli(["doctor"]);
    expect(human.code).toBe(0);
    expect(human.stderr).toStartWith(
      `permission-reviewer: ${DEGRADED}; automatic approval stays disabled until it is fixed\npermission-reviewer: ${NOT_JEV}\nopencode-permission-reviewer doctor`,
    );
    expect(human.stderr).toContain(
      `  warning:    ${NOT_JEV}\n  degraded:   ${DEGRADED}\naudit\n`,
    );
    const report = JSON.parse((await cli(["doctor", "--json"])).stdout);
    expect(report.config.configWarnings).toEqual([NOT_JEV]);
    expect(report.config.configDegraded).toEqual([DEGRADED]);
  }, 15_000);

  test("the host section probes a binary and a connected run needs a password", async () => {
    fresh();
    const binary = join(tmp, "fake-opencode");
    writeFileSync(binary, "#!/bin/sh\nprintf 'opencode 2.0.3\\n'\n", {
      mode: 0o700,
    });
    const report = JSON.parse(
      (await cli(["doctor", "--json", "--binary", binary])).stdout,
    );
    expect(report.host).toEqual({ binaryVersion: "2.0.3", runtime: null });
    expect(report.version).toEqual({
      package: PKG.version,
      opencodeRange: PKG.engines.opencode,
      runtime: "bun/<BUN>",
    });
    expect(await cli(["doctor", "--endpoint", "http://127.0.0.1:1"])).toEqual({
      code: 2,
      stdout: "",
      stderr: "Connected doctor requires OPENCODE_PASSWORD\n",
    });
    expect(
      await cli(["doctor", "--endpoint", "http://example.com"], {
        env: { OPENCODE_SERVER_PASSWORD: "pw" },
      }),
    ).toEqual({
      code: 2,
      stdout: "",
      stderr: "Reviewer host connections outside loopback require HTTPS\n",
    });
  }, 30_000);
});

describe("config print-effective output", () => {
  test("the resolved config carries its warnings and degradation", async () => {
    fresh();
    const global = join(home, ".config", "opencode");
    mkdirSync(global, { recursive: true });
    writeFileSync(
      join(global, "permission-reviewer.jsonc"),
      JSON.stringify({
        escalationMode: "DENY",
        systemOneEscalation: "reasoning-first",
      }),
    );
    const result = await cli(["config", "print-effective"]);
    expect(result.code).toBe(0);
    const { config } = JSON.parse(result.stdout);
    expect(config.systemOneEscalation).toBe("reasoning-first");
    expect(config.systemOneDenialReview).toBe(false);
    expect(config.configWarnings).toEqual([NOT_JEV]);
    expect(config.configDegraded).toEqual([DEGRADED]);
    expect(result.stderr).toContain(`permission-reviewer: ${NOT_JEV}\n`);
  }, 15_000);
});
