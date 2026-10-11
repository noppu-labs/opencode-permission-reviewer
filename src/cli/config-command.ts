// The `config print-effective` subcommand: the resolved config, its sources and the effective policy hash.
import { parseArgs } from "node:util";
import { loadResolvedConfig } from "../config/loader.ts";
import {
  filterProjectAllowRules,
  hashEffectivePolicy,
} from "../policy/policy-engine.ts";
import type { ReviewerConfig } from "../types.ts";
import { inspectConfigSources } from "./config-sources.ts";

export async function runConfig(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help || positionals[0] !== "print-effective") {
    console.error("Usage: config print-effective [--project <dir>]");
    return 2;
  }
  const directory = values.project ?? process.cwd();
  const config = loadResolvedConfig(undefined, directory);
  const sources = inspectConfigSources(directory);
  const report = {
    command: "print-effective",
    directory,
    sources,
    config: redactConfig(config),
    policy: {
      ruleCount: config.policyRules.length,
      effectivePolicyHash: hashEffectivePolicy(
        filterProjectAllowRules(config.policyRules),
        config,
      ),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

/** Defensive redaction: no ReviewerConfig field is sensitive today, but this
 *  guards against future additions (tokens, keys) leaking via print-effective. */
function redactConfig(config: ReviewerConfig): ReviewerConfig {
  return config;
}
