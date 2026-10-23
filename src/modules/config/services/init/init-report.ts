// What `init` prints: its usage, the JSON plan report on stdout and the human plan report on stderr.
import { existsSync } from "node:fs";
import type {
  FilePlan,
  HostGeneration,
  PackageInfo,
  PluginEntry,
} from "../../models/init-types.ts";
import type { VersionCheck } from "./init-host-version.ts";

export interface InitPlan {
  host: HostGeneration;
  entry: PluginEntry;
  plans: FilePlan[];
  versionChecks: VersionCheck[];
}

export function usage(): string {
  return `Usage:
  opencode-permission-reviewer init [--project <dir>] [--global] [--tui]
                                    [--npm] [--dry-run] [--print] [--yes] [--json]

Register the permission-reviewer plugin in an OpenCode config file.
Backs up the existing file before writing. Never overwrites an already-
registered entry or a malformed config.

  --project <dir>   target project directory (default: cwd)
  --global          target ~/.config/opencode/opencode.json
  --tui             also register in tui.json
  --host <host>     v1, v2, or auto (default); auto refuses uncertain detection
  --binary <path>   OpenCode binary used for version detection
  --npm             emit an npm spec entry instead of a path reference
  --dry-run         print the plan, write nothing
  --print           print only the plugin entry JSON to stdout
  --yes             skip confirmation (required when stdin is not a TTY)
  --json            print planned changes as JSON without writing files
`;
}

export function printInitJson(
  plan: InitPlan,
  pkg: PackageInfo,
  dryRun: boolean,
): void {
  const { host, entry, plans, versionChecks } = plan;
  console.log(
    JSON.stringify(
      {
        command: "init",
        host,
        dryRun,
        package: { name: pkg.name, version: pkg.version, root: pkg.root },
        versionChecks,
        targets: plans.map((p) => ({
          path: p.path,
          exists: existsSync(p.path),
          action: p.action,
          ...(p.backup ? { backup: p.backup } : {}),
        })),
        entry,
        writes: [],
        plannedWrites: plans
          .filter((p) => p.action === "append" || p.action === "create")
          .map((p) => p.path),
      },
      null,
      2,
    ),
  );
}

// Human report (stderr so --json/--print stdout stays clean).
export function printInitHuman(plan: InitPlan, pkg: PackageInfo): void {
  console.error(`init: opencode-permission-reviewer ${pkg.version}`);
  for (const c of plan.versionChecks) {
    const tag = c.ok ? "ok" : "warning";
    console.error(`  ${c.name}: ${c.version} (${c.range}) ${tag}`);
  }
  console.error(`  entry: ${JSON.stringify(plan.entry)}`);

  for (const p of plan.plans) {
    console.error(`  ${p.path}: ${p.action}`);
  }
}
