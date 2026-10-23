import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityActionClass } from "../src/kernel/reviewer-config.ts";
import { analyzeCapability } from "../src/modules/analysis/capability/bash-analyzer.ts";
import { walkBodyCommands } from "../src/modules/analysis/capability/body-command-walk.ts";
import { parseCommand } from "../src/modules/analysis/capability/command-parser.ts";
import { newWalked } from "../src/modules/analysis/capability/command-walk.ts";
import { MAX_BODY_DEPTH } from "../src/modules/analysis/capability/heredoc/heredoc-body-commands.ts";
import { extractHeredocs } from "../src/modules/analysis/capability/heredoc/heredoc-extractor.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
  ParserCompleteness,
} from "../src/modules/analysis/capability/models/capability-types.ts";
import type { ShellQuoting } from "../src/modules/analysis/shell/shell-lex-state.ts";
import * as lexer from "../src/modules/analysis/shell/shell-lexer.ts";
import { newAnalysisBudget } from "../src/modules/analysis/shell/shell-lexer.ts";
import type { ShellSegment } from "../src/modules/analysis/shell/shell-token.ts";

interface AnalysisRow {
  id: string;
  form: string;
  command: string;
  /** The same commands with each body substitution on the command line. */
  twin?: string;
  /** What the previous release's analysis gave this command. */
  keep?: {
    actionClass: CapabilityActionClass;
    summary: string;
    completeness: ParserCompleteness;
    warnings: Array<keyof typeof WARNINGS>;
    truncated: boolean;
  };
  /** The body substitution has no end, so the analysis is incomplete. */
  truncated?: boolean;
}

/** What the previous release gave the segments of a row's command as written,
 *  for one quoting, or for every quoting without an entry of its own (`*`).
 *  `seg` reads `before>tokens<after` for each segment. */
interface LexRow {
  id: string;
  q: ShellQuoting | "*";
  seg: string;
}

const WARNINGS = {
  dynamic:
    "command contains dynamic constructs (variables, substitution, or globs)",
  body: "one or more heredoc bodies have unresolvable expansion",
};

const rows = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/heredoc-body-analysis-rows.json"),
    "utf8",
  ),
) as AnalysisRow[];

const lexRows = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/heredoc-body-analysis-lex-rows.json"),
    "utf8",
  ),
) as LexRow[];

const QUOTINGS: ShellQuoting[] = ["bash", "rescan", "undecoded", "previous"];

function project(segments: ShellSegment[]): string {
  return segments
    .map(
      (segment) =>
        `${segment.precededBy ?? ""}>${segment.tokens
          .map((token) =>
            token.raw === token.value
              ? token.raw
              : `${token.raw}=${token.value}`,
          )
          .join(" ")}<${segment.endedBy ?? ""}`,
    )
    .join(" / ");
}

function assess(command: string): {
  facts: Omit<CapabilityAssessment, "analysisWarnings">;
  analysisWarnings: string[];
  parsed: ParsedCommand;
} {
  const parsed = parseCommand(command);
  const { analysisWarnings, ...facts } = analyzeCapability(parsed, "/w", "/w");
  return { facts, analysisWarnings, parsed };
}

const withTwin = rows.filter((row) => row.twin !== undefined);
const kept = rows.filter(
  (row): row is AnalysisRow & { keep: NonNullable<AnalysisRow["keep"]> } =>
    row.keep !== undefined,
);
const open = rows.filter((row) => row.truncated === true);

