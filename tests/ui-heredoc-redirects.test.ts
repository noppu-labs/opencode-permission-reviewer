import { describe, expect, test } from "bun:test";
import { extractHeredocs } from "../src/capability/heredoc-extractor.ts";
import {
  type HeredocRedirect,
  heredocRedirects,
} from "../src/ui-heredoc-redirects.ts";
import { TUI_SHIP_FILES } from "./package-tui-files.ts";

const redirects = (command: string): HeredocRedirect[] | undefined =>
  heredocRedirects(command, extractHeredocs(command));

describe("heredoc redirects", () => {
  test("map each operator word back to how it was typed", () => {
    const command = "cat <<'A' << \"B\" | wc\na\nA\nb1\nb2\nB\nls";
    const sanitized = extractHeredocs(command).sanitizedCommand;
    const found = redirects(command);
    expect(found?.map((redirect) => [redirect.typed, redirect.lines])).toEqual([
      ["<<'A'", 1],
      ['<< "B"', 2],
    ]);
    expect(
      found?.map((redirect) => sanitized.slice(redirect.start, redirect.end)),
    ).toEqual(["<<A", "<<B"]);
    expect(
      found?.map((redirect) =>
        sanitized.slice(redirect.end, redirect.next).trim(),
      ),
    ).toEqual([
      expect.stringMatching(/^<HEREDOC:sha256:[0-9a-f]{12}>$/),
      expect.stringMatching(/^<HEREDOC:sha256:[0-9a-f]{12}>$/),
    ]);
  });

  test.each([
    ["no heredoc", "ls | wc", []],
    ["a tab-stripped body", "cat <<-EOF\n\tx\n\tEOF", [["<<-EOF", 1]]],
    ["an escaped delimiter", "cat <<\\EOF\nx\nEOF", [["<<\\EOF", 1]]],
    [
      "a heredoc inside a command substitution",
      "x=$(cat <<EOF\nx\nEOF\n)",
      [["<<EOF", 1]],
    ],
    [
      "heredocs on two lines",
      "cat <<A\na\nA\ncat <<B\nb\nB",
      [
        ["<<A", 1],
        ["<<B", 1],
      ],
    ],
  ])("read %s", (_name, command, expected) => {
    expect(
      redirects(command)?.map((redirect) => [redirect.typed, redirect.lines]),
    ).toEqual(expected);
  });

  test.each([
    ["a body that never ends", "cat <<EOF\nx"],
    [
      "a body whose line count cannot be verified",
      "echo '<HEREDOC:sha256:0123456789ab>'",
    ],
  ])("are undefined for %s", (_name, command) => {
    expect(redirects(command)).toBeUndefined();
  });

  test("stay out of the TUI", () => {
    expect(
      TUI_SHIP_FILES.filter((file) => file.includes("ui-heredoc-")),
    ).toEqual([]);
  });
});
