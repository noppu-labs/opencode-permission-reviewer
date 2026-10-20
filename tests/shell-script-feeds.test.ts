import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractHeredocs } from "../src/capability/heredoc-extractor.ts";
import { separatePlaceholders } from "../src/capability/heredoc-scripts.ts";
import { analyzeSegmentRedirections } from "../src/shell-effective-commands.ts";
import { lexSegmentsBounded, newAnalysisBudget } from "../src/shell-lexer.ts";
import { heredocPlaceholders } from "../src/shell-redirections.ts";
import {
  buildFeedInput,
  markRedirections,
  pipedFromSegments,
  type SegmentFeedParts,
  scriptFeedsOfSegments,
} from "../src/shell-script-feed-input.ts";
import {
  type ScriptFeed,
  scriptFeeds,
  stdinScripts,
} from "../src/shell-script-feeds.ts";
import {
  type ScriptRedirection,
  stdinSource,
} from "../src/shell-stdin-source.ts";
import type { ShellSegment, ShellToken } from "../src/shell-token.ts";

interface FeedRow {
  id: string;
  command: string;
  feeds: string[];
  remote: string[];
  unresolved?: boolean;
  dropScripts?: boolean;
  stdin?: string[];
  stdinUnresolved?: boolean;
  unspaced?: boolean;
}

const rows = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/shell-script-feed-rows.json"),
    "utf8",
  ),
) as FeedRow[];

/** The parts of `command` the way the walks produce them, and the scripts
 *  its heredocs recorded. */
function partsOf(
  command: string,
  separated = true,
): {
  parts: SegmentFeedParts[];
  scripts: ReadonlyMap<string, readonly string[]>;
} {
  const extraction = extractHeredocs(command);
  const text = separated
    ? separatePlaceholders(extraction.sanitizedCommand)
    : extraction.sanitizedCommand;
  const lex = lexSegmentsBounded(text);
  const budget = newAnalysisBudget("default", "bash", {
    commands: [],
    unresolved: false,
  });
  const parts = lex.segments.map((segment) => {
    const analysis = analyzeSegmentRedirections(segment, budget);
    return {
      segment,
      effective: analysis.commands,
      redirections: analysis.redirections,
      bareSsh: analysis.bareSsh,
      stdinShells: analysis.stdinShells,
    };
  });
  return { parts, scripts: extraction.scripts };
}