describe("commands run by an unquoted heredoc body", () => {
  test.each(withTwin.map((row) => [row.id, row.form, row] as const))(
    "%s reads %s like its substitution on the command line",
    (_id, _form, row) => {
      const body = assess(row.command);
      const twin = assess(row.twin ?? "");
      expect(body.parsed.analysisTruncated).toBe(false);
      expect(body.facts).toEqual(twin.facts);
    },
  );

  test.each(kept.map((row) => [row.id, row.form, row] as const))(
    "%s keeps its reading for %s",
    (_id, _form, row) => {
      const { facts, analysisWarnings, parsed } = assess(row.command);
      expect({
        actionClass: facts.actionClass.value,
        summary: facts.summary,
        completeness: facts.parserCompleteness,
        warnings: analysisWarnings,
        truncated: parsed.analysisTruncated,
      }).toEqual({
        ...row.keep,
        warnings: row.keep.warnings.map((name) => WARNINGS[name]),
      });
    },
  );

  test.each(open.map((row) => [row.id, row.form, row] as const))(
    "%s stops the analysis short for %s",
    (_id, _form, row) => {
      expect(parseCommand(row.command).analysisTruncated).toBe(true);
    },
  );

  test("keeps the segments and redirections of the command ahead of the body commands", () => {
    const hash = /<HEREDOC:sha256:[0-9a-f]{12}>/g;
    const own = parseCommand("cat <<EOF > f\nplain\nEOF");
    const parsed = parseCommand("cat <<EOF > f\n$(rm -rf /)\nEOF");
    expect(project(parsed.segments).replace(hash, "")).toBe(
      `${project(own.segments).replace(hash, "")} / >rm -rf /<`,
    );
    expect(runs("cat <<EOF > f\n$(rm -rf /)\nEOF")).toEqual([
      "cat",
      "rm -rf /",
    ]);
    expect(parsed.redirections).toHaveLength(2);
  });

  test("leaves the dynamic flag and the opaque reading as they were", () => {
    const parsed = parseCommand("cat <<EOF\n$(date)\nEOF");
    expect(parsed.hasDynamicConstructs).toBe(true);
    expect(assess("cat <<EOF\n$(date)\nEOF").facts.parserCompleteness).toBe(
      "opaque",
    );
  });
});

/** `levels` unquoted bodies, each held by a substitution in the one before,
 *  with `payload` run by the innermost. */
function nest(levels: number, payload: string): string {
  let body = `$(${payload})`;
  for (let level = levels; level > 1; level -= 1)
    body = `$(cat <<H${level}\n${body}\nH${level}\n)`;
  return `cat <<H1\n${body}\nH1`;
}

/** One body inside a double-quoted substitution, which the lexer reads
 *  rather than the extractor. */
function quoted(payload: string): string {
  return `echo "$(cat <<H\n$(${payload})\nH\n)"`;
}

function runs(command: string): string[] {
  return parseCommand(command).effective.map((tokens) =>
    tokens.map((token) => token.value).join(" "),
  );
}

