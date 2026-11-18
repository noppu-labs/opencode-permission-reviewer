import { expect, test } from "bun:test";
import { parseDelimiterWord } from "../src/modules/analysis/capability/heredoc/heredoc-delimiter.ts";

test("a delimiter bash and zsh read differently is unresolved", () => {
  expect(parseDelimiterWord("$'E\\[F' x", 0)).toEqual({
    wordEnd: 7,
    delimiter: expect.any(String),
    quoted: true,
    resolved: false,
  });
});

test("a delimiter both shells read alike stays resolved", () => {
  expect(parseDelimiterWord("$'E\\tF'", 0)).toMatchObject({
    delimiter: "E\tF",
    quoted: true,
    resolved: true,
  });
});
