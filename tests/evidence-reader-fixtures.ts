import { afterEach, beforeEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { includeEvidenceFile } from "../src/evidence-file-reader.ts";
import type { FileEvidence } from "../src/file-evidence.ts";

export interface ReaderFixture {
  /** The approved root: session directory and worktree at once. */
  directory: string;
  /** A second temp directory outside the approved roots. */
  outside: string;
  read(source: string, maxChars?: number): Promise<FileEvidence>;
  /** Restores the spy after the test. */
  track<T extends { mockRestore(): void }>(spy: T): T;
}

/** Fresh real-path temp directories per test, with spies restored after it. */
export function useReaderFixture(): ReaderFixture {
  const spies: Array<{ mockRestore(): void }> = [];
  const fixture: ReaderFixture = {
    directory: "",
    outside: "",
    read: (source: string, maxChars = 100): Promise<FileEvidence> =>
      includeEvidenceFile(
        source,
        fixture.directory,
        fixture.directory,
        fixture.directory,
        maxChars,
      ),
    track: <T extends { mockRestore(): void }>(spy: T): T => {
      spies.push(spy);
      return spy;
    },
  };
  beforeEach(async () => {
    fixture.directory = await realpath(
      await mkdtemp(join(tmpdir(), "approval-reviewer-reader-")),
    );
    fixture.outside = await realpath(
      await mkdtemp(join(tmpdir(), "approval-reviewer-reader-outside-")),
    );
  });
  afterEach(async () => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    await rm(fixture.directory, { recursive: true });
    await rm(fixture.outside, { recursive: true });
  });
  return fixture;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
