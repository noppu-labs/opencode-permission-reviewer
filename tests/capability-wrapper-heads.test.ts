import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emergencyBrakeReason } from "../src/modules/analysis/brake/emergency-brake.ts";
import { parseCommand } from "../src/modules/analysis/capability/command-parser.ts";
import { gnuSplitWords } from "../src/modules/analysis/walk/env-split-words.ts";
import { capabilityProfile } from "./capability-profile.ts";
import { request } from "./helpers.ts";

// Wrapper and remote facts come from every command the shell walk resolves:
// inside command strings, `env -S`, `watch` and ssh remote commands, and
// after a leading redirection. Each row's command gets the same profile as
// its twin, which runs the same commands directly. The brake reads the
// command that `env -S` options lead to, and the wrapper facts of a command
// past the walk's limits are kept.

interface HeadRow {
  id: string;
  form: string;
  command: string;
  twin: string;
  class: string;
  heads: string[];
}

interface BrakeRow {
  id: string;
  form: string;
  command: string;
  reason?: "destruction";
}

interface ReadRow {
  id: string;
  form: string;
  command: string;
}

interface SplitRow {
  id: string;
  script: string;
  unset?: boolean;
  words: string[] | null;
}

const { rows, brake, reads, split } = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/wrapper-head-rows.json"),
    "utf8",
  ),
) as {
  rows: HeadRow[];
  brake: BrakeRow[];
  reads: ReadRow[];
  split: SplitRow[];
};

const DESTRUCTION =
  "Emergency brake: command contains unmistakable broad system destruction.";

const HEAD_FACTS: Record<string, string> = {
  "process.privilegeEscalation": "privilegeEscalation",
  "process.persistence": "persistence",
  "remote.enabled": "remote",
  "remote.mutationHint": "remoteMutation",
};

function headFacts(profile: string): string[] {
  const facts = (profile.split(" | ")[2] ?? "").split(",");
  return Object.entries(HEAD_FACTS)
    .filter(([fact]) => facts.includes(fact))
    .map(([, name]) => name);
}

describe("wrapper and remote facts from the walk", () => {
  test.each(rows.map((row) => [`${row.id} ${row.form}`, row] as const))(
    "%s",
    (_title, row) => {
      const profile = capabilityProfile(row.command);
      expect(profile.split("/")[0]).toBe(row.class);
      expect(headFacts(profile)).toEqual(row.heads);
      expect(profile).toBe(capabilityProfile(row.twin));
    },
  );

  test("a command inside an ssh remote command sets privilege escalation", () => {
    expect(headFacts(capabilityProfile("ssh h sudo id"))).toContain(
      "privilegeEscalation",
    );
  });

  test("lists each resolved command, marking those of a remote command", () => {
    const { heads } = parseCommand("sudo sh -c 'ssh h nohup x'");
    expect(heads.map((h) => [h.head, h.index, h.remote])).toEqual([
      ["sudo", 0, false],
      ["sh", 1, false],
      ["ssh", 0, false],
      ["nohup", 0, true],
      ["x", 1, true],
    ]);
    expect(heads.map((h) => h.tokens[h.index]?.value)).toEqual([
      "sudo",
      "sh",
      "ssh",
      "nohup",
      "x",
    ]);
  });

  test("lists the commands after a leading redirection", () => {
    const { heads } = parseCommand("2>/dev/null nohup ls");
    expect(heads.map((h) => h.head)).toEqual(["nohup", "ls"]);
  });
});

describe("the command after env -S options", () => {
  test.each(brake.map((row) => [`${row.id} ${row.form}`, row] as const))(
    "%s",
    (_title, row) => {
      const { command } = row;
      expect(
        emergencyBrakeReason(
          request({ patterns: [command], metadata: { command } }),
        ),
      ).toBe(row.reason === undefined ? undefined : DESTRUCTION);
    },
  );
});

describe("wrapper facts past the walk limits", () => {
  const commands = "true;".repeat(4_100);
  test.each([
    [`${commands} sudo x`, "sudo x"],
    [`${commands} nohup x`, "nohup x"],
    [`${commands} ssh h 'rm x'`, "ssh h 'rm x'"],
    [`${commands} timeout 5 busybox nohup x`, "nohup x"],
    [`${"timeout 5 ".repeat(40)}sudo id`, "sudo id"],
    [`${"busybox ".repeat(40)}run0 id`, "run0 id"],
  ])("%#", (command, twin) => {
    expect(parseCommand(command).analysisTruncated).toBe(true);
    expect(headFacts(capabilityProfile(command))).toEqual(
      headFacts(capabilityProfile(twin)),
    );
  });
});

describe("writes of redirections on a command that resolves to none", () => {
  test.each([
    [">f ssh h", "workspaceWrite"],
    [">f env -S '-i ssh h'", "workspaceWrite"],
    ["2>/dev/null env -S '- -- rm x'", "temporaryWrite"],
    ["exec >f", "workspaceWrite"],
  ])("%s", (command, write) => {
    expect(capabilityProfile(command).split(" | ")[2]).toContain(
      `writeEffects.${write}`,
    );
  });
});

describe("credential reads of input redirections on a command that resolves to none", () => {
  test.each(reads.map((row) => [`${row.id} ${row.form}`, row] as const))(
    "%s",
    (_title, row) => {
      expect(capabilityProfile(row.command).split(" | ")[2]).toContain(
        "credentialRead",
      );
    },
  );
});

describe("the words env splits an -S string into", () => {
  test.each(split.map((row) => [`${row.id} ${row.script}`, row] as const))(
    "%s",
    (_title, row) => {
      expect(gnuSplitWords(row.script, row.unset) ?? null).toEqual(row.words);
    },
  );
});
