import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCommand } from "../src/capability/command-parser.ts";
import { capabilityProfile } from "./capability-profile.ts";

// Wrapper and remote facts come from every command the shell walk resolves:
// inside command strings, `env -S`, `watch` and ssh remote commands, and
// after a leading redirection. Each row's command gets the same profile as
// its twin, which runs the same commands directly.

interface HeadRow {
  id: string;
  form: string;
  command: string;
  twin: string;
  class: string;
  heads: string[];
}

const { rows } = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/wrapper-head-rows.json"),
    "utf8",
  ),
) as { rows: HeadRow[] };

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
