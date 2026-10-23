// The `explain` subcommand: dry-run one permission request through the capability analyzer and policy engine.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { PermissionRequest, ReviewerConfig } from "../../../types.ts";
import { analyzeCapability } from "../../analysis/capability/bash-analyzer.ts";
import { parseCommand } from "../../analysis/capability/command-parser.ts";
import { reviewedCommand } from "../../analysis/reviewed-command.ts";
import { resolveConfig } from "../../config/services/config.ts";
import { loadResolvedConfig } from "../../config/services/loader.ts";
import { evaluatePolicy } from "../../policy/policy-engine.ts";
import { type ExplainRequest, normalizeRequest } from "./explain-request.ts";

export async function runExplain(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      event: { type: "string" },
      defaults: { type: "boolean" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.error(`Usage: explain --event <fixture.json> [--project <dir>]
Reads a permission request JSON, runs the capability analyzer and policy engine
(observe mode), and prints the result as JSON.`);
    return 0;
  }

  const raw = values.event
    ? readFileSync(values.event, "utf8")
    : await readStdin();
  const normalized = parseInput(raw);
  if (normalized === undefined) return 2;
  const request = normalized.request;

  const directory = values.project ?? process.cwd();
  const config = values.defaults
    ? resolveConfig(undefined)
    : loadResolvedConfig(undefined, directory);
  const nativeResources = normalized.nativeAction !== undefined;
  const command = commandOf(request, nativeResources);

  const result: Record<string, unknown> = {
    permission: request.permission,
    command,
    configuration: values.defaults ? "defaults" : "effective",
    model: config.model,
    ...(nativeResources
      ? {
          resources: request.patterns,
          actionEvidenceComplete: normalized.actionEvidenceComplete,
          nativeAction: normalized.nativeAction,
        }
      : {}),
    ...analysis(request, command, directory, config),
  };
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

/** The normalised request, or undefined after printing why the input is unusable. */
function parseInput(raw: string): ExplainRequest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("explain: input is not valid JSON");
    return undefined;
  }

  const normalized = normalizeRequest(parsed);
  if (normalized === undefined) {
    console.error(
      'explain: input must have "permission" and "metadata.command" or "patterns"',
    );
  }
  return normalized;
}

function commandOf(
  request: PermissionRequest,
  nativeResources: boolean,
): string {
  if (!nativeResources) return reviewedCommand(request);
  const { command } = request.metadata;
  return typeof command === "string" ? command : "";
}

function analysis(
  request: PermissionRequest,
  command: string,
  directory: string,
  config: ReviewerConfig,
): { capability: unknown; policyTrace: unknown } {
  if (request.permission === "bash" && command.trim()) {
    const parsedCmd = parseCommand(command);
    const capability = analyzeCapability(parsedCmd, directory, directory);
    const policyTrace = evaluatePolicy(
      capability,
      undefined,
      config,
      config.policyRules,
    );
    return { capability, policyTrace };
  }
  return {
    capability: null,
    policyTrace: evaluatePolicy(
      undefined,
      undefined,
      config,
      config.policyRules,
    ),
  };
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}
