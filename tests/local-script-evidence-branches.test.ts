import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichLocalScriptEvidence } from "../src/local-script-evidence.ts";
import { request } from "./helpers.ts";

const directories: string[] = [];

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "local-script-branches-"));
  directories.push(directory);
  await writeFile(join(directory, "a.js"), 'console.log("js sentinel")\n');
  await writeFile(join(directory, "a.py"), 'print("py sentinel")\n');
  await writeFile(join(directory, "--"), "echo dashdash sentinel\n");
  await writeFile(join(directory, "a*.js"), 'console.log("glob sentinel")\n');
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function evidence(
  directory: string,
  command: string,
  maxChars = 8000,
): Promise<string> {
  return (
    await enrichLocalScriptEvidence(
      request({ metadata: { command }, patterns: [command] }),
      directory,
      directory,
      maxChars,
    )
  ).text;
}

function records(text: string): Array<Record<string, unknown>> {
  return JSON.parse(text.slice("LOCAL_SCRIPT_ANALYSIS\n".length));
}

/** The path, status and content of the only record in `text`. */
function onlyRecord(text: string): [unknown, unknown, string, number] {
  const [record, ...rest] = records(text);
  return [record?.path, record?.status, String(record?.content), rest.length];
}

const UNRESOLVED_RECORD = {
  kind: "local_script",
  interpreter: "node",
  path: "./a.js",
  status: "unavailable",
  reason: "cd target contains unresolved shell expansion",
};
const UNRESOLVED_TEXT = `LOCAL_SCRIPT_ANALYSIS\n${JSON.stringify([UNRESOLVED_RECORD], null, 2)}`;

test.each([
  "python -V ./a.py",
  "python3 -V ./a.py",
  "node - ./a.js",
  "node -- - ./a.js",
  "bun run run ./a.js",
  "node './a*.js'",
])("%p gathers nothing", async (command) => {
  const directory = await fixture();
  expect(await evidence(directory, command)).toBe("");
});

test.each([
  ["node -- -- ./a.js", "--", "dashdash sentinel"],
  ["python -W ignore ./a.py", "a.py", "py sentinel"],
  ["node -r ./a.py ./a.js", "a.js", "js sentinel"],
])("%p reads only %p", async (command, file, sentinel) => {
  const directory = await fixture();
  const [path, status, content, others] = onlyRecord(
    await evidence(directory, command),
  );
  expect([path, status, others]).toEqual([
    join(directory, file),
    "included",
    0,
  ]);
  expect(content).toContain(sentinel);
});

test("an unresolved working directory reports a relative script without reading it", async () => {
  const directory = await fixture();
  expect(await evidence(directory, 'cd "$X" && node ./a.js')).toBe(
    UNRESOLVED_TEXT,
  );
});

test("an unresolved working directory still reads an absolute script against the session directory", async () => {
  const directory = await fixture();
  const [path, status, content, others] = onlyRecord(
    await evidence(directory, `cd "$X" && node ${join(directory, "a.js")}`),
  );
  expect([path, status, others]).toEqual([
    join(directory, "a.js"),
    "included",
    0,
  ]);
  expect(content).toContain("js sentinel");
});

test("the same interpreter and resolved script is recorded once, including the unresolved key", async () => {
  const directory = await fixture();
  const resolved = records(await evidence(directory, "node ./a.js; node a.js"));
  expect(resolved.map((record) => record.path)).toEqual([
    join(directory, "a.js"),
  ]);
  expect(await evidence(directory, 'cd "$X" && node ./a.js; node ./a.js')).toBe(
    UNRESOLVED_TEXT,
  );
});

test("serialized records over maxChars are cut with the exact truncation marker", async () => {
  const directory = await fixture();
  const serialized = JSON.stringify([UNRESOLVED_RECORD], null, 2);
  expect(await evidence(directory, 'cd "$X" && node ./a.js', 50)).toBe(
    `LOCAL_SCRIPT_ANALYSIS\n${serialized.slice(0, 50)}\n<local_script_enrichment_truncated characters="${serialized.length - 50}" />`,
  );
});