describe("script feeds per effective command", () => {
  test("the rows are unique", () => {
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  for (const row of rows) {
    test(`${row.id}: ${JSON.stringify(row.command)}`, () => {
      const { parts, scripts } = partsOf(row.command, row.unspaced !== true);
      const used = row.dropScripts === true ? new Map() : scripts;
      const result = scriptFeedsOfSegments(parts, used);
      const feeds: ScriptFeed[] = result.feeds;
      const local = feeds.filter((f) => !f.remote).map((f) => f.script);
      const remote = feeds.filter((f) => f.remote).map((f) => f.script);
      expect(local).toEqual(row.feeds);
      expect(remote).toEqual(row.remote);
      expect(result.unresolved).toBe(row.unresolved === true);
      if (row.stdin === undefined) return;
      const input = buildFeedInput(parts, used);
      const stdin = stdinScripts(input, input.effective.length - 1);
      expect(stdin.scripts).toEqual(row.stdin);
      expect(stdin.unresolved).toBe(row.stdinUnresolved === true);
    });
  }
});

describe("placeholders of a segment's heredoc redirections", () => {
  function placeholdersOf(command: string): (string | undefined)[] {
    const { parts } = partsOf(command);
    return parts.flatMap(({ segment }) => heredocPlaceholders(segment.tokens));
  }

  test("none when the segment holds no placeholder", () => {
    expect(placeholdersOf("sh <<<x < f")).toEqual([]);
  });

  test("one per heredoc, aligned with the redirection list", () => {
    const { parts } = partsOf("cat >o <<A <<-B <f <<<s\na\nA\n\tb\nB\n");
    const [part] = parts;
    const placeholders = heredocPlaceholders(part?.segment.tokens ?? []);
    expect(part?.redirections[0]?.map((r) => r.operator)).toEqual([
      ">",
      "<<",
      "<<-",
      "<",
      "<<<",
    ]);
    expect(placeholders.map((p) => p?.startsWith("<HEREDOC:"))).toEqual([
      undefined,
      true,
      true,
    ]);
  });

  test("a marker after a redirection that is not a heredoc is left out", () => {
    const word = (value: string): ShellToken => ({ raw: value, value });
    const tokens = [
      word("cat"),
      word(">out"),
      word("<HEREDOC:sha256:abc123>"),
      word("<<A"),
      word("<HEREDOC:sha256:def456>"),
      word("<HEREDOC:sha256:012345>"),
    ];
    expect(heredocPlaceholders(tokens)).toEqual([
      undefined,
      "<HEREDOC:sha256:def456>",
    ]);
  });

  test("the same body keeps the same placeholder", () => {
    const [first, second] = placeholdersOf("sh <<A; sh <<A\nx\nA\nx\nA\n");
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  test("an unterminated heredoc still has its placeholder", () => {
    expect(placeholdersOf("sh <<A\nx\n")).toHaveLength(1);
  });

  test("marking leaves an unmarked redirection as it was", () => {
    const marked = markRedirections(
      [
        { operator: "<", target: "f", quoted: false },
        { operator: "<<", target: "A", quoted: false },
      ],
      [undefined, "<HEREDOC:sha256:abc>"],
    );
    expect(marked[0]).toEqual({ operator: "<", target: "f", quoted: false });
    expect(marked[1]?.placeholder).toBe("<HEREDOC:sha256:abc>");
  });
});

describe("the pipe producer of each effective command", () => {
  const link = (precededBy?: string, endedBy?: string): ShellSegment => ({
    tokens: [],
    ...(precededBy === undefined ? {} : { precededBy }),
    ...(endedBy === undefined ? {} : { endedBy }),
  });

  test("a segment after `|` takes the single command before it", () => {
    expect(
      pipedFromSegments([link(undefined, "|"), link("|", ";")], [1, 1]),
    ).toEqual([undefined, 0]);
  });

  test("`|&` links too", () => {
    expect(
      pipedFromSegments([link(undefined, "|&"), link("|&", ";")], [1, 1]),
    ).toEqual([undefined, 0]);
  });

  test("every command of the consumer's segment takes the same producer", () => {
    expect(
      pipedFromSegments([link(undefined, "|"), link("|", ";")], [1, 2]),
    ).toEqual([undefined, 0, 0]);
  });

  test("a producer with several commands, or none, links nothing", () => {
    expect(
      pipedFromSegments([link(undefined, "|"), link("|", ";")], [2, 1]),
    ).toEqual([undefined, undefined, undefined]);
    expect(
      pipedFromSegments([link(undefined, "|"), link("|", ";")], [0, 1]),
    ).toEqual([undefined]);
  });

  test("a producer that a `)` or `;` ended links nothing", () => {
    expect(
      pipedFromSegments([link(undefined, ")"), link("|", ";")], [1, 1]),
    ).toEqual([undefined, undefined]);
    expect(
      pipedFromSegments([link(undefined, ";"), link(";", ";")], [1, 1]),
    ).toEqual([undefined, undefined]);
  });
});

describe("the stdin source of a redirection list", () => {
  const re = (
    operator: string,
    target: string,
    placeholder?: string,
  ): ScriptRedirection => ({
    operator,
    target,
    quoted: false,
    ...(placeholder === undefined ? {} : { placeholder }),
  });

  test("no redirection leaves the inherited stdin", () => {
    expect(stdinSource([])).toEqual({ kind: "pipe" });
    expect(stdinSource([re(">", "o")])).toEqual({ kind: "pipe" });
  });

  test("a heredoc without a placeholder is not a script", () => {
    expect(stdinSource([re("<<", "A")])).toEqual({ kind: "other" });
  });

  test("a heredoc carries its placeholder and a here-string its word", () => {
    expect(stdinSource([re("<<", "A", "<P>")])).toEqual({
      kind: "script",
      placeholder: "<P>",
    });
    expect(stdinSource([re("0<<-", "A", "<P>")])).toEqual({
      kind: "script",
      placeholder: "<P>",
    });
    expect(stdinSource([re("<<<", "hi")])).toEqual({
      kind: "text",
      text: "hi",
    });
  });

  test("a descriptor other than 0 is not stdin", () => {
    expect(stdinSource([re("3<<<", "hi")])).toEqual({ kind: "pipe" });
  });

  test("a duplicate takes what the descriptor holds, in order", () => {
    expect(stdinSource([re("3<<", "A", "<P>"), re("<&", "3")])).toEqual({
      kind: "script",
      placeholder: "<P>",
    });
    expect(
      stdinSource([re("3<", "f"), re("<<", "A", "<P>"), re("<&", "3")]),
    ).toEqual({ kind: "other" });
  });

  test("a huge descriptor number is read as a number", () => {
    expect(stdinSource([re("99999999999999999999<<<", "x")])).toEqual({
      kind: "pipe",
    });
  });
});

describe("direct input", () => {
  test("a missing placeholder is unresolved and feeds nothing", () => {
    const words = [{ raw: "sh", value: "sh" }];
    const result = scriptFeeds({
      effective: [words],
      redirections: [
        [{ operator: "<<", target: "A", quoted: false, placeholder: "<P>" }],
      ],
      pipedFrom: [undefined],
      scripts: new Map(),
    });
    expect(result).toEqual({ feeds: [], unresolved: true });
  });

  test("each reading is a feed of its own, once", () => {
    const words = [{ raw: "sh", value: "sh" }];
    const result = scriptFeeds({
      effective: [words, words],
      redirections: [
        [{ operator: "<<", target: "A", quoted: false, placeholder: "<P>" }],
        [{ operator: "<<", target: "A", quoted: false, placeholder: "<P>" }],
      ],
      pipedFrom: [undefined, undefined],
      scripts: new Map([["<P>", ["x", "y", "x"]]]),
    });
    expect(result.feeds).toEqual([
      { script: "x", remote: false },
      { script: "y", remote: false },
    ]);
  });

  test("a producer index out of range feeds nothing", () => {
    const words = [{ raw: "sh", value: "sh" }];
    const result = scriptFeeds({
      effective: [words],
      redirections: [[]],
      pipedFrom: [7],
      scripts: new Map(),
    });
    expect(result).toEqual({ feeds: [], unresolved: false });
  });
});

describe("work stays linear", () => {
  const FILLER = "a | ".repeat(30000);

  test("a long pipeline of plain commands", () => {
    const { parts, scripts } = partsOf(`${FILLER}cat`);
    const started = performance.now();
    expect(scriptFeedsOfSegments(parts, scripts).feeds).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("a long redirection list on one shell", () => {
    const command = `sh ${"<f ".repeat(30000)}<<<x`;
    const { parts, scripts } = partsOf(command);
    const started = performance.now();
    const feeds = scriptFeedsOfSegments(parts, scripts).feeds;
    expect(performance.now() - started).toBeLessThan(500);
    expect(feeds.length).toBeLessThanOrEqual(1);
  });
});