describe("nested bodies", () => {
  test("judges the commands of bodies nested up to the depth cap", () => {
    const parsed = parseCommand(nest(8, "rm -rf /"));
    expect(parsed.analysisTruncated).toBe(false);
    expect(runs(nest(8, "rm -rf /"))).toContain("rm -rf /");
  });

  test("stops the analysis short one level past the cap", () => {
    expect(parseCommand(nest(9, "rm -rf /")).analysisTruncated).toBe(true);
  });

  test("judges the commands that lexer-read substitutions hold", () => {
    expect(parseCommand(quoted("rm -rf /")).analysisTruncated).toBe(false);
    expect(runs(quoted("rm -rf /"))).toContain("rm -rf /");
  });

  test("walks bodies the lexer reads inside a body's commands up to the depth cap", () => {
    let calls = 0;
    const spy = spyOn(lexer, "lexSegmentsBounded").mockImplementation(() => {
      calls += 1;
      return {
        segments: [],
        truncated: false,
        bodyCommands: calls < MAX_BODY_DEPTH ? ["x"] : [],
        bodyUnresolved: false,
        scripts: new Map(),
      };
    });
    const walked = newWalked();
    try {
      walkBodyCommands(["x"], false, newAnalysisBudget(), walked);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(MAX_BODY_DEPTH);
    expect(walked.truncated).toBe(false);
  });

  test("stops the analysis short when lexer-read bodies nest past the cap", () => {
    let calls = 0;
    const spy = spyOn(lexer, "lexSegmentsBounded").mockImplementation(() => {
      calls += 1;
      return {
        segments: [],
        truncated: false,
        bodyCommands: ["x"],
        bodyUnresolved: false,
        scripts: new Map(),
      };
    });
    const walked = newWalked();
    try {
      walkBodyCommands(["x"], false, newAnalysisBudget(), walked);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(MAX_BODY_DEPTH);
    expect(walked.truncated).toBe(true);
  });

  test("stops the analysis short when a body has no end to read", () => {
    const walked = newWalked();
    walkBodyCommands([], true, newAnalysisBudget(), walked);
    expect(walked.truncated).toBe(true);
  });
});

describe("the commands carried beside the segments", () => {
  test("the extraction lists the commands of unquoted bodies in body order", () => {
    const extraction = extractHeredocs(
      "cat <<A <<B\n$(echo a)\nA\n`echo b`\nB\n",
    );
    expect(extraction.bodyCommands).toEqual(["echo a", "echo b"]);
    expect(extraction.bodyUnresolved).toBe(false);
  });

  test.each([
    ["<<'A'", "$(echo a)"],
    ['<<"A"', "$(echo a)"],
    ["<<\\A", "$(echo a)"],
  ])(
    "the extraction lists nothing for a body whose delimiter is %s",
    (operator, body) => {
      const extraction = extractHeredocs(`cat ${operator}\n${body}\nA\n`);
      expect(extraction.bodyCommands).toEqual([]);
      expect(extraction.bodyUnresolved).toBe(false);
    },
  );

  test("the extraction strips the tabs of a <<- body first", () => {
    const extraction = extractHeredocs("cat <<-A\n\t$(echo a)\n\tA\n");
    expect(extraction.bodyCommands).toEqual(["echo a"]);
  });

  test("the extraction reads a body in full, past the length kept for the record", () => {
    const filler = "x".repeat(9000);
    const extraction = extractHeredocs(`cat <<A\n${filler}\n$(echo late)\nA\n`);
    expect(extraction.bodyCommands).toEqual(["echo late"]);
  });

  test("the extraction marks a body with an open substitution unresolved", () => {
    const extraction = extractHeredocs("cat <<A\n$(echo a\nA\n");
    expect(extraction.bodyUnresolved).toBe(true);
  });

  test("the extraction lists the commands of a heredoc inside a substitution", () => {
    const extraction = extractHeredocs("x=$(cat <<A\n$(echo a)\nA\n)");
    expect(extraction.bodyCommands).toEqual(["echo a"]);
  });

  test("the extraction lists nothing for text without a body", () => {
    expect(extractHeredocs("echo $(date) `pwd`")).toMatchObject({
      bodyCommands: [],
      bodyUnresolved: false,
    });
  });

  test.each(QUOTINGS)(
    "the lexer lists the commands of a body inside a double-quoted substitution under %s",
    (quoting) => {
      const lex = lexer.lexSegmentsBounded(
        'echo "$(cat <<A\n$(echo a)\nA\n)"',
        "default",
        quoting,
      );
      expect(lex.bodyCommands).toEqual(["echo a"]);
      expect(lex.bodyUnresolved).toBe(false);
    },
  );

  test("the lexer lists nested bodies, a backtick's among them", () => {
    const lex = lexer.lexSegmentsBounded(
      'echo "$(cat <<A\n`cat <<B\n$(echo b)\nB\n`\nA\n)"',
      "default",
    );
    expect(lex.bodyCommands).toEqual([
      "cat <<B <HEREDOC:sha256:bcb585632a1d>\n",
      "echo b",
    ]);
  });

  test("the lexer lists nothing under the previous release's heredoc reading", () => {
    const lex = lexer.lexSegmentsBounded(
      'echo "$(cat <<A\n$(echo a)\nA\n)"',
      "legacy",
    );
    expect(lex.bodyCommands).toEqual([]);
    expect(lex.bodyUnresolved).toBe(false);
  });

  test("the lexer marks an open substitution in such a body unresolved", () => {
    const lex = lexer.lexSegmentsBounded(
      'echo "$(cat <<A\n$(echo a\nA\n)"',
      "default",
    );
    expect(lex.bodyUnresolved).toBe(true);
  });

  test("the lexer lists nothing for a quoted delimiter", () => {
    const lex = lexer.lexSegmentsBounded(
      "echo \"$(cat <<'A'\n$(echo a)\nA\n)\"",
      "default",
    );
    expect(lex.bodyCommands).toEqual([]);
  });
});

describe("the segments of the command as written", () => {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const cases = lexRows.flatMap((entry) =>
    (entry.q === "*" ? QUOTINGS : [entry.q]).flatMap((quoting) =>
      entry.q === "*" &&
      lexRows.some((other) => other.id === entry.id && other.q === quoting)
        ? []
        : [[entry.id, quoting, entry.seg] as const],
    ),
  );

  test("has a pin for every row and quoting", () => {
    expect(cases).toHaveLength(rows.length * QUOTINGS.length);
  });

  test.each(cases)(
    "%s has the segments the previous release gave under %s",
    (id, quoting, seg) => {
      const command = byId.get(id)?.command ?? "";
      expect(
        project(lexer.lexSegmentsBounded(command, "default", quoting).segments),
      ).toBe(seg);
    },
  );
});
