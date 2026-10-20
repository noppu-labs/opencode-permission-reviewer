import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brakeReadingsReason } from "../src/brake-readings.ts";
import type { BodyCommands } from "../src/capability/heredoc-body-commands.ts";
import { extractHeredocs } from "../src/capability/heredoc-extractor.ts";
import { sanitizedText } from "../src/capability/heredoc-sanitized.ts";
import {
  heredocPlaceholder,
  heredocScriptText,
  keepBodyScripts,
} from "../src/capability/heredoc-scripts.ts";
import { analyzeEffectiveCommands } from "../src/shell-effective-commands.ts";
import type { ShellQuoting } from "../src/shell-lex-state.ts";
import { lexSegmentsBounded, newAnalysisBudget } from "../src/shell-lexer.ts";
import { normalizeShellRedirections } from "../src/shell-redirections.ts";
import type { ShellSegment } from "../src/shell-token.ts";

interface TextRow {
  id: string;
  form: string;
  body: string;
  quoted: boolean;
  tabStripped: boolean;
  script: string;
}

type Site = "top" | "sanitized" | "dq" | "backtick" | "string";

interface SiteRow {
  id: string;
  site: Site;
  command: string;
  body: string;
  script: string;
}

/** What the previous release gave a row's command as written (`seg`), its
 *  sanitized text (`san`) and the redirections of the sanitized segments
 *  (`red`), for one quoting or for every quoting without an entry (`*`). */
interface LexRow {
  id: string;
  command: string;
  q: ShellQuoting | "*";
  seg: string;
  san: string;
  red: string;
}

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", name), "utf8"),
  ) as T;
}

const textRows = fixture<TextRow[]>("heredoc-script-rows.json");
const siteRows = fixture<SiteRow[]>("heredoc-script-site-rows.json");
const lexRows = fixture<LexRow[]>("heredoc-script-lex-rows.json");

const QUOTINGS: ShellQuoting[] = ["bash", "rescan", "undecoded", "previous"];

function placeholderOf(body: string): string {
  return heredocPlaceholder(createHash("sha256").update(body).digest("hex"));
}

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

function redirectionsOf(segments: ShellSegment[]): string {
  return segments
    .map((segment) =>
      normalizeShellRedirections(segment.tokens)
        .redirections.map((r) => `${r.operator}:${r.target}`)
        .join(","),
    )
    .join(" / ");
}

function commandStringScripts(command: string): ReadonlyMap<string, string> {
  const bodies: BodyCommands = { commands: [], unresolved: false };
  const budget = newAnalysisBudget("default", "bash", bodies);
  for (const segment of lexSegmentsBounded(command).segments)
    analyzeEffectiveCommands(segment, budget);
  return bodies.scripts ?? new Map();
}

function scriptsAt(site: Site, command: string): ReadonlyMap<string, string> {
  if (site === "top") return extractHeredocs(command).scripts;
  if (site === "sanitized") return sanitizedText(command).scripts;
  if (site === "string") return commandStringScripts(command);
  return lexSegmentsBounded(command).scripts;
}

describe("the text a heredoc gives the command that reads it", () => {
  test.each(textRows.map((row) => [row.id, row.form, row] as const))(
    "%s reads %s",
    (_id, _form, row) => {
      expect(heredocScriptText(row.body, row.quoted, row.tabStripped)).toBe(
        row.script,
      );
    },
  );
});

