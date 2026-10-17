import { describe, expect, test } from "bun:test";
import { brakeReadingsReason } from "../src/brake-readings.ts";
import { emergencyBrakeReason } from "../src/emergency-brake.ts";
import { request } from "./helpers.ts";

const blocked =
  "Emergency brake: command contains unmistakable broad system destruction.";

/** A body wrapped in double quotes for a command-string wrapper. */
const dq = (text: string): string =>
  `"${text.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`;

/** A body wrapped in single quotes, each embedded `'` written as `'\''`. */
const sq = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

const wrappers = (body: string): [string, string][] => [
  ["plain", body],
  ["bash -c", `bash -c ${dq(body)}`],
  ["sh -c", `sh -c ${sq(body)}`],
  ["sudo bash -c", `sudo bash -c ${dq(body)}`],
  ["find -exec sh -c", `find . -exec sh -c ${dq(body)} \\;`],
];

const commandStringWrappers = (body: string): [string, string][] => [
  ["env -S", `env -S ${sq(body)}`],
  ["watch", `watch ${sq(body)}`],
  ["ssh host", `ssh host ${sq(body)}`],
  ["su -c", `su -c ${sq(body)}`],
];

const newlyBlocked = "echo $'\\'' \"$(rm -rf /)\"";
const newlyBlockedPrintf = "printf $'a\\'b'; rm -rf /";
const previousOnly = "echo $'a\\' ; rm -rf / #'";
/** The previous-only body built from escapes, so the command text has no
 *  `$'` of its own. */
const previousOnlyEscaped =
  "bash -c echo\\ \\$\\'a\\\\\\'\\ \\;\\ rm\\ -rf\\ /\\ \\#\\'";

const allowed = [
  "printf $'a\tb\n'",
  "echo $'it\\'s'",
  "IFS=$'\\n'",
  "read -d $'\\0'",
  "git commit -m $'x\ny'",
  "echo \"$'a\\'\"",
  "echo \\$'a\\'",
  "echo $$'a\\'",
  "echo '$'\\''x'",
];

const brake = (command: string): string | undefined =>
  emergencyBrakeReason(request({ metadata: { command } }));

function expectBlocked(_: string, command: string): void {
  expect(brake(command)).toBe(blocked);
}

function expectBashAllows(_: string, command: string): void {
  expect(brakeReadingsReason(command, "bash")).toBeUndefined();
}

describe("ANSI-C strings end where the shell ends them", () => {
  test.each(
    [newlyBlocked, newlyBlockedPrintf].flatMap((body) => wrappers(body)),
  )(
    "blocks a substitution or command after an escaped quote (%s)",
    expectBlocked,
  );

  test.each(wrappers(previousOnly))(
    "blocks a command after a `$'…'` string that ends at its first `'` (%s)",
    expectBlocked,
  );

  test("blocks a `$'…'` body built from escapes, with no `$'` in the text", () => {
    expect(previousOnlyEscaped).not.toContain("$'");
    expect(brake(previousOnlyEscaped)).toBe(blocked);
  });

  test.each(allowed)(
    "allows an ordinary or look-alike ANSI-C word: %s",
    (command) => {
      expect(brake(command)).toBeUndefined();
    },
  );
});

describe("command-string wrappers of the previous-only body", () => {
  test.each(commandStringWrappers(previousOnly))(
    "blocks a command-string wrapper of a `$'…'` string that ends at its first `'` (%s)",
    expectBlocked,
  );

  test.each(commandStringWrappers(previousOnly))(
    "the bash reading allows the same command string (%s)",
    expectBashAllows,
  );
});

describe("each quote reading on its own", () => {
  test("the bash reading allows and the previous reading blocks an escape-built body", () => {
    expect(brakeReadingsReason(previousOnlyEscaped, "bash")).toBeUndefined();
    expect(brakeReadingsReason(previousOnlyEscaped, "previous")).toBe(blocked);
  });

  test.each(wrappers(previousOnly))(
    "the bash reading allows and the previous reading blocks (%s)",
    (_, command) => {
      expect(brakeReadingsReason(command, "bash")).toBeUndefined();
      expect(brakeReadingsReason(command, "previous")).toBe(blocked);
    },
  );
});

/** Every wrapper of a body, as command strings: the plain body, its
 *  command-string wrappers, and `env -S`. */
const wrappedForms = (body: string): string[] =>
  [...wrappers(body), ...commandStringWrappers(body).slice(0, 1)].map(
    ([, command]) => command,
  );

const decodedWordBodies = [
  "$'\\x72m' -rf /",
  "$'\\162m' -rf /",
  "$'\\u0072m' -rf /",
  '$"rm" -rf /',
  "r$'m' -rf /",
  "rm $'-rf' /",
  "rm -rf $'/'",
  "rm -rf $'/\\0tmp'",
];

const decodedBlockedForms = decodedWordBodies.flatMap(wrappedForms);

const decodedAllowed = [
  "printf $'a\\tb\\n'",
  "read -d $'\\0' x",
  "git commit -m $'x\\ny'",
  'echo $"Hello"',
  "echo $'it\\'s'",
  "echo $'\\x3b rm -rf /'",
  "echo $'\\x7c' x",
  "echo $'\\x2a'",
  "echo $'\\x24HOME'",
];

describe("decoded command words are judged like their plain spelling", () => {
  test.each(decodedBlockedForms)("blocks %s", (command) => {
    expect(brake(command)).toBe(blocked);
  });

  test.each(decodedAllowed)("allows %s", (command) => {
    expect(brake(command)).toBeUndefined();
  });
});

describe("the undecoded reading is its own pass", () => {
  test("the bash reading blocks a decoded command word that the undecoded reading allows", () => {
    const command = "$'\\x72m' -rf /";
    expect(brakeReadingsReason(command, "bash")).toBe(blocked);
    expect(brakeReadingsReason(command, "undecoded")).toBeUndefined();
  });
});
