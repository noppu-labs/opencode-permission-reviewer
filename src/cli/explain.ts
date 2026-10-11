#!/usr/bin/env bun
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
import { runAudit } from "./audit-command.ts";
import { runConfig } from "./config-command.ts";
import { runDoctor } from "./doctor-command.ts";
import { runExplain } from "./explain-command.ts";
import { runInit } from "./init.ts";
import { runScript } from "./script-command.ts";

// Guarded so importing the module (e.g. via the "./cli" export or in tests)
// never triggers the CLI or kills the importing process; only a direct
// `bun run`/bin invocation runs the dispatcher.
if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

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
