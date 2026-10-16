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

describe("ANSI-C strings end where the shell ends them", () => {
  test.each(
    [newlyBlocked, newlyBlockedPrintf].flatMap((body) => wrappers(body)),
  )(
    "blocks a substitution or command after an escaped quote (%s)",
    (_, command) => {
      expect(brake(command)).toBe(blocked);
    },
  );

  test.each(wrappers(previousOnly))(
    "blocks a command after a `$'…'` string that ends at its first `'` (%s)",
    (_, command) => {
      expect(brake(command)).toBe(blocked);
    },
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
