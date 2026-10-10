#!/usr/bin/env bun
import { readFileSync } from "node:fs";
/*
 * opencode-permission-reviewer CLI.
 *
 * Subcommands:
 *   init                 register the plugin in an OpenCode config file
 *   explain              dry-run a bash request through the analyzer + policy engine
 *   doctor               report versions, config sources, audit path, policy mode
 *   config print-effective   print the resolved config + effective policy hash
 *   audit report         summarize the JSONL audit trail
 *
 * Backward compatible: invoked with no subcommand (or with a flag first), it
 * runs `explain` against stdin/`--event`, matching the original behavior.
 */
import { parseArgs } from "node:util";
import {
  type AuditSummary,
  expandHome,
  readAuditSummary,
  resolveAuditPath,
} from "../audit.ts";
import { analyzeCapability } from "../capability/bash-analyzer.ts";
import { parseCommand } from "../capability/command-parser.ts";
import { loadResolvedConfig } from "../config/loader.ts";
import { resolveConfig } from "../config.ts";
import { includeEvidenceFile } from "../evidence-file-reader.ts";
import { normalizeV2Permission } from "../opencode/v2/permission-codec.ts";
import {
  evaluatePolicy,
  filterProjectAllowRules,
  hashEffectivePolicy,
} from "../policy/policy-engine.ts";
import { redactSecrets } from "../redact.ts";
import type {
  PermissionRequest,
  PermissionToolSource,
  ReviewerConfig,
} from "../types.ts";
import {
  renderVerifiedSshScriptCommand,
  VERIFIED_SCRIPT_LIMIT,
} from "../verified-ssh-script.ts";
import { inspectConfigSources, runDoctor } from "./doctor-command.ts";
import { runInit } from "./init.ts";

// Guarded so importing the module (e.g. via the "./cli" export or in tests)
// never triggers the CLI or kills the importing process; only a direct
// `bun run`/bin invocation runs the dispatcher.
if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

// --- dispatcher --------------------------------------------------------------

export async function runCli(argv: string[]): Promise<number> {
  const first = argv[0];
  const explicit = first !== undefined && !first.startsWith("-");
  const command = explicit ? first : "explain";
  const rest = explicit ? argv.slice(1) : argv;
  try {
    switch (command) {
      case "init":
        return await runInit(rest);
      case "explain":
        return await runExplain(rest);
      case "doctor":
        return await runDoctor(rest);
      case "config":
        return await runConfig(rest);
      case "audit":
        return await runAudit(rest);
      case "script":
        return await runScript(rest);
      default:
        console.error(`unknown command: ${command}\n${usage()}`);
        return 2;
    }
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException)?.code === "ERR_PARSE_ARGS_INVALID_OPTION"
    ) {
      console.error(String((error as Error).message ?? error));
      return 2;
    }
    console.error(String((error as Error)?.message ?? error));
    return 2;
  }
}

function usage(): string {
  return `Usage:
  opencode-permission-reviewer init [--project <dir>] [--global] [--tui] [--dry-run] [--print] [--yes]
  opencode-permission-reviewer explain [--event <file>] [--project <dir>]
  opencode-permission-reviewer doctor [--project <dir>] [--json]
  opencode-permission-reviewer config print-effective [--project <dir>]
  opencode-permission-reviewer audit report [--path <file>] [--project <dir>] [--json]
  opencode-permission-reviewer script command --file <path> --host <host> [--port <port>] [--shell bash|sh]`;
}

