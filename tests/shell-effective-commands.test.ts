import { describe, expect, test } from "bun:test";
import { analyzeEffectiveCommands } from "../src/shell-effective-commands.ts";
import { lexSegments } from "../src/shell-scanner.ts";
import { defined } from "./helpers.ts";

/** Walk the first segment of `command` against a budget with the given
 *  counters, and report what was collected and what is left. */
function spend(
  command: string,
  remainingCommands: number,
  remainingReanalysisChars: number,
): { commands: string[][]; truncated: boolean; left: number[] } {
  const segment = defined(lexSegments(command)[0], "first segment");
  const budget = { remainingCommands, remainingReanalysisChars };
  const analysis = analyzeEffectiveCommands(segment, budget);
  expect(analysis.redirections).toHaveLength(analysis.commands.length);
  return {
    commands: analysis.commands.map((tokens) => tokens.map((t) => t.value)),
    truncated: analysis.truncated,
    left: [budget.remainingCommands, budget.remainingReanalysisChars],
  };
}

function commandsOf(command: string): string[][] {
  const { commands, truncated } = spend(command, 5, 100);
  expect(truncated).toBe(false);
  return commands;
}

describe("effective-command walk: command head", () => {
  test("a `--` in command position ends the walk without a command", () => {
    expect(commandsOf("-- rm -rf /")).toEqual([]);
    expect(commandsOf("FOO=1 -- rm")).toEqual([]);
    expect(commandsOf("sudo -- -- rm")).toEqual([]);
  });

  test("keywords are skipped before assignments, and `if` is not a keyword", () => {
    expect(commandsOf("then FOO=1 rm")).toEqual([["rm"]]);
    expect(commandsOf("if then rm")).toEqual([["if", "then", "rm"]]);
  });

  test.each([
    "sudo",
    "sudo -u",
    "sudo -u root",
    "env -i",
    "timeout",
    "timeout 5",
    "timeout -s",
    "timeout -s KILL",
    "busybox",
    "chroot /r",
    "ssh host",
    "ssh host ''",
    "ssh -p 22",
  ])("%p has nothing left to run and yields no command", (command) => {
    expect(commandsOf(command)).toEqual([]);
  });

  test("transparent wrappers stop their options at `--`", () => {
    expect(commandsOf("sudo -- rm -rf /")).toEqual([["rm", "-rf", "/"]]);
    expect(commandsOf("nice -- rm")).toEqual([["rm"]]);
    expect(commandsOf("sudo FOO=1 -- rm")).toEqual([["rm"]]);
  });
});

describe("effective-command walk: ssh, chroot and timeout operands", () => {
  test("ssh skips options on either side of the host", () => {
    expect(commandsOf("ssh -p22 host rm")).toEqual([["rm"]]);
    expect(commandsOf("ssh host -t rm")).toEqual([["rm"]]);
    // `--` before the host ends option parsing, so the host is read as the command.
    expect(commandsOf("ssh -- host rm -rf /")).toEqual([
      ["host", "rm", "-rf", "/"],
    ]);
  });

  test("chroot and timeout skip options before their operand", () => {
    expect(commandsOf("chroot -- /r rm")).toEqual([["rm"]]);
    expect(commandsOf("chroot --userspec=u /r rm")).toEqual([["rm"]]);
    // chroot options never take a separate value, so `u` is read as NEWROOT.
    expect(commandsOf("chroot --userspec u /r rm")).toEqual([["/r", "rm"]]);
    expect(commandsOf("timeout -- 5 rm")).toEqual([["rm"]]);
  });

  test("redirections outside a command string are inherited ahead of its own", () => {
    const segment = defined(
      lexSegments("sh -c 'rm x > a' > b")[0],
      "first segment",
    );
    expect(analyzeEffectiveCommands(segment).redirections).toEqual([
      [
        { operator: ">", target: "b", quoted: false },
        { operator: ">", target: "a", quoted: false },
      ],
    ]);
  });
});

describe("effective-command walk: budgets", () => {
  test("a spent command budget truncates before anything is collected", () => {
    expect(spend("rm", 0, 100)).toEqual({
      commands: [],
      truncated: true,
      left: [0, 100],
    });
  });

  test("each collected command spends one unit of the command budget", () => {
    expect(spend("sh -c 'a; b'", 1, 100)).toEqual({
      commands: [["a"]],
      truncated: true,
      left: [0, 96],
    });
  });

  test.each([
    ["sh -c 'rm -rf /'", "rm -rf /"],
    ["script -c 'rm -rf /' /dev/null", "rm -rf /"],
    ["env -S 'rm -rf /' x", "rm -rf / x"],
    ["ssh h rm -rf /", "rm -rf /"],
  ])(
    "%p charges its re-lexed text before a check that fails only below zero",
    (command, text) => {
      expect(spend(command, 5, text.length)).toEqual({
        commands: [text.split(" ")],
        truncated: false,
        left: [4, 0],
      });
      expect(spend(command, 5, text.length - 1)).toEqual({
        commands: [],
        truncated: true,
        left: [5, -1],
      });
    },
  );

  test.each(["busybox ", "timeout 1 ", "chroot /r "])(
    "%p operand tails count against the depth cap",
    (wrapper) => {
      expect(spend(`${wrapper.repeat(32)}rm`, 5, 100)).toEqual({
        commands: [["rm"]],
        truncated: false,
        left: [4, 100],
      });
      expect(spend(`${wrapper.repeat(33)}rm`, 5, 100)).toEqual({
        commands: [],
        truncated: true,
        left: [5, 100],
      });
    },
  );
});
