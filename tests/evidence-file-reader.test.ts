import { describe, expect, spyOn, test } from "bun:test";
import { constants } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileEvidence } from "../src/file-evidence.ts";
import { useReaderFixture } from "./evidence-reader-fixtures.ts";

const fixture = useReaderFixture();

function blocked(source: string, reason: string): FileEvidence {
  return {
    source: "file",
    path: join(fixture.directory, source),
    status: "blocked",
    reason,
  };
}

function stubDescriptorPath(path: string): void {
  fixture.track(
    spyOn(fsPromises, "readlink").mockImplementation(
      (async () => path) as unknown as typeof fsPromises.readlink,
    ),
  );
}

describe("evidence file reads: path checks", () => {
  test("a symlink inside the roots to a sensitive file is blocked after realpath", async () => {
    await writeFile(join(fixture.directory, ".env"), "A=1\n");
    await symlink(
      join(fixture.directory, ".env"),
      join(fixture.directory, "script.py"),
    );
    expect(await fixture.read("script.py")).toStrictEqual(
      blocked("script.py", "sensitive resolved path"),
    );
  });

  test("a sensitive path is blocked before any filesystem call", async () => {
    const realpathSpy = fixture.track(spyOn(fsPromises, "realpath"));
    expect(await fixture.read(".ssh/config")).toStrictEqual(
      blocked(".ssh/config", "sensitive path"),
    );
    expect(realpathSpy).not.toHaveBeenCalled();
  });

  test("a file outside the roots is blocked", async () => {
    const path = join(fixture.outside, "x.py");
    await writeFile(path, "print(1)\n");
    expect(await fixture.read(path)).toStrictEqual({
      source: "file",
      path,
      status: "blocked",
      reason: "outside approved enrichment roots",
    });
  });

  test("a directory is not a regular file", async () => {
    await mkdir(join(fixture.directory, "sub"));
    expect(await fixture.read("sub")).toStrictEqual({
      source: "file",
      path: join(fixture.directory, "sub"),
      status: "unavailable",
      reason: "not a regular file",
    });
  });

  test("the source is resolved, the roots are resolved, then the file is opened without following links", async () => {
    const path = join(fixture.directory, "a.py");
    await writeFile(path, "print(1)\n");
    const realpathSpy = fixture.track(spyOn(fsPromises, "realpath"));
    const openSpy = fixture.track(spyOn(fsPromises, "open"));
    const readlinkSpy = fixture.track(spyOn(fsPromises, "readlink"));
    await fixture.read("a.py");
    expect(realpathSpy.mock.calls.map(([target]) => target)).toEqual([
      path,
      fixture.directory,
      fixture.directory,
    ]);
    expect(openSpy.mock.calls).toEqual([
      [path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK],
    ]);
    expect(readlinkSpy.mock.calls).toHaveLength(1);
    expect(String(readlinkSpy.mock.calls[0]?.[0])).toMatch(
      /^\/proc\/self\/fd\/\d+$/,
    );
  });

  test("an in-root symlink opens its realpath target and reports the requested path", async () => {
    const target = join(fixture.directory, "real.py");
    await writeFile(target, "print(1)\n");
    await symlink(target, join(fixture.directory, "script.py"));
    const openSpy = fixture.track(spyOn(fsPromises, "open"));
    const result = await fixture.read("script.py");
    expect(openSpy.mock.calls).toEqual([
      [
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      ],
    ]);
    expect(result.status).toBe("included");
    expect(result.path).toBe(join(fixture.directory, "script.py"));
  });
});

describe("evidence file reads: descriptor realpath checks", () => {
  test("a descriptor resolving outside the roots is blocked", async () => {
    await writeFile(join(fixture.directory, "a.py"), "print(1)\n");
    const escaped = join(fixture.outside, "a.py");
    stubDescriptorPath(escaped);
    expect(await fixture.read("a.py")).toStrictEqual(
      blocked(
        "a.py",
        `open descriptor resolves outside approved enrichment roots (${escaped})`,
      ),
    );
  });

  test("a descriptor resolving to a sensitive path is blocked", async () => {
    await writeFile(join(fixture.directory, "a.py"), "print(1)\n");
    stubDescriptorPath(join(fixture.directory, ".aws", "credentials"));
    expect(await fixture.read("a.py")).toStrictEqual(
      blocked("a.py", "sensitive resolved path"),
    );
  });

  test("a descriptor resolving inside the roots is read", async () => {
    await writeFile(join(fixture.directory, "a.py"), "print(1)\n");
    stubDescriptorPath(join(fixture.directory, "a.py"));
    expect((await fixture.read("a.py")).status).toBe("included");
  });
});
