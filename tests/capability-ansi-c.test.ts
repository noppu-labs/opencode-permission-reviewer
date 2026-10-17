import { describe, expect, test } from "bun:test";
import { analyzeBashCommand } from "../src/context/command-evidence.ts";
import type { CapabilityActionClass } from "../src/types.ts";
import { request } from "./helpers.ts";

const CTX = { directory: "/work/repo", worktree: "/work/repo" };

function analyze(command: string): ReturnType<typeof analyzeBashCommand> {
  return analyzeBashCommand(
    request({ metadata: { command }, patterns: [command] }),
    CTX,
  );
}

// A word written with escapes, and the same command written plainly.
const PLAIN_TWINS: Record<string, string> = {
  "$'\\x72m' -rf /": "rm -rf /",
  "$'\\162m' -rf /": "rm -rf /",
  "$'\\u0072m' -rf /": "rm -rf /",
  '$"rm" -rf /': "rm -rf /",
  "r$'m' -rf /": "rm -rf /",
  "rm $'-rf' /": "rm -rf /",
  "rm -rf $'/'": "rm -rf /",
  "rm -rf $'/\\0tmp'": "rm -rf /",
  "rm -rf $'/tmp/x'": "rm -rf /tmp/x",
  "bash -c \"\\$'\\\\x72m' -rf /\"": 'bash -c "rm -rf /"',
  "sh -c $'rm -rf /'": "sh -c 'rm -rf /'",
};

// Everyday uses, with the action class the previous reading gave them.
const EVERYDAY_ACTIONS: Record<string, CapabilityActionClass> = {
  "IFS=$'\\n'": "unknown",
  "printf $'a\\tb\\n'": "read-only",
  "read -d $'\\0' x": "read-only",
  "git commit -m $'x\\ny'": "git-mutation",
  'echo $"Hello"': "read-only",
  "echo $'it\\'s'": "read-only",
  "echo $'\\x3b rm -rf /'": "read-only",
  "echo $'\\x7c' x": "read-only",
  "echo $'\\x2a'": "read-only",
  "echo $'\\x24HOME'": "read-only",
  'echo $"$HOME"': "read-only",
};

describe("escaped words are judged like their plain spelling", () => {
  test.each(Object.entries(PLAIN_TWINS))("%s", (command, twin) => {
    const escaped = analyze(command).capability;
    const plain = analyze(twin).capability;
    expect(escaped?.actionClass.value).toBe(plain?.actionClass.value);
    expect(escaped?.writeEffects).toEqual(plain?.writeEffects);
  });
});

describe("everyday escaped words keep their action class", () => {
  test.each(Object.entries(EVERYDAY_ACTIONS))("%s", (command, action) => {
    expect(analyze(command).capability?.actionClass.value).toBe(action);
  });
});

describe("dollar-quoted words and dynamic constructs", () => {
  test.each([
    ['echo $"$HOME"', true],
    ['echo $"Hello"', false],
    ["echo $'\\x24HOME'", false],
    ["echo $'\\x2a'", false],
    ["echo $'\\x3b' ls", false],
    ["echo $$'x'", true],
    ["echo $'a'$HOME", true],
    ["echo $'a'*", true],
    ["echo '$HOME' $'*'", false],
  ] as const)("%s is dynamic: %s", (command, dynamic) => {
    expect(analyze(command).parsed?.hasDynamicConstructs).toBe(dynamic);
  });

  test("a decoded `;` starts no second command", () => {
    expect(analyze("echo $'\\x3b rm -rf /'").parsed?.segments).toHaveLength(1);
  });
});

// A redirection whose target is an empty word ends at the pipe or the
// background operator, so the command after it is still read.
describe("a command after an empty redirection target is still read", () => {
  test.each([
    "echo hi >$''|rm -rf /",
    "echo hi <$''&rm -rf /",
    'echo hi >$""|rm -rf /',
    "echo hi >$'\\0'|rm -rf /",
    "echo hi >''|rm -rf /",
    "echo hi <''&rm -rf /",
    'echo hi >""|rm -rf /',
    "echo hi >''|&rm -rf /",
  ])("%s", (command) => {
    const result = analyze(command);
    expect(result.parsed?.segments).toHaveLength(2);
    expect(result.capability?.actionClass.value).toBe("destruction");
  });
});

// A here-string with an empty word is valid, and the next word is the command
// (or an argument of the command before it).
const AFTER_EMPTY_HERE_STRING: Record<string, CapabilityActionClass> = {
  "<<<$'' rm -rf /": "destruction",
  '<<<$"" rm -rf /': "destruction",
  "<<<$'\\0' rm -rf /": "destruction",
  "<<<'' rm -rf /": "destruction",
  '<<<"" rm -rf /': "destruction",
  "echo hi <<<$'' rm -rf /": "read-only",
  "echo hi <<<'' rm -rf /": "read-only",
};

describe("the word after an empty here-string word keeps its role", () => {
  test.each(Object.entries(AFTER_EMPTY_HERE_STRING))(
    "%s",
    (command, action) => {
      expect(analyze(command).capability?.actionClass.value).toBe(action);
    },
  );
});
