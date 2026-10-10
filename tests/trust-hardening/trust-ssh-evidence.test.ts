import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setGlobalConfigPathForTests } from "../../src/config/loader.ts";
import { includeEvidenceFile } from "../../src/evidence-file-reader.ts";
import { enrichSshEvidence } from "../../src/ssh-evidence.ts";
import { bashRequest, execFileAsync, tempDir } from "./trust-fixtures.ts";

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

describe("trust hardening — ssh stdin resolution after cd", () => {
  test("cd subdir && cat file | ssh resolves the file in subdir, not the initial cwd", async () => {
    const root = tempDir("reviewer-ssh-");
    try {
      mkdirSync(join(root, "subdir"), { recursive: true });
      writeFileSync(join(root, "subdir", "script.sh"), "echo deploy step\n");
      const command =
        "cd subdir && cat script.sh | ssh deploy@prod.invalid 'bash -'";
      const result = await enrichSshEvidence(
        bashRequest(command),
        root,
        root,
        24_000,
      );
      expect(result.preflightDenial).toBeUndefined();
      expect(result.text).toContain('"status": "included"');
      expect(result.text).toContain("script.sh");
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("cd to a directory outside the approved roots never mints a read root", async () => {
    const root = tempDir("reviewer-ssh-");
    const outside = tempDir("reviewer-outside-");
    try {
      writeFileSync(join(outside, "secret.sh"), "echo exfiltrated payload\n");
      const command = `cd ${outside} && cat secret.sh | ssh deploy@prod.invalid 'bash -'`;
      const result = await enrichSshEvidence(
        bashRequest(command),
        root,
        root,
        24_000,
      );
      expect(result.preflightDenial).toBeUndefined();
      expect(result.text).toContain('"status": "blocked"');
      expect(result.text).toContain("outside approved enrichment roots");
      expect(result.text).not.toContain("exfiltrated payload");
    } finally {
      rmSync(root, { recursive: true });
      rmSync(outside, { recursive: true });
    }
  });
});

describe("trust hardening — ssh stdin file evidence resilience", () => {
  test("a FIFO at the stdin path returns quickly instead of blocking the review", async () => {
    const directory = tempDir("reviewer-fifo-");
    try {
      const fifo = join(directory, "pipe");
      await execFileAsync("mkfifo", [fifo]);
      const started = Date.now();
      const result = await includeEvidenceFile(
        fifo,
        directory,
        directory,
        directory,
        10_000,
      );
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result.status).toBe("unavailable");
      expect(result.reason).toContain("not a regular file");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);

  test("a stdin file behind an intermediate directory symlink inside the roots still resolves", async () => {
    const directory = tempDir("reviewer-symdir-");
    try {
      mkdirSync(join(directory, "real"));
      writeFileSync(join(directory, "real", "script.txt"), "echo ok\n");
      await execFileAsync("ln", [
        "-s",
        join(directory, "real"),
        join(directory, "sub"),
      ]);
      const result = await includeEvidenceFile(
        join(directory, "sub", "script.txt"),
        directory,
        directory,
        directory,
        10_000,
      );
      expect(result.status).toBe("included");
      expect(result.content).toContain("echo ok");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
