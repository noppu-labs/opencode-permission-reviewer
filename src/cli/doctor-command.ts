// The `doctor` subcommand: versions, config sources, audit path writability and policy mode.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { OpenCode } from "@opencode/client";
import { resolveAuditPath } from "../audit.ts";
import {
  globalConfigPath,
  loadResolvedConfig,
  projectConfigPath,
} from "../config/loader.ts";
import { validateHostEndpoint } from "../opencode/v2/connection.ts";
import {
  filterProjectAllowRules,
  hashEffectivePolicy,
} from "../policy/policy-engine.ts";
import { ReviewerRpc } from "../ui/rpc.ts";
import { probeOpencodeVersion } from "./init.ts";

export async function runDoctor(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      binary: { type: "string" },
      endpoint: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.error("Usage: doctor [--project <dir>] [--json]");
    return 0;
  }
  const directory = values.project ?? process.cwd();
  const pkg = readPackageJson();
  const config = loadResolvedConfig(undefined, directory);
  const sources = inspectConfigSources(directory);
  const effectiveHash = hashEffectivePolicy(
    filterProjectAllowRules(config.policyRules),
    config,
  );
  const auditPath = resolveAuditPath(config);
  const auditWritable = await checkWritable(auditPath);
  let connected: unknown;
  if (values.endpoint) {
    const password =
      process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD;
    if (!password)
      throw new Error("Connected doctor requires OPENCODE_PASSWORD");
    const client = OpenCode.make({
      baseUrl: validateHostEndpoint(values.endpoint).href,
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      },
    });
    connected = await client
      .rpc(ReviewerRpc)
      .status(
        {},
        { location: { directory }, signal: AbortSignal.timeout(5000) },
      );
  }

  const report = {
    mode: values.endpoint ? "connected" : "local-only",
    host: {
      binaryVersion: values.binary
        ? ((await probeOpencodeVersion(values.binary)) ?? null)
        : null,
      runtime: connected ?? null,
    },
    version: {
      package: pkg.version,
      opencodeRange: pkg.engines.opencode ?? "(unstated)",
      runtime: `bun/${process.versions.bun ?? "?"}`,
    },
    config: {
      global: sources.global,
      project: sources.project,
      model: config.model,
      enforcementMode: config.enforcementMode,
      repositoryTrust: config.repositoryTrust,
      policyRuleCount: config.policyRules.length,
      effectivePolicyHash: effectiveHash,
    },
    audit: {
      path: auditPath,
      writable: auditWritable.ok,
      ...(auditWritable.error ? { error: auditWritable.error } : {}),
    },
  };

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.error(`opencode-permission-reviewer doctor ${pkg.version}`);
  console.error(`diagnostic mode: ${report.mode}`);
  console.error(`version`);
  console.error(`  package:    ${report.version.package}`);
  console.error(
    `  opencode:   ${report.version.opencodeRange} (engines.opencode)`,
  );
  console.error(`  runtime:    ${report.version.runtime}`);
  console.error(`config`);
  console.error(`  global:     ${fmtSource(sources.global)}`);
  console.error(`  project:    ${fmtSource(sources.project)}`);
  console.error(`  model:      ${report.config.model}`);
  // The mode gates declarative rules only; the reviewer still auto-allows or denies.
  const modeNote =
    report.config.enforcementMode === "observe"
      ? "declarative rules audited only; reviewer auto-allow/deny remains active"
      : "declarative rules enforced; reviewer decisions unchanged";
  console.error(`  mode:       ${report.config.enforcementMode} (${modeNote})`);
  console.error(`  trust:      ${report.config.repositoryTrust}`);
  console.error(
    `  rules:      ${report.config.policyRuleCount} (effectivePolicyHash: ${effectiveHash})`,
  );
  console.error(`audit`);
  console.error(`  path:       ${auditPath}`);
  console.error(
    `  writable:   ${auditWritable.ok ? "yes" : "no"}${auditWritable.error ? ` (${auditWritable.error})` : ""}`,
  );
  return 0;
}

/** Locate the nearest package.json by walking up from this module. The CLI
 *  lives at <root>/src/cli (source) or <root>/dist (bundle), so the package
 *  root is a different number of levels up in each layout; searching upward
 *  works for both. */
function readPackageJson(): {
  version: string;
  engines: { opencode?: string; bun?: string };
} {
  let dir = import.meta.dirname;
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const raw = JSON.parse(readFileSync(candidate, "utf8")) as {
        version: string;
        engines?: { opencode?: string; bun?: string };
      };
      return { version: raw.version, engines: raw.engines ?? {} };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate package.json");
}

interface SourceInfo {
  path: string;
  exists: boolean;
  sha256: string | null;
}

export function inspectConfigSources(directory: string): {
  global: SourceInfo;
  project: SourceInfo;
} {
  return {
    global: inspectFile(globalConfigPath()),
    project: inspectFile(projectConfigPath(directory)),
  };
}

function inspectFile(path: string): SourceInfo {
  try {
    const content = readFileSync(path, "utf8");
    return { path, exists: true, sha256: sha256hex(content).slice(0, 16) };
  } catch {
    return { path, exists: false, sha256: null };
  }
}

function fmtSource(s: SourceInfo): string {
  return `${s.path}  exists=${s.exists ? "yes" : "no"}  sha256=${s.sha256 ?? "-"}`;
}

async function checkWritable(
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await mkdir(dirname(path), { recursive: true });
    // Match the writer's 0600 mode so a doctor probe never leaves a
    // world-readable audit trail behind.
    const fh = await open(path, "a", 0o600);
    await fh.close();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