async function runScript(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      file: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      shell: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
  const file = values.file;
  const host = values.host;
  const shell = values.shell ?? "bash";
  const port = values.port === undefined ? undefined : Number(values.port);
  if (
    positionals.length !== 1 ||
    positionals[0] !== "command" ||
    !file ||
    !/^[A-Za-z0-9_./-]+$/.test(file) ||
    !host ||
    !/^[A-Za-z0-9_.@-]+$/.test(host) ||
    host.startsWith("-") ||
    (shell !== "bash" && shell !== "sh") ||
    (port !== undefined &&
      (!Number.isInteger(port) || port < 1 || port > 65535))
  ) {
    console.error(
      "Usage: script command --file <simple-path> --host <host> [--port <port>] [--shell bash|sh]",
    );
    return 2;
  }
  const directory = process.cwd();
  const evidence = await includeEvidenceFile(
    file,
    directory,
    directory,
    directory,
    VERIFIED_SCRIPT_LIMIT,
  );
  if (
    evidence.status !== "included" ||
    evidence.includedSha256 === undefined ||
    evidence.content === undefined ||
    redactSecrets(evidence.content) !== evidence.content
  ) {
    console.error(
      `Script cannot be fully inspected (${evidence.status}). Use a text file of at most 64 KiB inside the workspace or /tmp/opencode, without secrets.`,
    );
    return 1;
  }
  console.log(
    renderVerifiedSshScriptCommand({
      path: file,
      destination: host,
      ...(port === undefined ? {} : { port }),
      sha256: evidence.includedSha256,
      shell,
    }),
  );
  return 0;
}

// --- explain -----------------------------------------------------------------

