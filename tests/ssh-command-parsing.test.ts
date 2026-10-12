import { describe, expect, test } from "bun:test";
import {
  catSource,
  findSshIndex,
  parseSsh,
} from "../src/ssh-command-segments.ts";

// Characterisation rows for parseSsh at the index findSshIndex returns. Some
// look odd and are pinned as they are: a bare `-` is taken as the
// destination, an empty `-p` value is kept, `@host` keeps its `@`, and only
// trailing redirection-looking tokens are dropped (`ls > out` keeps both).
const SSH_CASES: ReadonlyArray<[string[], ReturnType<typeof parseSsh>]> = [
  [
    ["ssh", "--", "host", "uptime"],
    { destination: "host", host: "host", remoteCommand: "uptime" },
  ],
  [["ssh", "--"], undefined],
  [["ssh", "--", ""], undefined],
  [
    ["ssh", "-v", "--", "u@h", "ls"],
    { destination: "u@h", host: "h", user: "u", remoteCommand: "ls" },
  ],
  [["ssh", "-"], { destination: "-", host: "-", remoteCommand: "" }],
  [["ssh", "-", "x"], { destination: "-", host: "-", remoteCommand: "x" }],
  [
    ["ssh", "-T", "host"],
    { destination: "host", host: "host", remoteCommand: "" },
  ],
  [
    ["ssh", "-ikey", "-p2222", "host", "ls"],
    {
      destination: "host",
      host: "host",
      port: "2222",
      identityFile: "key",
      remoteCommand: "ls",
    },
  ],
  [["ssh", "-i"], undefined],
  [["ssh", "-p"], undefined],
  [["ssh", "-o"], undefined],
  [["ssh", "-o", ""], undefined],
  [["ssh", "-v"], undefined],
  [["ssh"], undefined],
  [["ssh", ""], undefined],
  [
    ["ssh", "-o", "BatchMode=yes", "host"],
    { destination: "host", host: "host", remoteCommand: "" },
  ],
  [["ssh", "-o", "", "h"], { destination: "h", host: "h", remoteCommand: "" }],
  [
    ["ssh", "-oStrictHostKeyChecking=no", "h"],
    {
      destination: "h",
      host: "h",
      strictHostKeyChecking: "no",
      remoteCommand: "",
    },
  ],
  [
    ["ssh", "-o", "stricthostkeychecking=ask", "h"],
    {
      destination: "h",
      host: "h",
      strictHostKeyChecking: "ask",
      remoteCommand: "",
    },
  ],
  [
    [
      "ssh",
      "-p",
      "22",
      "-i",
      "k",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "StrictHostKeyChecking=no",
      "u@h",
    ],
    {
      destination: "u@h",
      host: "h",
      user: "u",
      port: "22",
      identityFile: "k",
      strictHostKeyChecking: "yes",
      remoteCommand: "",
    },
  ],
  [
    ["ssh", "-p", "", "h"],
    { destination: "h", host: "h", port: "", remoteCommand: "" },
  ],
  [
    ["ssh", "-l", "root", "h"],
    { destination: "h", host: "h", remoteCommand: "" },
  ],
  [
    ["ssh", "@host", "ls"],
    { destination: "@host", host: "@host", remoteCommand: "ls" },
  ],
  [
    ["ssh", "a@b@c", "ls"],
    { destination: "a@b@c", host: "c", user: "a@b", remoteCommand: "ls" },
  ],
  [
    ["ssh", "h", "ls", ">", "out"],
    { destination: "h", host: "h", remoteCommand: "ls > out" },
  ],
  [
    ["ssh", "h", "ls", "2>err", "<in"],
    { destination: "h", host: "h", remoteCommand: "ls" },
  ],
  [["ssh", "h", ">x"], { destination: "h", host: "h", remoteCommand: "" }],
  [
    ["ssh", "h", "ls", "1>"],
    { destination: "h", host: "h", remoteCommand: "ls" },
  ],
  [
    ["ssh", "h", "echo", "a>b"],
    { destination: "h", host: "h", remoteCommand: "echo a>b" },
  ],
  [
    ["/usr/bin/ssh", "h", "ls"],
    { destination: "h", host: "h", remoteCommand: "ls" },
  ],
  [["sudo", "ssh", "h"], { destination: "h", host: "h", remoteCommand: "" }],
];

const CAT_CASES: ReadonlyArray<[string[], string | undefined]> = [
  [["cat"], undefined],
  [["cat", "a"], "a"],
  [["cat", "a", "b"], undefined],
  [["cat", "-n", "a"], "a"],
  [["cat", "--", "a"], "a"],
  [["cat", "$x"], undefined],
  [["/bin/cat", "a"], "a"],
  [["cat", "-"], undefined],
  [["cat", "--", "-"], undefined],
  [["cat", "a*"], undefined],
];

describe("ssh invocation parsing", () => {
  test.each(SSH_CASES)("%p", (tokens, expected) => {
    expect(parseSsh(tokens, findSshIndex(tokens))).toStrictEqual(expected);
  });

  test("findSshIndex matches the basename and returns -1 without ssh", () => {
    expect(findSshIndex(["sudo", "/usr/bin/ssh", "h"])).toBe(1);
    expect(findSshIndex(["scp", "a", "h:b"])).toBe(-1);
    expect(findSshIndex([])).toBe(-1);
  });

  test("record keys keep their insertion order", () => {
    expect(
      Object.keys(
        parseSsh(
          ["ssh", "-oStrictHostKeyChecking=no", "-ik", "-p1", "u@h", "ls"],
          0,
        ) ?? {},
      ),
    ).toEqual([
      "destination",
      "host",
      "user",
      "port",
      "identityFile",
      "strictHostKeyChecking",
      "remoteCommand",
    ]);
  });
});

