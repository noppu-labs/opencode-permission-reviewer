import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
};

describe("a substitution's text does not hide the commands around it", () => {
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
