// Applying `init`'s planned config writes: re-plan each file, refuse stale or malformed ones, back up, write.
import { existsSync } from "node:fs";
import { planFileChange } from "./init-config-files.ts";
import { writeBackup, writeEntry } from "./init-config-write.ts";
import type {
  FilePlan,
  HostGeneration,
  PackageInfo,
  PluginEntry,
} from "./init-types.ts";

/** Each plan is re-resolved against the current file before its write, so a
 *  file edited or created since planning refuses its write instead of acting
 *  on stale assumptions. Returns the process exit code. */
export function applyPlannedWrites(
  plans: FilePlan[],
  entry: PluginEntry,
  pkg: PackageInfo,
  host: HostGeneration = "v1",
): number {
  for (const plan of plans) {
    if (plan.action === "noop") continue;
    if (!applyPlan(plan, entry, pkg, host)) return 1;
  }

  console.error("init: done");
  console.error("next: restart OpenCode to load the plugin");
  console.error(
    'next: ensure at least one permission "ask" rule (e.g. bash), or the plugin is a no-op',
  );
  if (plans.some((p) => p.backup)) {
    console.error(
      "rollback: restore from the .bak file above and restart OpenCode",
    );
  }

  return 0;
}

/** Writes one plan, or prints why it refuses and returns false. */
function applyPlan(
  plan: FilePlan,
  entry: PluginEntry,
  pkg: PackageInfo,
  host: HostGeneration,
): boolean {
  const fresh = planFileChange(plan.path, pkg, host);
  const refusal = refusalOf(plan, fresh);
  if (refusal !== undefined) {
    console.error(refusal);
    return false;
  }
  if (fresh.backup !== undefined && existsSync(plan.path)) {
    console.error(`  backup: ${writeBackup(plan.path, fresh.backup)}`);
  }
  try {
    writeEntry(
      plan.path,
      entry,
      fresh.action === "create",
      host,
      fresh.fingerprint,
    );
  } catch (error) {
    // A file created in the residual race between re-planning and writing
    // must never be clobbered; anything else is unexpected and propagates.
    if ((error as { code?: unknown }).code !== "EEXIST") throw error;
    console.error(
      `init: ${plan.path} was created concurrently; refusing to overwrite`,
    );
    return false;
  }
  return true;
}

function refusalOf(plan: FilePlan, fresh: FilePlan): string | undefined {
  if (
    fresh.action !== plan.action ||
    (plan.fingerprint !== undefined && fresh.fingerprint !== plan.fingerprint)
  ) {
    return `init: ${plan.path} changed since planning (was ${plan.action}, now ${fresh.action}); refusing to write`;
  }
  if (fresh.action === "error") {
    return `init: ${plan.path} is malformed or has a non-array "plugin" key; refusing to write`;
  }
  return undefined;
}
