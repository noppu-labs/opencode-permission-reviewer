import { describe, expect, test } from "bun:test";
import {
  type ShellCommandSegmentWithDirectory,
  shellCommandSegmentsWithDirectory,
} from "../src/ssh-command-segments.ts";

const AMBIGUOUS_AFTER_CD =
  "working directory after cd is conditional or ambiguous";
const AMBIGUOUS_SUBSHELL =
  "subshell follows cd without a success or failure operator; its working directory is ambiguous";
const ABSENT_TARGET = "cd target is absent or ambiguous";

// The segments also carry the lexer's `endedBy`, which the exported type omits.
type Segment = ShellCommandSegmentWithDirectory & { endedBy?: string };

// Characterisation rows: the exact segments, directories and reasons each
// cd and grouping branch produces from the initial directory /w.
const CASES: ReadonlyArray<[string, Segment[]]> = [
  [
    "cd && pwd",
    [
      { tokens: ["cd"], endedBy: "&&", directory: "/w" },
      {
        tokens: ["pwd"],
        preceding: "&&",
        directoryReason: "preceding cd target is unresolved",
      },
    ],
  ],
  [
    "cd sub | pwd",
    [
      { tokens: ["cd", "sub"], endedBy: "|", directory: "/w" },
      { tokens: ["pwd"], preceding: "|", directoryReason: AMBIGUOUS_AFTER_CD },
    ],
  ],
  [
    "cd sub & pwd",
    [
      { tokens: ["cd", "sub"], endedBy: "&", directory: "/w" },
      { tokens: ["pwd"], preceding: "&", directoryReason: AMBIGUOUS_AFTER_CD },
    ],
  ],
  ["cd sub", [{ tokens: ["cd", "sub"], directory: "/w" }]],
  [
    "cd sub ( pwd )",
    [
      { tokens: ["cd", "sub"], endedBy: "(", directory: "/w" },
      {
        tokens: ["pwd"],
        preceding: "(",
        endedBy: ")",
        directoryReason: AMBIGUOUS_SUBSHELL,
      },
    ],
  ],
  [
    "cd /x; cd sub ( pwd ) && pwd",
    [
      { tokens: ["cd", "/x"], endedBy: ";", directory: "/w" },
      {
        tokens: ["cd", "sub"],
        preceding: ";",
        endedBy: "(",
        directoryReason: AMBIGUOUS_AFTER_CD,
      },
      {
        tokens: ["pwd"],
        preceding: "(",
        endedBy: ")",
        directoryReason: AMBIGUOUS_SUBSHELL,
      },
      { tokens: ["pwd"], preceding: "&&", directoryReason: AMBIGUOUS_SUBSHELL },
    ],
  ],
  [
    ") pwd",
    [
      { tokens: [], endedBy: ")", directory: "/w" },
      { tokens: ["pwd"], preceding: ")", directory: "/w" },
    ],
  ],
  [
    "pwd ) ; pwd",
    [
      { tokens: ["pwd"], endedBy: ")", directory: "/w" },
      { tokens: ["pwd"], preceding: ";", directory: "/w" },
    ],
  ],
  [
    "( cd sub ) pwd",
    [
      { tokens: [], endedBy: "(", directory: "/w" },
      {
        tokens: ["cd", "sub"],
        preceding: "(",
        endedBy: ")",
        directory: "/w",
      },
      { tokens: ["pwd"], preceding: ")", directory: "/w" },
    ],
  ],
  [
    "cd /x && echo (y) && pwd",
    [
      { tokens: ["cd", "/x"], endedBy: "&&", directory: "/w" },
      { tokens: ["echo"], preceding: "&&", endedBy: "(", directory: "/x" },
      { tokens: ["y"], preceding: "(", endedBy: ")", directory: "/x" },
      { tokens: ["pwd"], preceding: "&&", directory: "/x" },
    ],
  ],
  [
    "( ( pwd ) )",
    [
      { tokens: [], endedBy: "(", directory: "/w" },
      { tokens: [], preceding: "(", endedBy: "(", directory: "/w" },
      { tokens: ["pwd"], preceding: "(", endedBy: ")", directory: "/w" },
      { tokens: [], preceding: ")", endedBy: ")", directory: "/w" },
    ],
  ],
  [
    "cd a b && cd sub || pwd",
    [
      { tokens: ["cd", "a", "b"], endedBy: "&&", directory: "/w" },
      {
        tokens: ["cd", "sub"],
        preceding: "&&",
        endedBy: "||",
        directoryReason: ABSENT_TARGET,
      },
      { tokens: ["pwd"], preceding: "||", directoryReason: ABSENT_TARGET },
    ],
  ],
  [
    "cd a b && ( cd /x && pwd ) ; pwd",
    [
      { tokens: ["cd", "a", "b"], endedBy: "&&", directory: "/w" },
      {
        tokens: [],
        preceding: "&&",
        endedBy: "(",
        directoryReason: ABSENT_TARGET,
      },
      {
        tokens: ["cd", "/x"],
        preceding: "(",
        endedBy: "&&",
        directoryReason: ABSENT_TARGET,
      },
      { tokens: ["pwd"], preceding: "&&", endedBy: ")", directory: "/x" },
      { tokens: ["pwd"], preceding: ";", directoryReason: ABSENT_TARGET },
    ],
  ],
  [
    "cd $X && pwd",
    [
      { tokens: ["cd", "$X"], endedBy: "&&", directory: "/w" },
      {
        tokens: ["pwd"],
        preceding: "&&",
        directoryReason: "cd target contains unresolved shell expansion",
      },
    ],
  ],
  [
    "cd -- /x && pwd",
    [
      { tokens: ["cd", "--", "/x"], endedBy: "&&", directory: "/w" },
      { tokens: ["pwd"], preceding: "&&", directory: "/x" },
    ],
  ],
];

describe("working-directory tracking across cd and subshell branches", () => {
  test.each(CASES)("%p", (command, expected) => {
    expect(shellCommandSegmentsWithDirectory(command, "/w")).toStrictEqual(
      expected,
    );
  });

  test("segment keys keep their insertion order", () => {
    expect(
      shellCommandSegmentsWithDirectory("cd a b && ( pwd ) && pwd", "/w").map(
        (segment) => Object.keys(segment),
      ),
    ).toEqual([
      ["tokens", "endedBy", "directory"],
      ["tokens", "preceding", "endedBy", "directoryReason"],
      ["tokens", "preceding", "endedBy", "directoryReason"],
      ["tokens", "preceding", "directoryReason"],
    ]);
  });
});
