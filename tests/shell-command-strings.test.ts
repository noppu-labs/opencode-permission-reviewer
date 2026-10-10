import { describe, expect, test } from "bun:test";
import { analyzeEffectiveCommands } from "../src/shell-effective-commands.ts";
import { lexSegments } from "../src/shell-scanner.ts";
import { defined } from "./helpers.ts";

function commandsOf(command: string): string[][] {
  const segment = defined(lexSegments(command)[0], "first segment");
  const analysis = analyzeEffectiveCommands(segment);
  expect(analysis.truncated).toBe(false);
  expect(analysis.redirections).toHaveLength(analysis.commands.length);
  return analysis.commands.map((tokens) => tokens.map((t) => t.value));
}

describe("effective-command walk: env split string", () => {
  test("long split-string forms and long value options", () => {
    expect(commandsOf("env --split-string 'rm -rf /' x")).toEqual([
      ["rm", "-rf", "/", "x"],
    ]);
    expect(commandsOf("env --split-string")).toEqual([]);
    expect(commandsOf("env --chdir /tmp --split-string='rm -rf /'")).toEqual([
      ["rm", "-rf", "/"],
    ]);
    expect(commandsOf("env --unset=FOO -S 'rm -rf /'")).toEqual([
      ["rm", "-rf", "/"],
    ]);
  });

  test("short clusters take values from the rest of the cluster or the next token", () => {
    expect(commandsOf("env -S'rm -rf /' x")).toEqual([["rm", "-rf", "/", "x"]]);
    for (const options of ["-uFOO", "-u FOO", "-C /tmp", "-P /bin", "-i"])
      expect(commandsOf(`env ${options} -S 'rm -rf /'`)).toEqual([
        ["rm", "-rf", "/"],
      ]);
    expect(commandsOf("env -S")).toEqual([]);
    expect(commandsOf("env -iu")).toEqual([]);
    expect(commandsOf("env -iuS x")).toEqual([["x"]]);
    expect(commandsOf("env -PS x")).toEqual([]);
    expect(commandsOf("env -SP x")).toEqual([["P", "x"]]);
  });

  test("without a usable split string env is peeled as a plain wrapper", () => {
    expect(commandsOf("env -S '' rm -rf /")).toEqual([["rm", "-rf", "/"]]);
    expect(commandsOf("env -- rm -rf /")).toEqual([["rm", "-rf", "/"]]);
    expect(commandsOf("env FOO=bar rm")).toEqual([["rm"]]);
    // A lone `-` ends the -S search and is then taken as the executable.
    expect(commandsOf("env - rm")).toEqual([["-", "rm"]]);
  });
});

describe("effective-command walk: -c command strings", () => {
  test("su and script read a getopt value; without one the wrapper is the command", () => {
    expect(commandsOf("su -lc 'rm -rf /'")).toEqual([["rm", "-rf", "/"]]);
    expect(commandsOf("su -cfoo")).toEqual([["foo"]]);
    expect(commandsOf("su -c 'rm -rf /' --")).toEqual([["rm", "-rf", "/"]]);
    expect(commandsOf("su -c")).toEqual([["su", "-c"]]);
    expect(commandsOf("su --command")).toEqual([["su", "--command"]]);
    expect(commandsOf("su -lc")).toEqual([["su", "-lc"]]);
    expect(commandsOf("su -x")).toEqual([["su", "-x"]]);
    expect(commandsOf("su root")).toEqual([["su", "root"]]);
    expect(commandsOf("su -- root")).toEqual([["su", "--", "root"]]);
    expect(commandsOf("su -- -c rm")).toEqual([["su", "--", "-c", "rm"]]);
    expect(commandsOf("script -q -c 'rm -rf /' log")).toEqual([
      ["rm", "-rf", "/"],
    ]);
    expect(commandsOf("script -c")).toEqual([["script", "-c"]]);
    expect(commandsOf("script --command")).toEqual([["script", "--command"]]);
    expect(commandsOf("script -qc")).toEqual([["script", "-qc"]]);
    expect(commandsOf("fish -c -x 'rm'")).toEqual([["-x"]]);
  });

  test("shells take the first operand after the -c cluster and its options", () => {
    expect(commandsOf("bash -c -o errexit 'rm -rf /'")).toEqual([
      ["rm", "-rf", "/"],
    ]);
    expect(commandsOf("bash -c -O extglob -- 'rm -rf /'")).toEqual([
      ["rm", "-rf", "/"],
    ]);
    expect(commandsOf("bash -c +x 'rm -rf /'")).toEqual([["rm", "-rf", "/"]]);
    expect(commandsOf("bash -c --command='rm -rf /'")).toEqual([
      ["rm", "-rf", "/"],
    ]);
    expect(commandsOf("bash --command 'rm -rf /'")).toEqual([
      ["rm", "-rf", "/"],
    ]);
    expect(commandsOf("bash -cfoo bar")).toEqual([["bar"]]);
    // An operand before -c does not stop the search.
    expect(commandsOf("bash script.sh -c 'rm -rf /'")).toEqual([
      ["rm", "-rf", "/"],
    ]);
  });

  test("a shell with no script operand is the command itself", () => {
    expect(commandsOf("bash -c --")).toEqual([["bash", "-c", "--"]]);
    expect(commandsOf("bash -c -o")).toEqual([["bash", "-c", "-o"]]);
    expect(commandsOf("bash -x -c")).toEqual([["bash", "-x", "-c"]]);
    expect(commandsOf("bash -- -c 'rm'")).toEqual([["bash", "--", "-c", "rm"]]);
    expect(commandsOf("sh -x")).toEqual([["sh", "-x"]]);
  });
});
