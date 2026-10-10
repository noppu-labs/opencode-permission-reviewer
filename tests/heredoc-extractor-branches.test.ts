import { describe, expect, test } from "bun:test";
import type { HeredocRecord } from "../src/capability/capability-types.ts";
import { extractHeredocs } from "../src/capability/heredoc-extractor.ts";

// Characterisation of extractHeredocs branches no other test reaches: the
// scanner's quoting, comment and arithmetic states, every delimiter-word form
// and the ANSI-C escapes. Each row pins the current output, odd ones included.

/** The extraction with each placeholder hash masked as `#`. Each masked hash
 *  is first checked against its record's body digest, in order. */
type ExtractedRecord = Omit<HeredocRecord, "bodySha256">;

function extraction(command: string): {
  sanitized: string;
  heredocs: ExtractedRecord[];
  dynamic: boolean;
} {
  const { sanitizedCommand, heredocs, hasDynamicConstructs } =
    extractHeredocs(command);
  const hashes = [...sanitizedCommand.matchAll(/<HEREDOC:sha256:(\w+)>/g)].map(
    (match) => match[1],
  );
  expect(hashes).toEqual(heredocs.map((h) => h.bodySha256.slice(0, 12)));
  return {
    sanitized: sanitizedCommand.replace(/<HEREDOC:sha256:\w+>/g, "<#>"),
    heredocs: heredocs.map(({ bodySha256: _, ...rest }) => rest),
    dynamic: hasDynamicConstructs,
  };
}

const bare = (delimiter: string, bodyBounded: string): ExtractedRecord => ({
  delimiter,
  operator: "<<",
  expansionDisabled: false,
  bodyBounded,
  truncated: false,
  dynamic: false,
});
const quoted = (delimiter: string): ExtractedRecord => ({
  ...bare(delimiter, "body\n"),
  expansionDisabled: true,
});
const unresolved = (
  expansionDisabled: boolean,
  bodyBounded: string,
): ExtractedRecord => ({
  delimiter: "",
  operator: "<<",
  expansionDisabled,
  bodyBounded,
  truncated: true,
  dynamic: true,
});

describe("extractHeredocs scanner states", () => {
  test.each([
    ["cat << EOF\nx\nEOF\nls", "cat <<EOF <#>\nls", [bare("EOF", "x\n")]],
    ["cat <<\tEOF\nx\nEOF\nls", "cat <<EOF <#>\nls", [bare("EOF", "x\n")]],
    ["cat <<-<x\nls", "cat <<-<x\nls", []],
    ["true && (( n << 2 ))\nls", "true && (( n << 2 ))\nls", []],
    // `((` glued to a word is not arithmetic, so `<<` opens a heredoc.
    ["f((x<<EOF\nbody\nEOF\nls", "f((x<<EOF <#>\nls", [bare("EOF", "body\n")]],
    ["echo $(( (1+2) << 3 ))\nls", "echo $(( (1+2) << 3 ))\nls", []],
    ["ls # <<EOF\nls", "ls # <<EOF\nls", []],
    [
      "echo a#b <<EOF\nx\nEOF\nls",
      "echo a#b <<EOF <#>\nls",
      [bare("EOF", "x\n")],
    ],
    ["echo \\", "echo \\", []],
    [
      "cat > /tmp/a <<EOF > /tmp/b\nx\nEOF",
      "cat > /tmp/a <<EOF <#> > /tmp/b\n",
      [{ ...bare("EOF", "x\n"), outputTarget: "/tmp/a" }],
    ],
  ])("%p", (command, sanitized, heredocs) => {
    expect(extraction(command)).toEqual({
      sanitized,
      heredocs,
      dynamic: false,
    });
  });
});

