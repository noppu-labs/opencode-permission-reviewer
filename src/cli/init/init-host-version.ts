// The Bun and OpenCode version checks `init` reports, the OpenCode binary probe `doctor` shares, and host detection.
import { satisfies } from "semver";
import { SUPPORTED_V2_RANGE } from "../../adapters/opencode/host-guard.ts";
import type { HostGeneration, PackageInfo } from "./init-types.ts";

export interface VersionCheck {
  name: string;
  version: string;
  range: string;
  ok: boolean;
}

export async function runVersionChecks(
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

/** The host generation an OpenCode version string belongs to, if any. */
export function detectHost(
  version: string | undefined,
): HostGeneration | undefined {
  if (version?.startsWith("1.")) return "v1";
  if (version?.startsWith("2.")) return "v2";
  return undefined;
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
