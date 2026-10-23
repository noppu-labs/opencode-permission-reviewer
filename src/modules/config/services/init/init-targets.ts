// The plugin entry `init` registers and the OpenCode config files it targets, global or project, with the TUI file.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  HostGeneration,
  PackageInfo,
  PluginEntry,
} from "../../models/init-types.ts";

export function buildEntry(
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

export function resolveTargets(
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
