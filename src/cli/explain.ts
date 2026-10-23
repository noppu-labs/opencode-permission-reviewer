#!/usr/bin/env bun
/*
 * opencode-permission-reviewer CLI dispatcher; `usage()` lists the subcommands.
 * Invoked with no subcommand, or with a flag first, it runs `explain` against
 * stdin or `--event`.
 */
import { runAudit } from "../modules/audit/controllers/audit-command.ts";
import { runConfig } from "../modules/config/controllers/config-command.ts";
import { runDoctor } from "../modules/config/controllers/doctor-command.ts";
import { runInit } from "../modules/config/controllers/init.ts";
import { runExplain } from "../modules/review/controllers/explain-command.ts";
import { runScript } from "../modules/review/controllers/script-command.ts";

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
