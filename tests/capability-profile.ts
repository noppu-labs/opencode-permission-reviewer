import { analyzeCapability } from "../src/capability/bash-analyzer.ts";
import type { ParsedCommand } from "../src/capability/capability-types.ts";
import { parseCommand } from "../src/capability/command-parser.ts";

const DIR = "/home/user/project";

function trueFacts(node: object, path: string[], out: string[]): string[] {
  if ("value" in node && "source" in node) {
    if (node.value === true) out.push(path.join("."));
    return out;
  }
  for (const [key, child] of Object.entries(node)) {
    if (child !== null && typeof child === "object" && !Array.isArray(child))
      trueFacts(child, [...path, key], out);
  }
  return out;
}

/** The class, the summary and every fact whose value is `true`, as one line,
 *  with directory and worktree both `/home/user/project`. */
export function capabilityProfile(command: string | ParsedCommand): string {
  const parsed = typeof command === "string" ? parseCommand(command) : command;
  const assessment = analyzeCapability(parsed, DIR, DIR);
  const { value, confidence } = assessment.actionClass;
  const facts = trueFacts(assessment, [], []).join(",");
  return `${value}/${confidence} | ${assessment.summary} | ${facts}`;
}