describe("extractHeredocs delimiter words", () => {
  test.each([
    ["cat <<\"it's\"\nbody\nit's\nls", "cat <<'it'\\''s' <#>\nls", "it's"],
    // biome-ignore lint/security/noSecrets: an escaped heredoc delimiter word, not a credential
    ["cat <<$'A\\x4G'\nbody\nA\x04G\nls", "cat <<'A\x04G' <#>\nls", "A\x04G"],
    // biome-ignore lint/security/noSecrets: an escaped heredoc delimiter word, not a credential
    ["cat <<$'\\x41'\nbody\nA\nls", "cat <<A <#>\nls", "A"],
    ["cat <<$'\\xZ'\nbody\nxZ\nls", "cat <<xZ <#>\nls", "xZ"],
    ["cat <<$'\\101'\nbody\nA\nls", "cat <<A <#>\nls", "A"],
    // biome-ignore lint/security/noSecrets: an escaped heredoc delimiter word, not a credential
    ["cat <<$'\\18'\nbody\n\x018\nls", "cat <<'\x018' <#>\nls", "\x018"],
    ["cat <<$'\\60'\nbody\n0\nls", "cat <<0 <#>\nls", "0"],
    ["cat <<$'\\0101'\nbody\n\b1\nls", "cat <<'\b1' <#>\nls", "\b1"],
    ["cat <<$'E\\'F'\nbody\nE'F\nls", "cat <<'E'\\''F' <#>\nls", "E'F"],
    ["cat <<$'E\\\\F'\nbody\nE\\F\nls", "cat <<'E\\F' <#>\nls", "E\\F"],
    ["cat <<$'a\\tb'\nbody\na\tb\nls", "cat <<'a\tb' <#>\nls", "a\tb"],
    ["cat <<$'\\q'\nbody\nq\nls", "cat <<q <#>\nls", "q"],
    ['cat <<"E\\$F"\nbody\nE$F\nls', "cat <<'E$F' <#>\nls", "E$F"],
    ['cat <<"E\\"F"\nbody\nE"F\nls', "cat <<'E\"F' <#>\nls", 'E"F'],
    // biome-ignore lint/security/noSecrets: an escaped heredoc delimiter word, not a credential
    ['cat <<"E\\nF"\nbody\nE\\nF\nls', "cat <<'E\\nF' <#>\nls", "E\\nF"],
  ])("%p", (command, sanitized, delimiter) => {
    expect(extraction(command)).toEqual({
      sanitized,
      heredocs: [quoted(delimiter)],
      dynamic: false,
    });
  });

  test("a delimiter with a newline never matches: the rest is the body", () => {
    expect(extraction("cat <<$'a\\nb'\nbody\na\nb\nls")).toEqual({
      sanitized: "cat <<'a\nb' <#>\n",
      heredocs: [
        { ...quoted("a\nb"), bodyBounded: "body\na\nb\nls\n", truncated: true },
      ],
      dynamic: false,
    });
  });

  test.each([
    ["cat <<EOF", "cat <<EOF <#>"],
    ["cat <<EOF\\", "cat <<EOF <#>\\"],
  ])("%p ends at the end of input, unterminated", (command, sanitized) => {
    expect(extraction(command)).toEqual({
      sanitized,
      heredocs: [{ ...bare("EOF", ""), truncated: true }],
      dynamic: false,
    });
  });

  // An unterminated `$'` or `"` word keeps its text, and everything after it,
  // in the sanitized command, with an empty body.
  test.each([
    ["cat <<", "cat <<'<unresolved>' <#>", false, ""],
    ["cat <<\nx", "cat <<'<unresolved>' <#>\n", false, "x"],
    ["cat <<;ls\nx", "cat <<'<unresolved>' <#>;ls\n", false, "x"],
    ["cat <<$'abc\\", "cat <<'<unresolved>' <#>$'abc\\", true, ""],
    ["cat <<$'abc\nbody", "cat <<'<unresolved>' <#>$'abc\nbody", true, ""],
    ['cat <<"EOF\nbody', "cat <<'<unresolved>' <#>\"EOF\nbody", false, ""],
    ['cat <<"EOF\\', "cat <<'<unresolved>' <#>\"EOF\\", false, ""],
  ])("%p is unresolved", (command, sanitized, expansionDisabled, body) => {
    expect(extraction(command)).toEqual({
      sanitized,
      heredocs: [unresolved(expansionDisabled, body)],
      dynamic: true,
    });
  });
});

test("three heredocs opened on one line close in operator order", () => {
  expect(extraction("cat <<A <<B <<C\na\nA\nb\nB\nc\nC\nls")).toEqual({
    sanitized: "cat <<A <#> <<B <#> <<C <#>\nls",
    heredocs: [bare("A", "a\n"), bare("B", "b\n"), bare("C", "c\n")],
    dynamic: false,
  });
});

describe("extractHeredocs body bound", () => {
  test("a terminated body over the byte cap is cut and marked truncated", () => {
    const { heredocs } = extraction(
      `cat <<EOF > out\n${"a".repeat(5000)}\nEOF\nls`,
    );
    expect(heredocs).toEqual([
      {
        ...bare("EOF", `${"a".repeat(4096)}\n…[truncated]`),
        truncated: true,
        outputTarget: "out",
      },
    ]);
  });

  test("multibyte characters count by their UTF-8 length", () => {
    const { heredocs } = extraction(`cat <<EOF\n${"é".repeat(3000)}\nEOF`);
    expect(heredocs).toEqual([
      {
        ...bare("EOF", `${"é".repeat(2048)}\n…[truncated]`),
        truncated: true,
      },
    ]);
  });
});
