import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { permuteAutosshWords } from "../src/autossh-permutation.ts";
import { emergencyBrakeReason } from "../src/emergency-brake.ts";
import { analyzeEffectiveCommands } from "../src/shell-effective-commands.ts";
import { lexSegments } from "../src/shell-scanner.ts";
import {
  readAutosshArguments,
  readMoshArguments,
} from "../src/ssh-arguments.ts";
import { sshDestinationHost } from "../src/ssh-destination.ts";
import { readSshArguments, type SshCall } from "../src/ssh-value-options.ts";
import { capabilityProfile } from "./capability-profile.ts";
import { defined, request } from "./helpers.ts";

interface ReadRow {
  id: string;
  form: string;
  words: string[];
  start?: number;
  destination: number | null;
  remoteCommand: number | null;
  terminated?: boolean;
}

interface PermutedRow {
  id: string;
  form: string;
  words: string[];
  permuted: string[];
}

interface HostRow {
  id: string;
  word: string;
  user?: string;
  host: string;
  port?: string;
}

interface CommandsRow {
  id: string;
  form: string;
  command: string;
  commands: string[][];
}

interface BrakeRow {
  id: string;
  form: string;
  command: string;
  reason?: "destruction" | "secret";
}

const fixtures = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/ssh-argument-rows.json"),
    "utf8",
  ),
) as {
  reads: ReadRow[];
  permuted: PermutedRow[];
  hosts: HostRow[];
  commands: CommandsRow[];
  brake: BrakeRow[];
};

const REASONS = {
  destruction:
    "Emergency brake: command contains unmistakable broad system destruction.",
  secret:
    "Emergency brake: command appears to export credential material through a network utility.",
};

function read(words: readonly string[], start: number): SshCall {
  const program = basename(defined(words[0], "program"));
  if (program === "mosh") return readMoshArguments(words, start);
  if (program === "autossh") return readAutosshArguments(words, start);
  return readSshArguments(words, start);
}

function verdict(command: string): string | undefined {
  return emergencyBrakeReason(
    request({ permission: "bash", patterns: [command], metadata: { command } }),
  );
}

function commandsOf(command: string): string[][] {
  const segment = defined(lexSegments(command)[0], "first segment");
  return analyzeEffectiveCommands(segment).commands.map((tokens) =>
    tokens.map((token) => token.value),
  );
}

describe("ssh, mosh and autossh arguments", () => {
  test.each(fixtures.reads.map((row) => [row.id, row.form, row] as const))(
    "%s reads %s",
    (_id, _form, row) => {
      const call = read(row.words, row.start ?? 1);
      expect(call.destination ?? null).toBe(row.destination);
      expect(call.remoteCommand ?? null).toBe(row.remoteCommand);
      if (row.terminated !== undefined)
        expect(call.terminated).toBe(row.terminated);
    },
  );

  test.each(fixtures.permuted.map((row) => [row.id, row.form, row] as const))(
    "%s orders autossh's words: %s",
    (_id, _form, row) => {
      expect(permuteAutosshWords(row.words, 1)).toEqual(row.permuted);
    },
  );

  test.each(fixtures.hosts.map((row) => [row.id, row.word, row] as const))(
    "%s splits the destination %s",
    (_id, _word, row) => {
      const { id: _row, word, ...expected } = row;
      expect(sshDestinationHost(word)).toEqual(expected);
    },
  );
});

describe("effective commands of ssh, mosh and autossh", () => {
  test.each(fixtures.commands.map((row) => [row.id, row.form, row] as const))(
    "%s reads %s",
    (_id, _form, row) => {
      expect(commandsOf(row.command)).toEqual(row.commands);
    },
  );
});

describe("capability profile of mosh and autossh", () => {
  test.each([
    ["mosh h -- rm x", "ssh h rm x"],
    ["autossh -M 0 -f h rm x", "ssh h rm x"],
    ["mosh --ssh x h -- ls", "ssh h ls"],
    ["ssh -S c h rm x", "ssh h rm x"],
  ])("%s reads like %s", (command, twin) => {
    expect(capabilityProfile(command)).toBe(capabilityProfile(twin));
  });
});

describe("emergency brake on ssh, mosh and autossh", () => {
  test.each(fixtures.brake.map((row) => [row.id, row.form, row] as const))(
    "%s gives the verdict for %s",
    (_id, _form, row) => {
      expect(verdict(row.command)).toBe(
        row.reason === undefined ? undefined : REASONS[row.reason],
      );
    },
  );
});