async function runExplain(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      event: { type: "string" },
      defaults: { type: "boolean" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.error(`Usage: explain --event <fixture.json> [--project <dir>]
Reads a permission request JSON, runs the capability analyzer and policy engine
(observe mode), and prints the result as JSON.`);
    return 0;
  }

  let raw: string;
  if (values.event) {
    raw = readFileSync(values.event, "utf8");
  } else {
    raw = await readStdin();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("explain: input is not valid JSON");
    return 2;
  }

  const normalized = normalizeRequest(parsed);
  if (normalized === undefined) {
    console.error(
      'explain: input must have "permission" and "metadata.command" or "patterns"',
    );
    return 2;
  }
  const request = normalized.request;

  const directory = values.project ?? process.cwd();
  const config = values.defaults
    ? resolveConfig(undefined)
    : loadResolvedConfig(undefined, directory);
  const worktree = directory;
  const nativeResources = normalized.nativeAction !== undefined;
  const command =
    typeof request.metadata?.command === "string"
      ? request.metadata.command
      : nativeResources
        ? ""
        : (request.patterns ?? [])
            .filter((p) => typeof p === "string")
            .join("\n");

  const result: Record<string, unknown> = {
    permission: request.permission,
    command,
    configuration: values.defaults ? "defaults" : "effective",
    model: config.model,
    ...(nativeResources
      ? {
          resources: request.patterns,
          actionEvidenceComplete: normalized.actionEvidenceComplete,
          nativeAction: normalized.nativeAction,
        }
      : {}),
  };
  if (request.permission === "bash" && command.trim()) {
    const parsedCmd = parseCommand(command);
    const capability = analyzeCapability(parsedCmd, directory, worktree);
    const policyTrace = evaluatePolicy(
      capability,
      undefined,
      config,
      config.policyRules,
    );
    result.capability = capability;
    result.policyTrace = policyTrace;
  } else {
    result.capability = null;
    result.policyTrace = evaluatePolicy(
      undefined,
      undefined,
      config,
      config.policyRules,
    );
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

// --- config print-effective --------------------------------------------------

async function runConfig(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help || positionals[0] !== "print-effective") {
    console.error("Usage: config print-effective [--project <dir>]");
    return 2;
  }
  const directory = values.project ?? process.cwd();
  const config = loadResolvedConfig(undefined, directory);
  const sources = inspectConfigSources(directory);
  const report = {
    command: "print-effective",
    directory,
    sources,
    config: redactConfig(config),
    policy: {
      ruleCount: config.policyRules.length,
      effectivePolicyHash: hashEffectivePolicy(
        filterProjectAllowRules(config.policyRules),
        config,
      ),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

// --- audit report ------------------------------------------------------------

async function runAudit(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      path: { type: "string" },
      project: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help || positionals[0] !== "report") {
    console.error(
      "Usage: audit report [--path <file>] [--project <dir>] [--json]",
    );
    return 2;
  }
  const directory = values.project ?? process.cwd();
  const config = loadResolvedConfig(undefined, directory);
  const auditPath = values.path
    ? expandHome(values.path)
    : resolveAuditPath(config);
  const summary = readAuditSummary(auditPath);
  if (!summary.exists) {
    console.error(`audit report: ${auditPath}: no such file`);
    return 1;
  }
  if (values.json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  printAuditHuman(summary);
  return 0;
}

function printAuditHuman(s: AuditSummary): void {
  console.log(`audit report: ${s.path}`);
  if (s.truncated) {
    console.log(
      "  NOTE: only the most recent 64 MiB were summarized; counts and",
    );
    console.log("  timestamps describe that tail, not the whole file.");
  }
  console.log(
    `  valid records:     ${s.validRecords} (invalid lines: ${s.invalidLines})`,
  );
  console.log(`  schema versions:   ${fmtCounts(s.bySchemaVersion)}`);
  console.log(`  host generations:  ${fmtCounts(s.byHostGeneration)}`);
  console.log(`  application states:${fmtCounts(s.byApplication)}`);
  if (s.firstTimestamp || s.lastTimestamp) {
    console.log(
      `  time range:        ${s.firstTimestamp ?? "?"} → ${s.lastTimestamp ?? "?"}`,
    );
  }
  console.log(`  by outcome:        ${fmtCounts(s.byOutcome)}`);
  console.log(`  by risk level:     ${fmtCounts(s.byRiskLevel)}`);
  if (Object.keys(s.byDecisionSource).length > 0) {
    console.log(`  by decision source:${fmtCounts(s.byDecisionSource)}`);
  }
  if (Object.keys(s.byPermission).length > 0) {
    console.log(`  by permission:     ${fmtCounts(s.byPermission)}`);
  }
  if (s.unknownActorNames.length > 0) {
    console.log(`  unknown actors:    ${s.unknownActorNames.length}`);
    for (const a of s.unknownActorNames.slice(0, 10))
      console.log(`    ${a.name} (${a.count})`);
  }
  if (s.missingRequiredFields.length > 0) {
    console.log(`  missing required fields: ${s.missingRequiredFields.length}`);
    for (const m of s.missingRequiredFields.slice(0, 10)) {
      console.log(`    line ${m.lineNo}: missing ${m.missing.join(", ")}`);
    }
  }
}

// --- shared helpers ----------------------------------------------------------

function fmtCounts(map: Record<string, number>): string {
  const entries = Object.entries(map);
  if (entries.length === 0) return "(none)";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(" | ");
}

/** Defensive redaction: no ReviewerConfig field is sensitive today, but this
 *  guards against future additions (tokens, keys) leaking via print-effective. */
function redactConfig(config: ReviewerConfig): ReviewerConfig {
  return config;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function normalizeRequest(value: unknown):
  | {
      request: PermissionRequest;
      nativeAction?: string;
      actionEvidenceComplete?: boolean;
    }
  | undefined {
  if (typeof value !== "object" || value === null) return;
  const v = value as Record<string, unknown>;
  if (
    typeof v.action === "string" &&
    Array.isArray(v.resources) &&
    v.resources.every((resource) => typeof resource === "string")
  ) {
    return normalizeV2Permission(
      {
        sessionID:
          typeof v.sessionID === "string" ? v.sessionID : "explain-session",
        action: v.action,
        resources: v.resources,
        effect: "ask",
        ...(typeof v.agent === "string" ? { agent: v.agent } : {}),
        metadata:
          typeof v.metadata === "object" && v.metadata !== null
            ? (v.metadata as Record<string, unknown>)
            : {},
      },
      {
        reviewID: "explain-dry-run",
        generation: "explain",
        directory: "",
        hostVersion: "2.0.3",
      },
      v.input,
    );
  }
  if (typeof v.permission !== "string") return;
  const req: PermissionRequest = {
    id: typeof v.id === "string" ? v.id : "explain-dry-run",
    sessionID:
      typeof v.sessionID === "string" ? v.sessionID : "explain-session",
    permission: v.permission,
    patterns: Array.isArray(v.patterns) ? v.patterns : [],
    always: Array.isArray(v.always) ? v.always : [],
    metadata:
      typeof v.metadata === "object" && v.metadata !== null
        ? (v.metadata as Record<string, unknown>)
        : {},
  };
  if (
    typeof v.tool === "object" &&
    v.tool !== null &&
    typeof (v.tool as Record<string, unknown>).messageID === "string"
  ) {
    req.tool = v.tool as PermissionToolSource;
  }
  return { request: req };
}
