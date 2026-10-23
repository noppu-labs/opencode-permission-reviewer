import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brakeReadingsReason } from "../src/modules/analysis/brake/brake-readings.ts";
import { emergencyBrakeReason } from "../src/modules/analysis/brake/emergency-brake.ts";
import { analyzeBashCommand } from "../src/modules/context/services/command-evidence.ts";
import type { CapabilityActionClass } from "../src/types.ts";
import { request } from "./helpers.ts";

const CTX = { directory: "/work/repo", worktree: "/work/repo" };

function analyze(command: string): ReturnType<typeof analyzeBashCommand> {
  return analyzeBashCommand(
    request({ metadata: { command }, patterns: [command] }),
    CTX,
  );
}

/** `destruction` maps a command to its plain twin; `everyday` maps a command
 *  to the action class the release before the lexer kept a substitution's
 *  text in its word gave it. One row per line in
 *  tests/fixtures/substitution-word-rows.json. */
const ROWS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/substitution-word-rows.json"),
    "utf8",
  ),
) as {
  destruction: Record<string, string>;
  everyday: Record<string, CapabilityActionClass>;
  outerRedirections: Record<string, [CapabilityActionClass, string | null]>;
  blockDevice: Record<string, boolean>;
};

describe("a substitution's text keeps the commands around it", () => {
  test.each(Object.entries(ROWS.destruction))("%s", (command, twin) => {
    const form = analyze(command).capability;
    const plain = analyze(twin).capability;
    expect(form?.actionClass.value).toBe(plain?.actionClass.value);
    expect(form?.actionClass.value).not.toBe("read-only");
  });
});

describe("everyday substitutions keep their action class", () => {
  test.each(Object.entries(ROWS.everyday))("%s", (command, action) => {
    expect(analyze(command).capability?.actionClass.value).toBe(action);
  });
});

// The outer command's redirections stay, whatever operators the substitution
// text holds, and the action class is the one the previous release gave. A
// segment that only assigns has no command to report them on (null).
describe("the outer redirections of a command with a substitution", () => {
  test.each(Object.entries(ROWS.outerRedirections))(
    "%j",
    (command, [action, redirections]) => {
      const result = analyze(command);
      expect(result.capability?.actionClass.value).toBe(action);
      if (redirections === null) return;
      expect(
        result.parsed?.redirections[0]
          ?.map((found) => `${found.operator} ${found.target}`)
          .join(" ¦ "),
      ).toBe(redirections);
    },
  );
});

// A write to a block device is found from the outer command's own operator,
// from the command a substitution runs, and not from the operators the
// substitution's text holds for the outer command.
describe("the brake on redirections around a substitution", () => {
  test.each(Object.entries(ROWS.blockDevice))("%j", (command, blocked) => {
    const reason = emergencyBrakeReason(
      request({ metadata: { command }, patterns: [command] }),
    );
    expect(reason !== undefined).toBe(blocked);
    expect(brakeReadingsReason(command, "bash") !== undefined).toBe(blocked);
  });
});
