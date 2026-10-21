import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_BODY_COMMANDS } from "../src/brake-body-commands.ts";
import { ANALYSIS_LIMIT_REASON } from "../src/brake-readings.ts";
import { MAX_BODY_DEPTH } from "../src/capability/heredoc-body-commands.ts";
import { emergencyBrakeReason } from "../src/emergency-brake.ts";
import { request } from "./helpers.ts";

const blocked =
  "Emergency brake: command contains unmistakable broad system destruction.";
const secret =
  "Emergency brake: command appears to export credential material through a network utility.";

/** One row per line in tests/fixtures/brake-heredoc-body-rows.json. */
const ROWS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/brake-heredoc-body-rows.json"),
    "utf8",
  ),
) as { block: string[]; secret: string[]; allow: string[]; limit: string[] };

const brake = (command: string): string | undefined =>
  emergencyBrakeReason(request({ metadata: { command } }));

/** A heredoc whose body runs a substitution, which holds a heredoc whose body
 *  runs one more, `levels` times; the innermost body runs `rm -rf /`. */
function nested(levels: number): string {
  let body = "$(rm -rf /)";
  for (let level = levels; level >= 1; level -= 1)
    body = `$(cat <<K${level}\n${body}\nK${level}\n)`;
  return `cat <<EOF\n${body}\nEOF`;
}

/** A heredoc whose body runs `count` distinct commands. */
function distinct(count: number): string {
  const body = Array.from({ length: count }, (_, i) => `$(a${i})`).join(" ");
  return `cat <<EOF\n${body}\nEOF`;
}

describe("the brake judges the commands a heredoc body's substitutions run", () => {
  test.each(ROWS.block)("blocks the destruction in %j", (command) => {
    expect(brake(command)).toBe(blocked);
  });

  test.each(ROWS.secret)("blocks the credential export in %j", (command) => {
    expect(brake(command)).toBe(secret);
  });

  test.each(ROWS.allow)("allows %j", (command) => {
    expect(brake(command)).toBeUndefined();
  });

  test.each(ROWS.limit)("reports the analysis limit for %j", (command) => {
    expect(brake(command)).toBe(ANALYSIS_LIMIT_REASON);
  });

  test("judges a body command at the deepest level the scan follows", () => {
    expect(brake(nested(MAX_BODY_DEPTH - 1))).toBe(blocked);
  });

  test("reports the analysis limit past the deepest level", () => {
    expect(brake(nested(MAX_BODY_DEPTH))).toBe(ANALYSIS_LIMIT_REASON);
  });

  test("judges as many distinct body commands as the body-command cap", () => {
    expect(brake(distinct(MAX_BODY_COMMANDS))).toBeUndefined();
  });

  test("reports the analysis limit for one body command more", () => {
    expect(brake(distinct(MAX_BODY_COMMANDS + 1))).toBe(ANALYSIS_LIMIT_REASON);
  });
});
