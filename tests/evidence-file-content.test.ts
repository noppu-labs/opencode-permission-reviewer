import { describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileEvidence } from "../src/evidence-file-reader.ts";
import { sha256Hex, useReaderFixture } from "./evidence-reader-fixtures.ts";

const fixture = useReaderFixture();

function shortReads(bytes: number): void {
  const realOpen = fsPromises.open;
  fixture.track(
    spyOn(fsPromises, "open").mockImplementation((async (
      ...args: Parameters<typeof fsPromises.open>
    ) => {
      const handle = await realOpen(...args);
      const realRead = handle.read.bind(handle);
      let calls = 0;
      handle.read = (async (buffer: Buffer, offset: number) => {
        calls += 1;
        return calls === 1
          ? realRead(buffer, offset, bytes, 0)
          : { bytesRead: 0, buffer };
      }) as unknown as typeof handle.read;
      return handle;
    }) as unknown as typeof fsPromises.open),
  );
}

function truncated(size: number, content: string): FileEvidence {
  return {
    source: "file",
    path: join(fixture.directory, "a.py"),
    status: "truncated",
    size,
    includedBytes: content.length,
    includedSha256: sha256Hex(content),
    content,
  };
}

describe("evidence file reads: content checks", () => {
  test("maxChars below one still reads one byte", async () => {
    await writeFile(join(fixture.directory, "a.py"), "ab");
    expect(await fixture.read("a.py", 0)).toStrictEqual(truncated(2, "a"));
  });

  test("a file that ends early is reported truncated", async () => {
    await writeFile(join(fixture.directory, "a.py"), "abcdef");
    shortReads(3);
    expect(await fixture.read("a.py")).toStrictEqual(truncated(6, "abc"));
  });

  test("more than two replacement characters in short content count as binary", async () => {
    await writeFile(
      join(fixture.directory, "three.py"),
      Buffer.from([0x61, 0xff, 0x62, 0xfe, 0x63, 0xfd]),
    );
    await writeFile(
      join(fixture.directory, "two.py"),
      Buffer.from([0x61, 0xff, 0x62, 0xfe, 0x63]),
    );
    expect(await fixture.read("three.py")).toStrictEqual({
      source: "file",
      path: join(fixture.directory, "three.py"),
      status: "blocked",
      reason: "binary or non-text content",
      size: 6,
    });
    expect((await fixture.read("two.py")).status).toBe("included");
  });

  test("a non-Error rejection is reported through String()", async () => {
    fixture.track(
      spyOn(fsPromises, "realpath").mockImplementation((async () => {
        throw "plain failure";
      }) as unknown as typeof fsPromises.realpath),
    );
    expect(await fixture.read("a.py")).toStrictEqual({
      source: "file",
      path: join(fixture.directory, "a.py"),
      status: "unavailable",
      reason: "plain failure",
    });
  });

  test("a missing file reports the absolute source as given, or the resolved relative one", async () => {
    const absolute = await fixture.read(`${fixture.directory}/./gone.py`);
    expect(absolute.path).toBe(`${fixture.directory}/./gone.py`);
    expect(absolute.status).toBe("unavailable");
    expect(absolute.reason).toContain("ENOENT");
    expect((await fixture.read("gone.py")).path).toBe(
      join(fixture.directory, "gone.py"),
    );
  });
});
