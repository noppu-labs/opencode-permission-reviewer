import { describe, expect, test } from "bun:test";
import type { HeredocRecord } from "../src/capability/capability-types.ts";
import {
  extractHeredocs,
  type HeredocOptions,
} from "../src/capability/heredoc-extractor.ts";

// Characterisation of extractHeredocs branches: the scanner's quoting, comment
// and arithmetic states, every delimiter-word form and the ANSI-C escapes. Each
// row asserts the current output.

/** The extraction with each placeholder hash masked as `#`. Each masked hash
 *  is first checked against its record's body digest, in order. */
type ExtractedRecord = Omit<HeredocRecord, "bodySha256">;

function extraction(
  command: string,
  options?: HeredocOptions,
): {
  sanitized: string;
  heredocs: ExtractedRecord[];
  dynamic: boolean;
} {
  const { sanitizedCommand, heredocs, hasDynamicConstructs } = extractHeredocs(
    command,
    options,
  );
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
    ["cat <<$'A\\x4G'\nbody\nA\x04G\nls", "cat <<'A\x04G' <#>\nls", "A\x04G"],
    ["cat <<$'\\x41'\nbody\nA\nls", "cat <<A <#>\nls", "A"],
    ["cat <<$'\\xZ'\nbody\nxZ\nls", "cat <<xZ <#>\nls", "xZ"],
    ["cat <<$'\\101'\nbody\nA\nls", "cat <<A <#>\nls", "A"],
    ["cat <<$'\\18'\nbody\n\x018\nls", "cat <<'\x018' <#>\nls", "\x018"],
    ["cat <<$'\\60'\nbody\n0\nls", "cat <<0 <#>\nls", "0"],
    ["cat <<$'\\0101'\nbody\n\b1\nls", "cat <<'\b1' <#>\nls", "\b1"],
    ["cat <<$'E\\'F'\nbody\nE'F\nls", "cat <<'E'\\''F' <#>\nls", "E'F"],
    ["cat <<$'E\\\\F'\nbody\nE\\F\nls", "cat <<'E\\F' <#>\nls", "E\\F"],
    ["cat <<$'a\\tb'\nbody\na\tb\nls", "cat <<'a\tb' <#>\nls", "a\tb"],
    ["cat <<$'\\q'\nbody\nq\nls", "cat <<q <#>\nls", "q"],
    ['cat <<"E\\$F"\nbody\nE$F\nls', "cat <<'E$F' <#>\nls", "E$F"],
    ['cat <<"E\\"F"\nbody\nE"F\nls', "cat <<'E\"F' <#>\nls", 'E"F'],
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

// A carriage return is a word character in the delimiter word: a CRLF script
// line leaves the CR in the word, and the terminator line carries the same
// CR, so the exact line comparison still closes the body.
describe("extractHeredocs carriage returns in the delimiter word", () => {
  test.each([
    [
      "cat <<EOF\r\nBODY\r\nEOF\r\necho AFTER\r\n",
      "cat <<'EOF\r' <#>\necho AFTER\r\n",
      [bare("EOF\r", "BODY\r\n")],
    ],
    [
      "cat <<E\rOF\nBODY\nE\rOF\nls",
      "cat <<'E\rOF' <#>\nls",
      [bare("E\rOF", "BODY\n")],
    ],
    [
      "cat <<'EOF'\r\nBODY\r\nEOF\r\necho AFTER\r\n",
      "cat <<'EOF\r' <#>\necho AFTER\r\n",
      [{ ...quoted("EOF\r"), bodyBounded: "BODY\r\n" }],
    ],
    [
      "cat <<-EOF\r\n\tBODY\r\nEOF\r\nls",
      "cat <<-'EOF\r' <#>\nls",
      [{ ...bare("EOF\r", "\tBODY\r\n"), operator: "<<-" }],
    ],
  ])("%p", (command, sanitized, heredocs) => {
    expect(extraction(command)).toEqual({
      sanitized,
      heredocs,
      dynamic: false,
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

// Constructs where the shell reads `<<` as literal text, or reads the
// substitution's end before any body line: bash reads no heredoc body for
// them, so nothing collapses and the following lines stay in the command as
// ordinary text.
describe("extractHeredocs shell constructs around the operator", () => {
  test.each([
    [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell parameter expansion in the command under test, not a template
      "x=hello; echo ${x#<<A}\nprintf run\nA}",
      "reads no heredoc inside a parameter expansion pattern",
    ],
    [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell parameter expansion in the command under test, not a template
      "echo ${x:-<<EOF}\nprintf run\nEOF}",
      "reads no heredoc inside a parameter expansion default",
    ],
    [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell parameter expansion in the command under test, not a template
      "echo ${x/<<EOF/b}\nprintf run\nEOF}",
      "reads no heredoc inside a parameter expansion replacement",
    ],
    ["echo $[1<<2]\nprintf run", "reads no heredoc inside legacy arithmetic"],
    [
      "echo $(cat <<EOF)\nprintf run",
      "reads no heredoc when the substitution closes on the operator's line",
    ],
    [
      "echo `cat <<EOF`\nprintf run",
      "reads no heredoc inside backticks that close on the operator's line",
    ],
    [
      "echo $( (cat <<EOF) )\nprintf run\nEOF",
      "reads no heredoc when the substitution closes around a group on the operator's line",
    ],
  ])("%p: %s", (command) => {
    expect(extraction(command)).toEqual({
      sanitized: command,
      heredocs: [],
      dynamic: false,
    });
  });

  // A substitution still open across the newline does read its body from
  // the following lines, up to the terminator; the close follows the
  // placeholder.
  test("reads a heredoc inside a substitution open across the newline", () => {
    expect(extraction("x=$(cat <<EOF\nbody\nEOF\n)\nls")).toEqual({
      sanitized: "x=$(cat <<EOF <#>\n)\nls",
      heredocs: [bare("EOF", "body\n")],
      dynamic: false,
    });
  });

  test("reads a heredoc body inside a group that stays open", () => {
    expect(extraction("(cat <<EOF)\nprintf run\nEOF\nls")).toEqual({
      sanitized: "(cat <<EOF <#>)\nls",
      heredocs: [bare("EOF", "printf run\n")],
      dynamic: false,
    });
  });
});

// The shell ends a `$'…'` string at the first unescaped `'`, so a `<<` inside
// it is text, while a `<<` after the string opens a heredoc.
describe("extractHeredocs quoted strings", () => {
  test("a `<<` inside an ANSI-C string with an escaped quote is text", () => {
    const command = "echo $'a\\' <<EOF'\nprintf run\nEOF";
    expect(extraction(command)).toEqual({
      sanitized: command,
      heredocs: [],
      dynamic: false,
    });
  });

  test("a `<<` after an ANSI-C string with an escaped quote opens a heredoc", () => {
    expect(extraction("echo $'\\'' <<EOF\nbody\nEOF\nls")).toEqual({
      sanitized: "echo $'\\'' <<EOF <#>\nls",
      heredocs: [bare("EOF", "body\n")],
      dynamic: false,
    });
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

// The shell reads a body after an operator inside an open substitution or
// backtick. An operator whose substitution closes on its own line has no body
// there, and the close is read before any body line.
describe("extractHeredocs reads a body where the shell reads one", () => {
  test.each([
    ["x=`cat <<EOF\nit's\nEOF\n`\nrm -rf /", "x=`cat <<EOF <#>\n`\nrm -rf /"],
    [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell parameter expansion in the command under test, not a template
      "echo ${x:-$(cat <<EOF\nit's\nEOF\n)}\nrm -rf /",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell parameter expansion in the command under test, not a template
      "echo ${x:-$(cat <<EOF <#>\n)}\nrm -rf /",
    ],
    [
      "echo $(( $(cat <<EOF\nit's\nEOF\n) ))\nrm -rf /",
      "echo $(( $(cat <<EOF <#>\n) ))\nrm -rf /",
    ],
    [
      "((echo a) )\ncat <<EOF\nit's\nEOF\nrm -rf /",
      "((echo a) )\ncat <<EOF <#>\nrm -rf /",
    ],
    [
      "x=$((echo a) )\ncat <<EOF\nit's\nEOF\nrm -rf /",
      "x=$((echo a) )\ncat <<EOF <#>\nrm -rf /",
    ],
  ])("%p reads its body and keeps the next line", (command, sanitized) => {
    expect(extraction(command)).toEqual({
      sanitized,
      heredocs: [bare("EOF", "it's\n")],
      dynamic: false,
    });
  });

  test("a heredoc in a substitution closed on its own line has no body", () => {
    const command = "echo $(cat <<EOF)\nit's\nEOF\nrm -rf /";
    expect(extraction(command)).toEqual({
      sanitized: command,
      heredocs: [],
      dynamic: false,
    });
  });

  test("the all-operators reading keeps a heredoc in a substitution closed on its own line", () => {
    expect(
      extraction("echo $(cat <<EOF)\nit's\nEOF\nrm -rf /", {
        readAllOperators: true,
      }),
    ).toEqual({
      sanitized: "echo $(cat <<EOF <#>)\nrm -rf /",
      heredocs: [bare("EOF", "it's\n")],
      dynamic: false,
    });
  });

  test("a carriage return in a heredoc word closed on its own line has no body", () => {
    const command = "echo $(cat <<EOF\r)\nls";
    expect(extraction(command)).toEqual({
      sanitized: command,
      heredocs: [],
      dynamic: false,
    });
  });

  test("a backtick closed on the operator's line has no body", () => {
    const command = "echo `cat <<EOF`\nls";
    expect(extraction(command)).toEqual({
      sanitized: command,
      heredocs: [],
      dynamic: false,
    });
  });

  test("a comment inside backticks ends at the closing backtick", () => {
    expect(extraction("x=`echo hi # c`\ncat <<EOF\nit's\nEOF\nls")).toEqual({
      sanitized: "x=`echo hi # c`\ncat <<EOF <#>\nls",
      heredocs: [bare("EOF", "it's\n")],
      dynamic: false,
    });
  });
});

// A body that reaches the end of input without its terminator line is flagged
// as unterminated. The length bound alone is not an unterminated body.
describe("extractHeredocs unterminated bodies", () => {
  test.each([
    "`<<EOF\n`\nls",
    "cat <<EOF\nx",
    "cat <<EOF",
    "cat <<\nx",
    "$(()<<EOF\n)\nls",
  ])("%p is unterminated", (command) => {
    expect(extractHeredocs(command).unterminated).toBe(true);
  });

  test.each(["cat <<EOF\nx\nEOF\nls", "echo `cat <<EOF`\nls"])(
    "%p is terminated",
    (command) => {
      expect(extractHeredocs(command).unterminated).toBe(false);
    },
  );

  test("a body cut by the length bound alone is not unterminated", () => {
    const command = `cat <<EOF\n${"a".repeat(5000)}\nEOF\nls`;
    const result = extractHeredocs(command);
    expect(result.heredocs[0]?.truncated).toBe(true);
    expect(result.unterminated).toBe(false);
  });
});

// Under the all-operators reading a `<<` inside `$((…))` opens a heredoc; the
// default reading treats it as a shift.
describe("extractHeredocs all-operators reading inside arithmetic", () => {
  test("the all-operators reading opens a heredoc inside arithmetic", () => {
    expect(
      extraction("echo $((1<<2))\nx\n2\nls", { readAllOperators: true }),
    ).toEqual({
      sanitized: "echo $((1<<2 <#>))\nls",
      heredocs: [bare("2", "x\n")],
      dynamic: false,
    });
  });

  test("the default reading keeps a shift inside arithmetic as text", () => {
    expect(extraction("echo $((1<<2))\nx\n2\nls")).toEqual({
      sanitized: "echo $((1<<2))\nx\n2\nls",
      heredocs: [],
      dynamic: false,
    });
  });
});
