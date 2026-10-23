/** `init` subcommand: register the plugin in an OpenCode config file.
 *
 * Detects the active OpenCode config (global or project), generates the plugin
 * entry (path reference by default, npm spec with --npm), backs up the existing
 * config before writing, and refuses to clobber an already-registered entry or
 * a malformed file. Supports --dry-run, --print, and --yes for non-interactive
 * use. Never prints the full config contents (user configs may carry secrets).
 */

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { findPackageJson } from "../../utils/package-json.ts";
import { applyPlannedWrites } from "./init-apply.ts";
import { planInit } from "./init-plan.ts";
import { printInitHuman, printInitJson, usage } from "./init-report.ts";
import type { PackageInfo } from "./init-types.ts";

export async function runInit(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      global: { type: "boolean" },
      tui: { type: "boolean" },
      host: { type: "string", default: "auto" },
      binary: { type: "string", default: "opencode" },
      "dry-run": { type: "boolean" },
      print: { type: "boolean" },
      yes: { type: "boolean" },
      json: { type: "boolean" },
      npm: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    process.stderr.write(usage());
    return 0;
  }

  const directory = values.project ?? process.cwd();
  if (!existsSync(directory)) {
    console.error(`init: project directory does not exist: ${directory}`);
    return 1;
  }

  const pkg = readPackageInfo();
  const plan = await planInit(values, pkg, directory);
  if (typeof plan === "number") return plan;

  if (values.print) {
    // Only the entry, never the full config (may contain secrets).
    console.log(JSON.stringify(plan.entry, null, 2));
    return 0;
  }

  if (values.json) {
    printInitJson(plan, pkg, Boolean(values["dry-run"]));
    return 0;
  }

  printInitHuman(plan, pkg);

  if (values["dry-run"]) {
    console.error("init: dry-run, no files written");
    console.error("rollback: (nothing was changed)");
    return 0;
  }

  const declined = await confirmApply(Boolean(values.yes));
  if (declined !== undefined) return declined;

  return applyPlannedWrites(plan.plans, plan.entry, pkg, plan.host);
}

/** Undefined when the plan may be applied, else the exit code to return. */
async function confirmApply(yes: boolean): Promise<number | undefined> {
  if (yes) return undefined;
  if (!process.stdin.isTTY) {
    console.error(
      "init: not a TTY; pass --yes to apply changes non-interactively",
    );
    return 2;
  }
  process.stderr.write("Apply these changes? [y/N] ");
  const answer = (await readStdin()).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    console.error("init: aborted, nothing changed");
    return 0;
  }
  return undefined;
}

function readPackageInfo(): PackageInfo {
  const found = findPackageJson(import.meta.dirname ?? process.cwd());
  if (found === undefined)
    throw new Error("init: could not locate package.json");
  const raw = found.manifest;
  return {
    name: raw.name ?? "opencode-permission-reviewer",
    version: raw.version ?? "0.0.0",
    engines: raw.engines ?? {},
    root: found.dir,
  };
}

async function readStdin(): Promise<string> {
  return new Response(await Bun.stdin.text()).text();
}
