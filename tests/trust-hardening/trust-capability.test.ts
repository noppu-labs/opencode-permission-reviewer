import { afterEach, describe, expect, test } from "bun:test";
import { analyzeCapability } from "../../src/capability/bash-analyzer.ts";
import type { CapabilityAssessment } from "../../src/capability/capability-types.ts";
import { parseCommand } from "../../src/capability/command-parser.ts";
import { setGlobalConfigPathForTests } from "../../src/config/loader.ts";
import { resolveConfig } from "../../src/config.ts";
import { evaluatePolicy } from "../../src/policy/policy-engine.ts";
import { DIR, WT } from "./trust-fixtures.ts";

function assess(command: string): CapabilityAssessment {
  return analyzeCapability(parseCommand(command), DIR, WT);
}

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

// --- capability analyzer --------------------------------------------------------

describe("trust hardening — capability classification", () => {
  test("npm test executes repository code, not read-only", () => {
    const a = assess("npm test");
    expect(a.executesCode.value).toBe(true);
    expect(a.actionClass.value).toBe("code-execution");
  });

  test("git -C /repo push is detected as a git mutation despite the -C flag", () => {
    const a = assess("git -C /repo push origin main");
    expect(a.git.possible.value).toBe(true);
    expect(a.actionClass.value).toBe("git-mutation");
  });

  test("mv to an external destination is an external write", () => {
    const a = assess("mv file.txt /etc/config");
    expect(a.writeEffects.externalWrite.value).toBe(true);
    expect(a.actionClass.value).toBe("external-write");
  });

  test("a relative redirect escaping the workspace via .. is external", () => {
    const a = assess("printf x > ../../outside.txt");
    expect(a.writeEffects.externalWrite.value).toBe(true);
  });

  test("an unrecognized executable stays unknown, known read-only tools stay read-only", () => {
    expect(assess("zzz-unknown-cmd --flag notes.txt").actionClass.value).toBe(
      "unknown",
    );
    expect(assess("cat notes.txt").actionClass.value).toBe("read-only");
    expect(assess("git status").actionClass.value).toBe("read-only");
    expect(assess("cd sub && cat file").actionClass.value).toBe("read-only");
  });

  test("bun install satisfies a combined code-execution + package-management rule", () => {
    const capability = assess("bun install");
    const config = resolveConfig({
      repositoryTrust: "untrusted",
      policyRules: [
        {
          id: "both",
          source: "global",
          effect: "manual",
          reason: "code + packages",
          when: { executesCode: true, packageManagement: true },
        },
      ],
    });
    const trace = evaluatePolicy(
      capability,
      undefined,
      config,
      config.policyRules,
    );
    expect(trace.matchedRules.map((m) => m.id)).toContain("both");
  });
});

// --- analyzer: mutating forms of read-only tools and absolute normalization --------------

describe("trust hardening — read-only tools in mutating forms", () => {
  test("find -delete is a deletion, not read-only", () => {
    const cap = assess("find . -delete");
    expect(cap.writeEffects.deletion.value).toBe(true);
    expect(cap.actionClass.value).toBe("destruction");
  });

  test("find -exec executes code", () => {
    const cap = assess("find . -name '*.tmp' -exec rm {} ;");
    expect(cap.executesCode.value).toBe(true);
    expect(cap.actionClass.value).toBe("code-execution");
  });

  test("sort -o writes the named file", () => {
    const cap = assess("sort input.txt -o output.txt");
    expect(cap.writeEffects.workspaceWrite.value).toBe(true);
    expect(cap.actionClass.value).not.toBe("read-only");
  });

  test("plain find and sort remain read-only", () => {
    expect(assess("find . -name '*.tmp'").actionClass.value).toBe("read-only");
    expect(assess("sort input.txt").actionClass.value).toBe("read-only");
  });

  test("absolute paths with .. are normalized before classification", () => {
    expect(
      assess("cat /home/user/project/../etc/hosts").actionClass.value,
    ).toBe("read-only");
    const mv = assess(`mv file.txt ${DIR}/../outside.txt`);
    expect(mv.writeEffects.externalWrite.value).toBe(true);
    const tmp = assess(`cp a /tmp/../etc/passwd`);
    expect(tmp.writeEffects.externalWrite.value).toBe(true);
    // Normalization moved it out of the temp roots: not a temporary write.
    expect(tmp.writeEffects.temporaryWrite.value).not.toBe(true);
  });
});
