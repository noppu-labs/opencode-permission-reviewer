import { describe, expect, test } from "bun:test";
import { emergencyBrakeReason } from "../src/emergency-brake.ts";
import { request } from "./helpers.ts";

const blocked =
  "Emergency brake: command contains unmistakable broad system destruction.";

const blocks = (title: string, commands: string[]): void =>
  test.each(commands)(title, (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });

describe("hardening batch 32", () => {
  // Each demonstrator run through a command-string wrapper: the wrapper runs
  // the text, so the nested analysis must read it as the top level does.
  blocks(
    "a nested command string keeps the heredoc readings of the top level",
    [
      "bash -c 'echo \"$(<<EOF\rx rm -rf /)\"'",
      "bash -c 'echo \"`<<EOF\rx rm -rf /`\"'",
      "bash -c 'echo \"`$((<<-EOF)}${#|)|\nrm -rf /`\"'",
      'sh -c "echo \\"\\$(<<EOF\rx rm -rf /)\\""',
      'sh -c "echo \\"\\`<<EOF\rx rm -rf /\\`\\""',
      'sh -c "echo \\"\\`\\$((<<-EOF)}\\${#|)|\nrm -rf /\\`\\""',
      "sudo bash -c 'echo \"$(<<EOF\rx rm -rf /)\"'",
      "sudo bash -c 'echo \"`<<EOF\rx rm -rf /`\"'",
      "sudo bash -c 'echo \"`$((<<-EOF)}${#|)|\nrm -rf /`\"'",
      "env X=1 bash -c 'echo \"$(<<EOF\rx rm -rf /)\"'",
      "env X=1 bash -c 'echo \"`<<EOF\rx rm -rf /`\"'",
      "env X=1 bash -c 'echo \"`$((<<-EOF)}${#|)|\nrm -rf /`\"'",
      "watch 'echo \"$(<<EOF\rx rm -rf /)\"'",
      "watch 'echo \"`<<EOF\rx rm -rf /`\"'",
      "watch 'echo \"`$((<<-EOF)}${#|)|\nrm -rf /`\"'",
      "ssh host 'echo \"$(<<EOF\rx rm -rf /)\"'",
      "ssh host 'echo \"`<<EOF\rx rm -rf /`\"'",
      "ssh host 'echo \"`$((<<-EOF)}${#|)|\nrm -rf /`\"'",
      "find . -exec sh -c 'echo \"$(<<EOF\rx rm -rf /)\"' \\;",
      "find . -exec sh -c 'echo \"`<<EOF\rx rm -rf /`\"' \\;",
      "find . -exec sh -c 'echo \"`$((<<-EOF)}${#|)|\nrm -rf /`\"' \\;",
    ],
  );
  // A heredoc operator before the command word: the placeholder is not the
  // command word, so the command after the operator is judged.
  blocks("a heredoc before the command does not hide the command", [
    "<<EOF rm -rf /\nEOF",
    "<<'a b' rm -rf /\na b",
    "<<EOF >/dev/null rm -rf /\nEOF",
  ]);
});
