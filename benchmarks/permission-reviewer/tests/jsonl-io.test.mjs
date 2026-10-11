import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readJSONL } from "../lib/util.mjs";

async function withFile(text, check) {
  const dir = await mkdtemp(join(tmpdir(), "prb-jsonl-"));
  const path = join(dir, "rows.jsonl");
  try {
    await writeFile(path, text);
    await check(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const invalidAt = (path, line) => (error) => {
  assert(error.message.startsWith(`${path}:${line}: invalid JSON (`));
  assert(error.message.endsWith(")"));
  assert(error.cause instanceof SyntaxError);
  assert(error.message.includes(error.cause.message));
  return true;
};

test("JSONL reading skips blank lines and returns the whole text as valid", async () => {
  const text = '{"a":1}\n\n  \n{"b":2}\n';
  await withFile(text, async (path) => {
    assert.deepEqual(await readJSONL(path), {
      rows: [{ a: 1 }, { b: 2 }],
      truncatedBytes: 0,
      validText: text,
    });
    assert.deepEqual(await readJSONL(path, { recoverTail: true }), {
      rows: [{ a: 1 }, { b: 2 }],
      truncatedBytes: 0,
      validText: text,
    });
  });
});

test("JSONL reading names the file and line of an invalid row", async () => {
  await withFile('{"a":1}\n{bad\n{"b":2}\n', async (path) => {
    await assert.rejects(readJSONL(path), invalidAt(path, 2));
    await assert.rejects(
      readJSONL(path, { recoverTail: true }),
      invalidAt(path, 2),
    );
  });
});

test("only a truncated final row without a newline is recovered, and only on request", async () => {
  await withFile('{"a":1}\n{"b":2}\n{"c":"é', async (path) => {
    await assert.rejects(readJSONL(path), invalidAt(path, 3));
    assert.deepEqual(await readJSONL(path, { recoverTail: true }), {
      rows: [{ a: 1 }, { b: 2 }],
      truncatedBytes: Buffer.byteLength('{"c":"é'),
      validText: '{"a":1}\n{"b":2}\n',
    });
  });
  await withFile('{"a":1}\n{bad\n', async (path) => {
    await assert.rejects(
      readJSONL(path, { recoverTail: true }),
      invalidAt(path, 2),
    );
  });
});

test("a file holding only a truncated row recovers to empty text", async () => {
  await withFile('{"a":', async (path) => {
    assert.deepEqual(await readJSONL(path, { recoverTail: true }), {
      rows: [],
      truncatedBytes: 5,
      validText: "",
    });
  });
});
