import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  parseVerifiedSshScriptCommand,
  renderVerifiedSshScriptCommand,
  type VerifiedScriptCommand,
} from "../src/verified-ssh-script.ts";
import { request } from "./helpers.ts";

const HASH = createHash("sha256").update("echo safe\n").digest("hex");

function parse(
  command: string,
  permission = "bash",
): VerifiedScriptCommand | undefined {
  return parseVerifiedSshScriptCommand(
    request({ permission, metadata: { command } }),
  );
}

function rendered(overrides: Partial<VerifiedScriptCommand> = {}): string {
  return renderVerifiedSshScriptCommand({
    path: "/tmp/opencode/deploy.sh",
    destination: "deploy@example.invalid",
    sha256: HASH,
    shell: "sh",
    ...overrides,
  });
}

describe("verified ssh script command parsing", () => {
  test.each([1, 65535])("port %p is accepted", (port) => {
    expect(parse(rendered({ port }))).toStrictEqual({
      path: "/tmp/opencode/deploy.sh",
      destination: "deploy@example.invalid",
      port,
      sha256: HASH,
      shell: "sh",
    });
  });

  test("surrounding whitespace is trimmed before matching", () => {
    expect(parse(`  ${rendered()}\n`)).toStrictEqual({
      path: "/tmp/opencode/deploy.sh",
      destination: "deploy@example.invalid",
      sha256: HASH,
      shell: "sh",
    });
  });

  test.each([
    ["a destination starting with a dash", rendered({ destination: "-host" })],
    ["port 0", rendered({ port: 0 })],
    ["port 65536", rendered({ port: 65536 })],
    ["port 99999", rendered({ port: 99999 })],
    ["a zero-padded port", rendered({ port: 22 }).replace("-p 22", "-p 022")],
    ["a remote without a digest", rendered({ sha256: "abc" })],
  ])("%s is rejected", (_label, command) => {
    expect(parse(command)).toBeUndefined();
  });

  test("a non-bash request is rejected", () => {
    expect(parse(rendered(), "edit")).toBeUndefined();
  });
});
