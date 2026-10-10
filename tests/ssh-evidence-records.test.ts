import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enrichSshEvidence,
  type SshEnrichmentResult,
} from "../src/ssh-evidence.ts";
import { request } from "./helpers.ts";

let directory = "";

beforeAll(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "approval-reviewer-ssh-records-")),
  );
  await writeFile(join(directory, "p.py"), "print(1)\n");
});

afterAll(async () => {
  await rm(directory, { recursive: true });
});

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function enrich(
  command: string,
  maxChars = 24_000,
): Promise<SshEnrichmentResult> {
  return enrichSshEvidence(
    request({ patterns: [command], metadata: { command } }),
    directory,
    directory,
    maxChars,
  );
}

function signals(executesStdin: boolean): Record<string, boolean> {
  return {
    stagingHint: false,
    productionHint: false,
    executesStdin,
    secretReadHint: false,
    mutationHint: false,
  };
}

const NO_STDIN_SIGNALS = {
  credentialPathReadHint: false,
  environmentEnumerationHint: false,
  networkUploadHint: false,
  dynamicExecutionHint: false,
  fileMutationHint: false,
  databaseMutationHint: false,
  outboundUrls: [],
};

const UNRESOLVED_STDIN = {
  status: "unresolved",
  reason: "pipeline producer is not one regular cat file",
};

function text(records: unknown[]): string {
  return `SSH_ANALYSIS\n${JSON.stringify(records, null, 2)}`;
}

function includedStdin(path: string): Record<string, string | number> {
  return {
    source: "file",
    path,
    status: "included",
    size: 9,
    includedBytes: 9,
    includedSha256: sha("print(1)\n"),
    content: "print(1)\n",
  };
}

describe("ssh evidence records for pipeline producers", () => {
  test.each([
    "echo hi | ssh h 'bash -'",
    "| ssh h 'bash -'",
    "( ) | ssh h 'bash -'",
  ])("%p reports an unresolved stdin", async (command) => {
    expect(await enrich(command)).toStrictEqual({
      text: text([
        {
          kind: "ssh",
          destination: "h",
          host: "h",
          remoteCommand: "bash -",
          remoteCommandSha256: sha("bash -"),
          signals: signals(false),
          stdin: UNRESOLVED_STDIN,
        },
      ]),
      audit: [{ destination: "h", remoteCommandSha256: sha("bash -") }],
    });
  });

  test("a relative stdin after an unresolved cd is unavailable without a read", async () => {
    const stdin = {
      source: "file",
      path: "p.py",
      status: "unavailable",
      reason: "cd target is absent or ambiguous",
    };
    expect(await enrich("cd a b && cat p.py | ssh h 'python -'")).toStrictEqual(
      {
        text: text([
          {
            kind: "ssh",
            destination: "h",
            host: "h",
            remoteCommand: "python -",
            remoteCommandSha256: sha("python -"),
            signals: signals(true),
            stdin,
          },
        ]),
        audit: [
          {
            destination: "h",
            remoteCommandSha256: sha("python -"),
            stdinSource: "p.py",
            stdinStatus: "unavailable",
            stdinReason: "cd target is absent or ambiguous",
          },
        ],
      },
    );
  });

  test.each([
    "( cd a b && cat <dir>/p.py ) | ssh h 'python -'",
    "cd a b && cat <dir>/p.py | ssh h 'python -'",
    "((cat p.py)) | ssh h 'python -'",
  ])("%p reads the producer's file", async (template) => {
    const path = join(directory, "p.py");
    expect(await enrich(template.replace("<dir>", directory))).toStrictEqual({
      text: text([
        {
          kind: "ssh",
          destination: "h",
          host: "h",
          remoteCommand: "python -",
          remoteCommandSha256: sha("python -"),
          signals: signals(true),
          stdinSignals: NO_STDIN_SIGNALS,
          stdin: includedStdin(path),
        },
      ]),
      audit: [
        {
          destination: "h",
          remoteCommandSha256: sha("python -"),
          stdinSource: path,
          stdinStatus: "included",
        },
      ],
    });
  });
});

describe("ssh evidence records and result shape", () => {
  test("an interactive ssh has no remote command digest", async () => {
    expect(await enrich("ssh -p 22 host")).toStrictEqual({
      text: text([
        {
          kind: "ssh",
          destination: "host",
          host: "host",
          port: "22",
          remoteCommand: "<interactive or unspecified>",
          signals: signals(false),
        },
      ]),
      audit: [{ destination: "host", port: "22" }],
    });
  });

  test("missing stdin files each add a denial, joined in command order", async () => {
    const first = join(directory, "m1.py");
    const second = join(directory, "m2.py");
    const result = await enrich(
      `cat ${first} | ssh h 'bash -'; cat ${second} | ssh h 'bash -'`,
    );
    expect(result.preflightDenial).toBe(
      `The file sent over stdin does not exist after a second check: ${first}. Create it and retry the command. The file sent over stdin does not exist after a second check: ${second}. Create it and retry the command.`,
    );
    expect(result.audit.map((entry) => entry.stdinSource)).toEqual([
      first,
      second,
    ]);
  });

  test("the serialized records are cut at maxChars with a marker", async () => {
    const result = await enrich("ssh host uptime", 10);
    const full = text([
      {
        kind: "ssh",
        destination: "host",
        host: "host",
        remoteCommand: "uptime",
        remoteCommandSha256: sha("uptime"),
        signals: signals(false),
      },
    ]).slice("SSH_ANALYSIS\n".length);
    expect(result.text).toBe(
      `SSH_ANALYSIS\n${full.slice(0, 10)}\n<ssh_enrichment_truncated characters="${full.length - 10}" />`,
    );
  });

  test("no record and other permissions give an empty result", async () => {
    expect(await enrich("ssh -i")).toStrictEqual({ text: "", audit: [] });
    expect(
      await enrichSshEvidence(
        request({ permission: "edit", metadata: { command: "ssh host ls" } }),
        directory,
        directory,
        24_000,
      ),
    ).toStrictEqual({ text: "", audit: [] });
  });
});
