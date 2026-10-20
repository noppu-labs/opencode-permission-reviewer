import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  heredocBodyCommands,
  MAX_BODY_DEPTH,
} from "../src/capability/heredoc-body-commands.ts";
import * as extractor from "../src/capability/heredoc-extractor.ts";

interface BodyRow {
  id: string;
  body: string;
  tabStripped: boolean;
  /** What the scanner returns: the union of what bash 3.2, 4.4, 5.1 and 5.3
   *  run, plus any text the shell rejects but a reader may take for a command. */
  commands: string[];
  unresolved: boolean;
  /** The probe markers bash ran that these commands hold. */
  ran?: string[];
  /** The markers bash ran from the body of a heredoc the commands hold; the
   *  commands list them after the text that holds the heredoc. */
  ranInNestedBody?: string[];
  /** Set where the versions disagree on what runs. */
  versions?: string;
  note?: string;
}

/** One row per probe body in tests/fixtures/heredoc-body-command-rows.json. */
const rows = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/heredoc-body-command-rows.json"),
    "utf8",
  ),
) as BodyRow[];

const BRACE = "$" + "{";

describe("heredocBodyCommands", () => {
  test.each(rows.map((row) => [row.id, row] as const))(
    "reads body %s as the shell expands it",
    (_id, row) => {
      const { commands, unresolved } = heredocBodyCommands(
        row.body,
        row.tabStripped,
      );
      expect({ commands, unresolved }).toEqual({
        commands: row.commands,
        unresolved: row.unresolved,
      });
    },
  );

  test("holds every command a shell version ran in the commands it lists", () => {
    for (const row of rows) {
      for (const marker of row.ran ?? []) {
        const listed = row.commands.some((command) => command.includes(marker));
        expect([row.id, marker, listed]).toEqual([row.id, marker, true]);
      }
    }
  });

  test("lists the commands a nested heredoc body runs after the text that holds it", () => {
    for (const row of rows) {
      for (const marker of row.ranInNestedBody ?? []) {
        const at = row.commands.findIndex((command) =>
          command.includes(marker),
        );
        expect([row.id, marker, at > 0]).toEqual([row.id, marker, true]);
      }
    }
  });

  test("lists commands in source order", () => {
    const body = `$(echo c)\`echo b\`${BRACE}x:-$(echo a)}\n$((1 + $(echo d)))`;
    expect(heredocBodyCommands(body, false).commands).toEqual([
      "echo c",
      "echo b",
      "echo a",
      "echo d",
    ]);
  });

  test("returns the same commands when the body is read twice", () => {
    const body = `$(echo a) \`echo b\` ${BRACE}x:-$(echo c)}`;
    expect(heredocBodyCommands(body, false)).toEqual(
      heredocBodyCommands(body, false),
    );
  });

  test("keeps the scripts of the heredocs in the commands it lists", () => {
    const found = heredocBodyCommands("$(sh <<'X'\necho hi\nX\n)", false);
    expect(found.commands).toEqual(["sh <<X <HEREDOC:sha256:ab08508fdf5c>\n"]);
    expect([...(found.scripts ?? [])]).toEqual([
      ["<HEREDOC:sha256:ab08508fdf5c>", ["echo hi\n"]],
    ]);
  });

  test("keeps the scripts of the heredocs in a command bash 3.2 ends early", () => {
    const body = "sh <<'E'\n$(\nE\nsh <<'E'\n$((\nE)case x in x)\nE\n))";
    const scripts = [...(heredocBodyCommands(body, false).scripts ?? [])];
    expect(scripts.flatMap(([, texts]) => texts)).toContain(
      "$((\nE)case x in x)\n",
    );
  });

  test("keeps no scripts for a body whose commands hold no heredoc", () => {
    expect(heredocBodyCommands("$(echo a)", false).scripts).toBeUndefined();
  });
});

describe("heredocBodyCommands depth", () => {
  test("reads the body one level deeper than the cap as unresolved", () => {
    const real = extractor.extractHeredocs;
    let entered = 0;
    const inner: boolean[] = [];
    const spy = spyOn(extractor, "extractHeredocs").mockImplementation(
      (command) => {
        entered += 1;
        inner.push(heredocBodyCommands("`x`", false).unresolved);
        return real(command);
      },
    );
    try {
      expect(heredocBodyCommands("`x`", false).unresolved).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(entered).toBe(MAX_BODY_DEPTH);
    expect(inner.filter(Boolean)).toHaveLength(1);
    expect(inner[0]).toBe(true);
  });

  test("restores the depth after a call that throws", () => {
    const spy = spyOn(extractor, "extractHeredocs").mockImplementation(() => {
      throw new Error("stop");
    });
    try {
      for (let i = 0; i < MAX_BODY_DEPTH + 2; i += 1)
        expect(() => heredocBodyCommands("`x`", false)).toThrow("stop");
    } finally {
      spy.mockRestore();
    }
    expect(heredocBodyCommands("$(a)", false)).toEqual({
      commands: ["a"],
      unresolved: false,
    });
  });
});

describe("heredocBodyCommands bounds", () => {
  const CAP = 131_072;
  type Shape = (size: number) => string;
  const shapes: Record<string, Shape> = {
    "many substitutions": (size: number): string => "$(x)".repeat(size / 4),
    "many backtick substitutions": (size: number): string =>
      "`x`".repeat(size / 3),
    "nested expansions": (size: number): string =>
      `${BRACE}x:-$((1+$(x)))}`.repeat(size / 17),
    "escaped openers": (size: number): string => "\\$(".repeat(size / 3),
    "open arithmetic": (size: number): string => "$((".repeat(size / 3),
    "closed arithmetic": (size: number): string =>
      `${"$((".repeat(size / 5)}1${"))".repeat(size / 5)}`,
    "ten thousand nested arithmetic": (): string =>
      `${"$((".repeat(10_000)}1${"))".repeat(10_000)}`,
    "open substitutions": (size: number): string => "$(".repeat(size / 2),
    continuations: (size: number): string => "\\\n".repeat(size / 2),
    "tabbed lines": (size: number): string => "\t$(x)\n".repeat(size / 6),
  };
  const cases = Object.entries(shapes).flatMap(([name, make]) =>
    [1, 8].map((multiple) => [name, multiple, make(CAP * multiple)] as const),
  );

  test.each(cases)(
    "reads %s at %dx the cap in under a second",
    (_n, _m, body) => {
      const started = performance.now();
      heredocBodyCommands(body, body.startsWith("\t"));
      expect(performance.now() - started).toBeLessThan(1000);
    },
  );
});
