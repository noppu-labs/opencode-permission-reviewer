import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  COVERAGE,
  expectedText,
  manifestFixture,
  PREFIX,
  packageEvidence,
  type RecordFields,
  requested,
} from "./package-script-fixtures.ts";

const CHAIN = Array.from({ length: 20 }, (_, i) => `bun run s${i + 1}`).join(
  " && ",
);
const STEPS = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [`s${i + 1}`, `printf ${i + 1}`]),
);
const LONG = `printf ${"x".repeat(3000)}`;
const FALLBACK = `${PREFIX}{"status":"truncated","reason":"script evidence exceeded the character budget"}`;

async function budgetFixture(): Promise<string> {
  const directory = await manifestFixture(
    JSON.stringify({
      scripts: {
        ...STEPS,
        all: CHAIN,
        go: "node ./ref.js && bun run never",
        prego: CHAIN,
        never: "printf never",
        check: "printf ok",
        a: "printf aaaa",
        b: "printf bbbb",
        two: "bun run a && bun run b",
        long: LONG,
      },
    }),
  );
  await writeFile(join(directory, "ref.js"), 'console.log("ref")\n');
  return directory;
}

function parsed(text: string): { records: RecordFields[] } {
  return JSON.parse(text.slice(PREFIX.length));
}

/** The top-level fields, with each record as `script:phase:status`. */
function summary(text: string): RecordFields {
  const { records, ...rest } = parsed(text);
  return {
    ...rest,
    records: records.map(
      (record) => `${record.script}:${record.phase}:${record.status}`,
    ),
  };
}

function steps(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `s${i + 1}:requested:included`,
  );
}

function included(
  directory: string,
  script: string,
  command: string,
): RecordFields {
  return {
    ...requested(script),
    directory,
    manifest: join(directory, "package.json"),
    command,
    status: "included",
  };
}

test("expansion stops at sixteen records and flags the limit", async () => {
  const directory = await budgetFixture();
  expect(summary(await packageEvidence(directory, "npm run all"))).toEqual({
    coverage: COVERAGE,
    status: "partial",
    expansionLimitReached: true,
    records: ["all:requested:included", ...steps(15)],
  });
});

test("a pre hook that fills the budget skips the parent's referenced code and child calls", async () => {
  const directory = await budgetFixture();
  const text = await packageEvidence(directory, "npm run go");
  expect(summary(text)).toEqual({
    coverage: COVERAGE,
    status: "partial",
    expansionLimitReached: true,
    records: [
      "go:requested:included",
      "prego:conditional-pre:included",
      ...steps(14),
    ],
  });
  expect(Object.keys(parsed(text).records[0] ?? {})).toEqual([
    "manager",
    "script",
    "arguments",
    "phase",
    "directory",
    "manifest",
    "command",
    "status",
  ]);
});

test("whole records are dropped first, at the exact character boundary", async () => {
  const directory = await budgetFixture();
  const dropped = expectedText([
    {
      ...included(directory, "two", "bun run a && bun run b"),
      status: "truncated",
      reason: "additional script evidence exceeded the character budget",
    },
  ]);
  const budget = dropped.length - PREFIX.length;
  expect(await packageEvidence(directory, "npm run two", budget)).toBe(dropped);
  expect(await packageEvidence(directory, "npm run two", budget - 1)).toBe(
    expectedText([
      {
        ...included(directory, "two", ""),
        status: "truncated",
        reason: "script evidence exceeded the character budget",
      },
    ]),
  );
});

test("a single oversized record keeps the first maxChars - 1000 command characters", async () => {
  const directory = await budgetFixture();
  expect(await packageEvidence(directory, "npm run long", 2500)).toBe(
    expectedText([
      {
        ...included(directory, "long", LONG.slice(0, 1500)),
        status: "truncated",
        reason: "script evidence exceeded the character budget",
      },
    ]),
  );
});

test("evidence that still does not fit becomes the fixed truncation object", async () => {
  const directory = await budgetFixture();
  expect(await packageEvidence(directory, "npm run check", 50)).toBe(FALLBACK);
  expect(
    await packageEvidence(
      directory,
      `cd "$X" && npm run check ${"y".repeat(300)}`,
      400,
    ),
  ).toBe(FALLBACK);
});
