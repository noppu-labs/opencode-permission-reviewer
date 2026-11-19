import { describe, expect, test } from "bun:test";
import { analyzeCapability } from "../../src/modules/analysis/capability/bash-analyzer.ts";
import { parseCommand } from "../../src/modules/analysis/capability/command-parser.ts";
import type { CapabilityAssessment } from "../../src/modules/analysis/capability/models/capability-types.ts";
import { resolveConfig } from "../../src/modules/config/services/config.ts";
import { evaluatePolicy } from "../../src/modules/policy/policy-engine.ts";
import { DIR, WT } from "./trust-fixtures.ts";

function assess(command: string): CapabilityAssessment {
  return analyzeCapability(parseCommand(command), DIR, WT);
}

describe("trust hardening — writes hidden in usually read-only tools", () => {
  test.each([
    "sort -uo output.txt input.txt",
    "sort -nruooutput.txt input.txt",
    "sort --out=output.txt input.txt",
    "sort --o output.txt input.txt",
    "uniq input.txt output.txt",
    "uniq -c -f 1 input.txt output.txt",
    "xxd input.bin output.hex",
    "xxd -cols 8 input.bin output.hex",
    "xxd input.bin -x",
    "tree -o output.txt",
    "tree -ao output.txt",
    "tree -L 2 -o out.txt src",
    "tree -L2 -o out.txt src",
    "yq -iP '.a = 1' config.yaml",
    "yq --inplace=true '.a' config.yaml",
    "yq -s '.name' '.' config.yaml",
  ])("%s writes the workspace", (command) => {
    const cap = assess(command);
    expect(cap.writeEffects.workspaceWrite.value).toBe(true);
    expect(cap.actionClass.value).toBe("workspace-write");
  });

  test.each([
    "sort -uo/etc/reviewer-output input.txt",
    "xxd -r input.hex /etc/reviewer-output",
    "yq -s '.name' --security-allow-write-any-path '.' config.yaml",
  ])("%s writes outside the workspace", (command) => {
    expect(assess(command).actionClass.value).toBe("external-write");
  });

  test("tree -R writes a listing into each directory it visits", () => {
    const cap = assess("tree -R -L 1 -H . docs");
    expect(cap.writeEffects.workspaceWrite.value).toBe(true);
  });

  test.each([
    "sort --compress-program=./payload input.txt",
    "sort --co ./payload input.txt",
  ])("%s runs a program", (command) => {
    const cap = assess(command);
    expect(cap.executesCode.value).toBe(true);
    expect(cap.actionClass.value).toBe("code-execution");
  });

  test.each([
    "find . -name '*.tmp'",
    "sort input.txt",
    "sort -u -k2 -t, input.txt",
    "sort -t o input.txt",
    "sort -T /tmp input.txt",
    "uniq -c input.txt",
    "uniq -f 1 input.txt",
    "uniq input.txt -",
    "uniq --skip-f 2 input.txt",
    "xxd input.bin",
    "xxd -c 8 input.bin",
    "xxd --cols 8 input.bin",
    "tree -L 2 src",
    "yq '.a' config.yaml",
    "yq -oi '.a' config.yaml",
    "yq --inplace=false '.a' config.yaml",
  ])("%s stays read-only", (command) => {
    expect(assess(command).actionClass.value).toBe("read-only");
  });

  test("a workspace-write rule matches a clustered sort output", () => {
    const config = resolveConfig({
      policyRules: [
        {
          id: "deny-workspace-writes",
          source: "global",
          effect: "deny",
          reason: "workspace writes are denied",
          when: { writesWorkspace: true },
        },
      ],
    });
    const trace = evaluatePolicy(
      assess("sort -uo sorted.txt input.txt"),
      undefined,
      config,
      config.policyRules,
    );
    expect(trace.matchedRules.map((m) => m.id)).toContain(
      "deny-workspace-writes",
    );
  });
});
