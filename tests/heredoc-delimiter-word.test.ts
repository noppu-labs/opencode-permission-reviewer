import { expect, test } from "bun:test";
import { parseDelimiterWord } from "../src/modules/analysis/capability/heredoc/heredoc-delimiter.ts";

test("a delimiter bash and zsh read differently is unresolved", () => {
  expect(parseDelimiterWord("$'E\\[F' x", 0)).toEqual({
    wordEnd: 7,
    delimiter: expect.any(String),
    quoted: true,
    resolved: false,
    shellDependent: true,
  });
});

test.each(["$'\\u0041'", "$'\\U00000041'", "$'\\u'"])(
  "%s is unresolved: no shell gives the decoded value",
  (word) => {
    expect(parseDelimiterWord(word, 0)).toMatchObject({
      resolved: false,
      shellDependent: true,
    });
  },
);

test("an unterminated quote is unresolved but not shell-dependent", () => {
  expect(parseDelimiterWord('"EOF', 0)).toMatchObject({
    resolved: false,
    shellDependent: false,
  });
});

test("a delimiter both shells read alike stays resolved", () => {
  expect(parseDelimiterWord("$'E\\tF'", 0)).toMatchObject({
    delimiter: "E\tF",
    quoted: true,
    resolved: true,
    shellDependent: false,
  });
});
