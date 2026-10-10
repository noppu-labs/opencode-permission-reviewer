// One package-manager command's script call: manager options, the run
// subcommand and the literal script name.

import { basename } from "node:path";
import { elementAt } from "./element-at.ts";

export const MANAGERS: ReadonlySet<string> = new Set([
  "bun",
  "npm",
  "pnpm",
  "yarn",
]);

export interface ScriptInvocation {
  manager: string;
  script: string;
  arguments: string[];
  unresolved?: string;
}

const DIRECTORY_SELECTION =
  /^(?:--(?:cwd|prefix|workspace|workspaces|filter)|-F|-C)(?:=|$)/;
const VALUED_MANAGER_OPTIONS = [
  "--cwd",
  "--prefix",
  "--workspace",
  "--filter",
  "-F",
  "-C",
];

interface OptionScan {
  cursor: number;
  ambiguous: boolean;
}

function skipManagerOptions(tokens: string[], scan: OptionScan): void {
  while (tokens[scan.cursor]?.startsWith("-")) {
    const option = elementAt(tokens, scan.cursor, "tokens");
    scan.cursor += 1;
    if (DIRECTORY_SELECTION.test(option)) scan.ambiguous = true;
    if (VALUED_MANAGER_OPTIONS.includes(option)) scan.cursor += 1;
  }
}

function lifecycleScript(subcommand: string | undefined): string | undefined {
  return ["test", "start", "stop", "restart"].includes(subcommand ?? "")
    ? subcommand
    : undefined;
}

function isScriptName(script: string | undefined): script is string {
  return (
    script !== undefined &&
    script !== "" &&
    !script.startsWith("-") &&
    !/[/$`*?{}<>]/.test(script) &&
    !/\.[cm]?[jt]sx?$/.test(script)
  );
}

export function invocation(tokens: string[]): ScriptInvocation | undefined {
  const manager = basename(tokens[0] ?? "");
  if (!MANAGERS.has(manager)) return;
  const scan: OptionScan = { cursor: 1, ambiguous: false };
  skipManagerOptions(tokens, scan);
  const subcommand = tokens[scan.cursor];
  if (manager === "bun" && subcommand !== "run") return;
  const runs = subcommand === "run" || subcommand === "run-script";
  if (runs) {
    scan.cursor++;
    skipManagerOptions(tokens, scan);
  }
  const script = runs ? tokens[scan.cursor] : lifecycleScript(subcommand);
  if (!isScriptName(script)) return;
  return {
    manager,
    script,
    arguments: tokens.slice(scan.cursor + 1),
    ...(scan.ambiguous
      ? {
          unresolved:
            "runtime directory or workspace selection is not resolved",
        }
      : {}),
  };
}
