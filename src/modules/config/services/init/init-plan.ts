// Resolving `init`'s host, plugin entry and per-file plans from its options, refusing uncertain or conflicting hosts.

import type { HostGeneration, PackageInfo } from "../../models/init-types.ts";
import { planFileChange } from "./init-config-files.ts";
import { readConfigFile } from "./init-config-read.ts";
import {
  detectHost,
  runVersionChecks,
  type VersionCheck,
} from "./init-host-version.ts";
import type { InitPlan } from "./init-report.ts";
import { buildEntry, resolveTargets } from "./init-targets.ts";

interface PlanOptions {
  host: string;
  binary: string;
  npm?: boolean;
  global?: boolean;
  tui?: boolean;
}

/** Resolves the host, entry and per-file plans, or prints why it cannot and
 *  returns the exit code. */
export async function planInit(
  values: PlanOptions,
  pkg: PackageInfo,
  directory: string,
): Promise<InitPlan | number> {
  if (!["auto", "v1", "v2"].includes(values.host)) {
    console.error("init: --host must be auto, v1, or v2");
    return 2;
  }
  const versionChecks = await runVersionChecks(pkg, values.binary);
  const host = selectHost(values.host, versionChecks);
  if (typeof host === "number") return host;
  const entry = buildEntry(pkg, Boolean(values.npm), host);
  const targets = resolveTargets(
    directory,
    Boolean(values.global),
    Boolean(values.tui),
    host,
  );
  const disagrees = formatDisagrees(targets.config, host);
  if (values.host === "auto" && disagrees) {
    console.error(
      "init: binary version and config format disagree; select --host explicitly",
    );
    return 2;
  }

  const plans = [targets.config, ...(targets.tui ? [targets.tui] : [])].map(
    (p) => planFileChange(p, pkg, host),
  );
  return { host, entry, plans, versionChecks };
}

function selectHost(
  requested: string,
  versionChecks: VersionCheck[],
): HostGeneration | number {
  const opencode = versionChecks.find((check) => check.name === "opencode");
  if (requested === "auto" && !opencode?.ok) {
    console.error(
      "init: detected host is unavailable or unsupported; no configuration was written",
    );
    return 2;
  }
  const host =
    requested === "auto"
      ? detectHost(opencode?.version)
      : (requested as HostGeneration);
  if (!host) {
    console.error(
      "init: cannot determine the host; pass --host v1 or --host v2",
    );
    return 2;
  }
  return host;
}

/** Whether an existing config already uses the other host's plugin key. */
function formatDisagrees(path: string, host: HostGeneration): boolean {
  const existing = readConfigFile(path);
  if (existing.status !== "read") return false;
  return (
    (host === "v1" && "plugins" in existing.config) ||
    (host === "v2" && "plugin" in existing.config)
  );
}
