import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../src/is-record.ts";
import {
  decodeUiStatus,
  encodeUiStatus,
  type ReviewUiStatus,
} from "../src/ui-protocol.ts";
import { parseUiStatus } from "../src/ui-status-parse.ts";
import { FIND_COMMAND, FIND_SEGMENTS } from "./action-fixtures.ts";
import { decision, MockClient, request, runtime } from "./helpers.ts";
import { until } from "./poll-until.ts";
import { fixture } from "./v2-server-fixture.ts";

const ROOT = join(import.meta.dir, "..");

test("v1 publishes the bash command's segments on every status", async () => {
  const client = new MockClient();
  client.createError = { message: "create failed" };
  const harness = runtime(client);
  await harness.runtime.process(
    request({ metadata: { command: FIND_COMMAND } }),
  );
  expect(client.uiStatuses[0]?.phase).toBe("reviewing");
  expect(client.uiStatuses.length).toBeGreaterThan(1);
  for (const status of client.uiStatuses)
    expect(decodeUiStatus(encodeUiStatus(status))?.actionSegments).toEqual(
      FIND_SEGMENTS,
    );
});

test("v2 publishes the bash command's segments on every status", async () => {
  const statuses: (ReviewUiStatus | undefined)[] = [];
  const harness = await fixture({
    result: {
      kind: "allow",
      reason: "Fixture outcome",
      decision: decision("allow"),
      decisionSource: "llm-reviewer",
    },
    emit: async (_name: string, payload: unknown): Promise<void> => {
      statuses.push(
        isRecord(payload) ? parseUiStatus(payload.status) : undefined,
      );
    },
  });
  try {
    await harness.evaluate({
      ...harness.input(),
      metadata: { command: FIND_COMMAND },
    });
    await until(
      () => statuses.some((status) => status?.phase !== "reviewing"),
      "the final UI status",
    );
    expect(statuses[0]?.phase).toBe("reviewing");
    for (const status of statuses) {
      expect(status).toBeDefined();
      expect(status?.actionSegments).toEqual(FIND_SEGMENTS);
    }
  } finally {
    await harness.cleanup();
  }
});

test("server code builds every status through createServerUiStatus", () => {
  const call = /^(?!\s*(?:\/\/|\*)).*\bcreateUiStatus\(/m;
  const callers = Array.from(
    new Bun.Glob("src/**/*.{ts,tsx}").scanSync({ cwd: ROOT }),
  )
    .filter((file) => call.test(readFileSync(join(ROOT, file), "utf8")))
    .sort();
  expect(callers).toEqual([
    "src/ui-action-segments.ts",
    "src/ui-protocol.ts",
    "src/ui-state.ts",
  ]);
});