describe("scripts recorded per placeholder", () => {
  test.each(siteRows.map((row) => [row.id, row.site, row] as const))(
    "%s records the body at the %s site",
    (_id, _site, row) => {
      const scripts = scriptsAt(row.site, row.command);
      expect(scripts.size).toBe(1);
      expect(scripts.get(placeholderOf(row.body))).toBe(row.script);
    },
  );

  test("the placeholder is the token the sanitized command holds", () => {
    const body = "printf A\n";
    const extraction = extractHeredocs(`sh <<EOF\n${body}EOF\n`);
    const key = placeholderOf(body);
    expect(extraction.sanitizedCommand).toContain(key);
    expect([...extraction.scripts.keys()]).toEqual([key]);
  });

  test("a substitution read directly records its heredoc", () => {
    const scripts = lexSegmentsBounded(
      'echo "$(sh <<EOF\nprintf A \\\nB\nEOF\n)"',
    ).scripts;
    expect([...scripts.values()]).toEqual(["printf A B\n"]);
  });

  test("each heredoc of a line has its own entry", () => {
    const first = "printf A\n";
    const second = "\tprintf B\n";
    const { scripts } = extractHeredocs(
      `sh <<EOF <<-'IN'\n${first}EOF\n${second}IN\n`,
    );
    expect(scripts.size).toBe(2);
    expect(scripts.get(placeholderOf(first))).toBe(first);
    expect(scripts.get(placeholderOf(second))).toBe("printf B\n");
  });

  test("the whole body is recorded past the bytes a record keeps", () => {
    const body = `${"printf AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n".repeat(600)}`;
    expect(body.length).toBeGreaterThan(20_000);
    const extraction = extractHeredocs(`sh <<'EOF'\n${body}EOF\n`);
    expect(extraction.scripts.get(placeholderOf(body))).toBe(body);
    expect(extraction.heredocs[0]?.truncated).toBe(true);
  });

  test("a body with no terminator line records nothing", () => {
    expect(extractHeredocs("sh <<EOF\nprintf A\n").scripts.size).toBe(0);
  });

  test("a delimiter that cannot be known records nothing", () => {
    expect(extractHeredocs("sh <<$x\nprintf A\n").scripts.size).toBe(0);
  });

  test("the brake's readings keep the scripts of the text they lex", () => {
    const body = "printf A\n";
    const bodies: BodyCommands = { commands: [], unresolved: false };
    const command = `echo "$(sh <<EOF\n${body}EOF\n)"`;
    expect(brakeReadingsReason(command, "finder", bodies)).toBeUndefined();
    expect(bodies.scripts?.get(placeholderOf(body))).toBe(body);
  });

  test("a command with no heredoc shares one empty map", () => {
    const first = extractHeredocs("ls -la").scripts;
    expect(first.size).toBe(0);
    expect(extractHeredocs("pwd").scripts).toBe(first);
    expect(lexSegmentsBounded("ls").scripts).toBe(first);
    expect(sanitizedText("ls").scripts).toBe(first);
  });

  test("an input past the lexer cap keeps the shared empty map", () => {
    const empty = extractHeredocs("ls").scripts;
    expect(lexSegmentsBounded("a".repeat(200_000)).scripts).toBe(empty);
  });

  test("the previous release's heredoc reading records none", () => {
    expect(
      lexSegmentsBounded('echo "$(sh <<EOF\nprintf A\nEOF\n)"', "legacy")
        .scripts.size,
    ).toBe(0);
  });
});

describe("one placeholder for bodies read two ways", () => {
  const body = "printf A \\\nB\n";
  const joined = "printf A B\n";

  test("a quoted and an unquoted heredoc of one body keep both texts", () => {
    const { scripts } = extractHeredocs(
      `sh <<EOF; sh <<'EOF'\n${body}EOF\n${body}EOF\n`,
    );
    expect(scripts.size).toBe(1);
    expect(scripts.get(placeholderOf(body))).toBe(`${joined}\n${body}`);
  });

  test("keeping the same map again changes nothing", () => {
    const into: BodyCommands = { commands: [], unresolved: false };
    const { scripts } = extractHeredocs(
      `sh <<EOF; sh <<'EOF'\n${body}EOF\n${body}EOF\n`,
    );
    keepBodyScripts(into, scripts);
    keepBodyScripts(into, scripts);
    keepBodyScripts(into, scripts);
    expect(into.scripts).toEqual(new Map(scripts));
  });

  test("a collector that is not there keeps nothing", () => {
    expect(() =>
      keepBodyScripts(undefined, new Map([["k", "v"]])),
    ).not.toThrow();
  });

  test("an empty map allocates no map in the collector", () => {
    const into: BodyCommands = { commands: [], unresolved: false };
    keepBodyScripts(into, new Map());
    expect(into.scripts).toBeUndefined();
  });
});

describe("the lexer's tokens and segments keep the previous release's", () => {
  const pinned = lexRows.flatMap((row) =>
    (row.q === "*" ? QUOTINGS : [row.q]).map((q) => [row.id, q, row] as const),
  );

  test("the pins cover every quoting of every command", () => {
    const keys = new Set(pinned.map(([id, q]) => `${id}/${q}`));
    for (const row of lexRows)
      for (const q of QUOTINGS) expect(keys.has(`${row.id}/${q}`)).toBe(true);
  });

  test.each(pinned)("%s keeps its segments under %s", (_id, q, row) => {
    const lexed = lexSegmentsBounded(row.command, "default", q).segments;
    expect(project(lexed)).toBe(row.seg);
    const sanitized = lexSegmentsBounded(
      extractHeredocs(row.command).sanitizedCommand,
      "default",
      q,
    ).segments;
    expect(project(sanitized)).toBe(row.san);
    expect(redirectionsOf(sanitized)).toBe(row.red);
  });
});
