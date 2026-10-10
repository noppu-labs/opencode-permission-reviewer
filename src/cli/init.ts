/** `init` subcommand: register the plugin in an OpenCode config file.
 *
 * Detects the active OpenCode config (global or project), generates the plugin
 * entry (path reference by default, npm spec with --npm), backs up the existing
 * config before writing, and refuses to clobber an already-registered entry or
 * a malformed file. Supports --dry-run, --print, and --yes for non-interactive
 * use. Never prints the full config contents (user configs may carry secrets).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { satisfies } from "semver";
import { SUPPORTED_V2_RANGE } from "../opencode/host-guard.ts";
import {
  applyPlannedWrites,
  type HostGeneration,
  type PackageInfo,
  type PluginEntry,
  planFileChange,
  readConfigFile,
} from "./init-config-files.ts";

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
  if (!["auto", "v1", "v2"].includes(values.host)) {
    console.error("init: --host must be auto, v1, or v2");
    return 2;
  }
  const versionChecks = await runVersionChecks(pkg, values.binary);
  if (
    values.host === "auto" &&
    !versionChecks.find((check) => check.name === "opencode")?.ok
  ) {
    console.error(
      "init: detected host is unavailable or unsupported; no configuration was written",
    );
    return 2;
  }
  const version = versionChecks.find(
    (check) => check.name === "opencode",
  )?.version;
  const detected = version?.startsWith("1.")
    ? "v1"
    : version?.startsWith("2.")
      ? "v2"
      : undefined;
  const host =
    values.host === "auto" ? detected : (values.host as HostGeneration);
  if (!host) {
    console.error(
      "init: cannot determine the host; pass --host v1 or --host v2",
    );
    return 2;
  }
  const entry = buildEntry(pkg, Boolean(values.npm), host);
  const targets = resolveTargets(
    directory,
    Boolean(values.global),
    Boolean(values.tui),
    host,
  );
  const existingSnapshot = readConfigFile(targets.config);
  const existingConfig =
    existingSnapshot.status === "read" ? existingSnapshot.config : undefined;
  if (
    values.host === "auto" &&
    existingConfig &&
    ((host === "v1" && "plugins" in existingConfig) ||
      (host === "v2" && "plugin" in existingConfig))
  ) {
    console.error(
      "init: binary version and config format disagree; select --host explicitly",
    );
    return 2;
  }

  const plans = [targets.config, ...(targets.tui ? [targets.tui] : [])].map(
    (p) => planFileChange(p, pkg, host),
  );

  // --- output -------------------------------------------------------------

  if (values.print) {
    // Only the entry, never the full config (may contain secrets).
    console.log(JSON.stringify(entry, null, 2));
    return 0;
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          command: "init",
          host,
          dryRun: Boolean(values["dry-run"]),
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
    return 0;
  }

  // Human report (stderr so --json/--print stdout stays clean).
  console.error(`init: opencode-permission-reviewer ${pkg.version}`);
  for (const c of versionChecks) {
    const tag = c.ok ? "ok" : "warning";
    console.error(`  ${c.name}: ${c.version} (${c.range}) ${tag}`);
  }
  console.error(`  entry: ${JSON.stringify(entry)}`);

  for (const plan of plans) {
    console.error(`  ${plan.path}: ${plan.action}`);
  }

  if (values["dry-run"]) {
    console.error("init: dry-run, no files written");
    console.error("rollback: (nothing was changed)");
    return 0;
  }

  // --- interactive gate ---------------------------------------------------

  if (!values.yes) {
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
  }

  // --- write --------------------------------------------------------------

  return applyPlannedWrites(plans, entry, pkg, host);
}

// --- internals ----------------------------------------------------------------

function usage(): string {
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

function readPackageInfo(): PackageInfo {
  let dir = import.meta.dirname ?? process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const raw = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: string;
        version?: string;
        engines?: { bun?: string; opencode?: string };
      };
      return {
        name: raw.name ?? "opencode-permission-reviewer",
        version: raw.version ?? "0.0.0",
        engines: raw.engines ?? {},
        root: dir,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("init: could not locate package.json");
}

function buildEntry(
  pkg: PackageInfo,
  npm: boolean,
  host: HostGeneration,
): PluginEntry {
  // When installed via npm the root is under node_modules; emit a bare spec so
  // opencode resolves it from its own node_modules. Otherwise emit an absolute
  // path reference (the documented dev workflow).
  const fromNodeModules = pkg.root.includes(join("node_modules", ""));
  if (npm || fromNodeModules) {
    const name = `${pkg.name}@^${pkg.version}`;
    return host === "v2" ? { package: name, options: {} } : name;
  }
  return host === "v2" ? { package: pkg.root, options: {} } : pkg.root;
}

function resolveTargets(
  directory: string,
  forceGlobal: boolean,
  wantTui: boolean,
  host: HostGeneration,
): { config: string; tui?: string } {
  const globalDir = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "opencode",
  );
  const globalCfg = pickExisting([
    join(globalDir, "opencode.json"),
    join(globalDir, "opencode.jsonc"),
  ]);
  const projectCfg = pickExisting([
    join(directory, "opencode.json"),
    join(directory, "opencode.jsonc"),
    join(directory, ".opencode", "opencode.json"),
    join(directory, ".opencode", "opencode.jsonc"),
  ]);
  const configPath = forceGlobal
    ? (globalCfg ?? join(globalDir, "opencode.json"))
    : (projectCfg ?? globalCfg ?? join(directory, "opencode.json"));

  if (!wantTui) return { config: configPath };
  if (host === "v2")
    return { config: configPath, tui: join(globalDir, "cli.json") };

  const tuiDir = forceGlobal ? globalDir : dirname(configPath);
  const tuiPath =
    pickExisting([join(tuiDir, "tui.json"), join(tuiDir, "tui.jsonc")]) ??
    join(tuiDir, "tui.json");
  return { config: configPath, tui: tuiPath };
}

function pickExisting(candidates: string[]): string | undefined {
  return candidates.find((p) => existsSync(p));
}

interface VersionCheck {
  name: string;
  version: string;
  range: string;
  ok: boolean;
}

async function runVersionChecks(
  pkg: PackageInfo,
  binary: string,
): Promise<VersionCheck[]> {
  const checks: VersionCheck[] = [];
  const bunVer = process.versions.bun ?? process.versions.node ?? "0.0.0";
  const bunRange = pkg.engines.bun ?? "(unstated)";
  checks.push({
    name: "bun",
    version: bunVer,
    range: bunRange,
    ok: !pkg.engines.bun || satisfies(bunVer, pkg.engines.bun),
  });
  const ocVersion = await probeOpencodeVersion(binary);
  const ocRange = pkg.engines.opencode ?? "(unstated)";
  checks.push({
    name: "opencode",
    version: ocVersion ?? "(not found)",
    range: ocRange,
    ok:
      ocVersion !== undefined &&
      (!pkg.engines.opencode || satisfies(ocVersion, pkg.engines.opencode)) &&
      (!ocVersion.startsWith("2.") || satisfies(ocVersion, SUPPORTED_V2_RANGE)),
  });
  return checks;
}

export async function probeOpencodeVersion(
  binary = "opencode",
): Promise<string | undefined> {
  try {
    const proc = Bun.spawn({
      cmd: [binary, "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 2000);
    const [code, out] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);
    clearTimeout(timer);
    if (code !== 0) return undefined;
    return (out.match(
      /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/,
    ) ?? [])[0];
  } catch {
    return undefined;
  }
}

async function readStdin(): Promise<string> {
  return new Response(await Bun.stdin.text()).text();
}