describe("cat stdin source", () => {
  test.each(CAT_CASES)("%p", (tokens, expected) => {
    expect(catSource(tokens)).toBe(expected);
  });
});

const SSH_BATCH_5_CASES: ReadonlyArray<
  [string[], ReturnType<typeof parseSsh>]
> = [
  [
    ["ssh", "host", "-p", "2222", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "ls" },
  ],
  [
    ["ssh", "host", "-i", "k", "-o", "StrictHostKeyChecking=no", "ls"],
    {
      destination: "host",
      host: "host",
      identityFile: "k",
      strictHostKeyChecking: "no",
      remoteCommand: "ls",
    },
  ],
  [
    ["ssh", "u@h", "-p2222", "-t", "ls", "-p", "1"],
    {
      destination: "u@h",
      host: "h",
      user: "u",
      port: "2222",
      remoteCommand: "ls -p 1",
    },
  ],
  [
    ["ssh", "--", "host", "-p", "2222", "ls"],
    { destination: "host", host: "host", remoteCommand: "-p 2222 ls" },
  ],
  [
    ["ssh", "host", "--", "-p", "2222"],
    { destination: "host", host: "host", remoteCommand: "-p 2222" },
  ],
  [
    ["ssh", "host", "-p", "2222", "--", "-t", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "-t ls" },
  ],
  [
    ["ssh", "--", "host", "--", "ls"],
    { destination: "host", host: "host", remoteCommand: "-- ls" },
  ],
  [
    ["ssh", "-p", "22", "--", "host", "ls"],
    { destination: "host", host: "host", port: "22", remoteCommand: "ls" },
  ],
  [
    ["ssh", "host", "-v"],
    { destination: "host", host: "host", remoteCommand: "" },
  ],
  [
    ["ssh", "host", "-", "ls"],
    { destination: "host", host: "host", remoteCommand: "- ls" },
  ],
];

describe("evidence hardening batch 5", () => {
  test.each(SSH_BATCH_5_CASES)("records each case %p", (tokens, expected) => {
    expect(parseSsh(tokens, findSshIndex(tokens))).toStrictEqual(expected);
  });
});

const SSH_BATCH_16_CASES: ReadonlyArray<
  [string[], ReturnType<typeof parseSsh>]
> = [
  [
    [
      "ssh",
      "-o",
      "StrictHostKeyChecking=no",
      "host",
      "-o",
      "StrictHostKeyChecking=yes",
      "ls",
    ],
    {
      destination: "host",
      host: "host",
      strictHostKeyChecking: "no",
      remoteCommand: "ls",
    },
  ],
  [
    ["ssh", "-p", "2222", "host", "-p", "22", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "ls" },
  ],
  [
    ["ssh", "-i", "real", "host", "-i", "decoy", "ls"],
    {
      destination: "host",
      host: "host",
      identityFile: "real",
      remoteCommand: "ls",
    },
  ],
  [
    ["ssh", "-p", "2222", "-p", "22", "host", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "ls" },
  ],
  [
    ["ssh", "-o", "Port=2222", "-p", "22", "host", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "ls" },
  ],
  [
    ["ssh", "-oPort=2222", "host", "-p", "22", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "ls" },
  ],
  [
    ["ssh", "-o", "Port 2222", "host", "-p", "22", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "ls" },
  ],
  [
    ["ssh", "-o", "port = 2222", "host", "-p", "22", "ls"],
    { destination: "host", host: "host", port: "2222", remoteCommand: "ls" },
  ],
  [
    ["ssh", "-p", "22", "host", "-o", "Port=2222", "ls"],
    { destination: "host", host: "host", port: "22", remoteCommand: "ls" },
  ],
  [
    ["ssh", "-o", "IdentityFile=real", "-i", "decoy", "host", "ls"],
    {
      destination: "host",
      host: "host",
      identityFile: "real",
      remoteCommand: "ls",
    },
  ],
  [
    ["ssh", "-i", "real", "host", "-o", "identityfile decoy", "ls"],
    {
      destination: "host",
      host: "host",
      identityFile: "real",
      remoteCommand: "ls",
    },
  ],
  [
    ["ssh", "-o", "StrictHostKeyChecking no", "host", "ls"],
    {
      destination: "host",
      host: "host",
      strictHostKeyChecking: "no",
      remoteCommand: "ls",
    },
  ],
  [
    [
      "ssh",
      "-o",
      "StrictHostKeyChecking = no",
      "host",
      "-o",
      "StrictHostKeyChecking=yes",
      "ls",
    ],
    {
      destination: "host",
      host: "host",
      strictHostKeyChecking: "no",
      remoteCommand: "ls",
    },
  ],
  [
    ["ssh", "-ostricthostkeychecking=no", "host", "ls"],
    {
      destination: "host",
      host: "host",
      strictHostKeyChecking: "no",
      remoteCommand: "ls",
    },
  ],
  [
    ["ssh", "-o", "Ports=2222", "-o", "Port=", "host", "ls"],
    { destination: "host", host: "host", remoteCommand: "ls" },
  ],
];

describe("evidence hardening batch 16", () => {
  test.each(SSH_BATCH_16_CASES)("records case %#", (tokens, expected) => {
    expect(parseSsh(tokens, findSshIndex(tokens))).toStrictEqual(expected);
  });
});
