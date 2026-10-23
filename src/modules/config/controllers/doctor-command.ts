// The `doctor` subcommand: versions, config sources, audit path writability and policy mode.
import { parseArgs } from "node:util";
import { findPackageJson } from "../../../utils/package-json.ts";
import { resolveAuditPath } from "../../audit/services/audit.ts";
import {
  filterProjectAllowRules,
  hashEffectivePolicy,
} from "../../policy/policy-engine.ts";
import {
  checkWritable,
  connectedStatus,
} from "../services/doctor/doctor-probes.ts";
import {
  type DoctorReport,
  printDoctorHuman,
} from "../services/doctor/doctor-report.ts";
import { probeOpencodeVersion } from "../services/init/init-host-version.ts";
import { loadResolvedConfig } from "../services/loader.ts";
import { inspectConfigSources } from "./config-sources.ts";

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
  const report = await buildReport(
    values.project ?? process.cwd(),
    values.endpoint,
    values.binary,
  );

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  printDoctorHuman(report);
  return 0;
}

async function buildReport(
  directory: string,
  endpoint: string | undefined,
  binary: string | undefined,
): Promise<DoctorReport> {
  const pkg = readPackageJson();
  const config = loadResolvedConfig(undefined, directory);
  const sources = inspectConfigSources(directory);
  const effectiveHash = hashEffectivePolicy(
    filterProjectAllowRules(config.policyRules),
    config,
  );
  const auditPath = resolveAuditPath(config);
  const auditWritable = await checkWritable(auditPath);
  const connected = endpoint
    ? await connectedStatus(endpoint, directory)
    : undefined;

  return {
    mode: endpoint ? "connected" : "local-only",
    host: {
      binaryVersion: binary
        ? ((await probeOpencodeVersion(binary)) ?? null)
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
      configWarnings: config.configWarnings ?? [],
      configDegraded: config.configDegraded ?? [],
    },
    audit: {
      path: auditPath,
      writable: auditWritable.ok,
      ...(auditWritable.error ? { error: auditWritable.error } : {}),
    },
  };
}

function readPackageJson(): {
  version: string | undefined;
  engines: { opencode?: string; bun?: string };
} {
  const found = findPackageJson(import.meta.dirname);
  if (found === undefined) throw new Error("could not locate package.json");
  return {
    version: found.manifest.version,
    engines: found.manifest.engines ?? {},
  };
}
