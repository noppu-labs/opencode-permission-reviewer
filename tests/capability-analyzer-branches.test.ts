import { describe, expect, test } from "bun:test";
import type { ParsedCommand } from "../src/capability/capability-types.ts";
import { capabilityProfile } from "./capability-profile.ts";

// Characterisation of analyzeCapability branches. Each row asserts the class,
// the summary and every fact whose value is `true`.

const NET =
  "network.observed,network.possible,network.observedAccess,network.possibleAccess";
const TESTS =
  "code-execution/medium | code-execution, repository code | executesCode,executesRepositoryCode,invokesExistingTestRunner,process.childProcesses";

describe("analyzeCapability segment heads", () => {
  test.each([
    [
      "FOO=1 sudo rm x",
      "destruction/high | destruction, privilege escalation | writeEffects.workspaceWrite,writeEffects.deletion,process.childProcesses,process.privilegeEscalation",
    ],
    [
      "then sudo ls",
      "privilege-escalation/high | privilege-escalation, privilege escalation | process.childProcesses,process.privilegeEscalation",
    ],
    [
      "then FOO=1 nohup ls",
      "persistence/high | persistence, persistence | process.childProcesses,process.persistence",
    ],
    ["FOO=1", "unknown/low | unknown | "],
    ["then", "unknown/low | unknown | "],
    // The peeled remote `rm x` also counts as a local deletion.
    [
      "ssh a ls; ssh b rm x",
      "remote-operation/high | remote-operation | writeEffects.workspaceWrite,writeEffects.deletion,process.childProcesses,remote.enabled,remote.mutationHint",
    ],
  ])("%s", (command, expected) => {
    expect(capabilityProfile(command)).toBe(expected);
  });
});

describe("analyzeCapability effective commands", () => {
  test.each([
    [
      "python3 -c 'print(1)'",
      "code-execution/high | code-execution, ad-hoc code | executesCode,createsAdHocCode,process.childProcesses",
    ],
    ["pytest -q", TESTS],
    ["bun t", TESTS],
    ["npm check", TESTS],
    ["cargo verify", TESTS],
    [
      "npm",
      `package-management/high | package-management, package lifecycle scripts, network | invokesPackageLifecycleScripts,${NET},process.childProcesses`,
    ],
    [
      "mamba list",
      `package-management/high | package-management, package lifecycle scripts, network | invokesPackageLifecycleScripts,${NET},process.childProcesses`,
    ],
    ["npm ls", "unknown/low | unknown | "],
    [
      "mosh host rm -rf /",
      "remote-operation/high | remote-operation | process.childProcesses,remote.enabled,remote.mutationHint",
    ],
    [
      "autossh host ls",
      "remote-operation/high | remote-operation | process.childProcesses,remote.enabled",
    ],
    [
      "cp",
      "workspace-write/medium | workspace-write | writeEffects.workspaceWrite",
    ],
    [
      "rm -rf",
      "destruction/high | destruction | writeEffects.workspaceWrite,writeEffects.deletion",
    ],
    [
      "crontab -l",
      "persistence/high | persistence, persistence | process.childProcesses,process.persistence",
    ],
    [
      "pytest; crontab -e",
      "code-execution/medium | code-execution, repository code, persistence | executesCode,executesRepositoryCode,invokesExistingTestRunner,process.childProcesses,process.persistence",
    ],
    // setcap is not peeled, so it is both the segment head and the effective
    // command.
    [
      "setcap cap x",
      "privilege-escalation/high | privilege-escalation, privilege escalation | process.childProcesses,process.privilegeEscalation",
    ],
  ])("%s", (command, expected) => {
    expect(capabilityProfile(command)).toBe(expected);
  });
});

describe("analyzeCapability credential operands", () => {
  // Each row asserts the credential facts reported for a cat operand list.
  test.each([
    ["cat -n ~/.ssh/id_rsa", "credentialRead"],
    ["cat -- .env", "credentialRead"],
    ["cat - .env", "credentialRead"],
    ["cat '>' ~/.ssh/id_rsa", ""],
    ["cat '2>' ~/.ssh/id_rsa", ""],
    ["cat '<' .env", ""],
    ["cat '<<' .env", ""],
    ["cat x '>>' .env", ""],
    ["cat '<x' .env", ""],
  ])("%s", (command, expected) => {
    expect(capabilityProfile(command)).toBe(
      `read-only/medium | read-only | ${expected}`,
    );
  });

  test("an empty effective command is skipped with its input redirect", () => {
    const parsed: ParsedCommand = {
      sanitizedCommand: "",
      segments: [],
      effective: [[]],
      redirections: [[{ operator: "<", target: ".env", quoted: false }]],
      heredocs: [],
      hasDynamicConstructs: false,
      analysisTruncated: false,
    };
    expect(capabilityProfile(parsed)).toBe("unknown/low | unknown | ");
  });
});
