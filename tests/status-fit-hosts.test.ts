import { expect, test } from "bun:test";
import {
  decodeUiStatus,
  encodeUiStatus,
  type ReviewUiStatus,
} from "../src/modules/status/models/ui-protocol.ts";
import { parseUiStatus } from "../src/modules/status/services/ui-status-parse.ts";
import { isRecord } from "../src/utils/is-record.ts";
import { decision, MockClient, request, runtime } from "./helpers.ts";
import { until } from "./poll-until.ts";
import { fixture } from "./v2-server-fixture.ts";

/** JSON escapes each of these characters to six bytes. */
const ESCAPED_TEXT = "\u0001".repeat(2_000);

function expectEveryStatusDecodes(
  statuses: readonly (ReviewUiStatus | undefined)[],
): void {
  for (const status of statuses) {
    expect(status).toBeDefined();
    if (status) expect(decodeUiStatus(encodeUiStatus(status))).toEqual(status);
  }
}

test("v1 publishes a decodable status for a rationale of 2000 escaped characters", async () => {
  const client = new MockClient();
  client.nextStructured = decision("deny", { rationale: ESCAPED_TEXT });
  const harness = runtime(client);
  await harness.runtime.process(request());
  const final = client.uiStatuses.at(-1);
  expect(final?.phase).toBe("denied");
  expect(final?.decision?.rationale).toBe("…");
  expect(final?.reason).toEndWith("…");
  expectEveryStatusDecodes(client.uiStatuses);
});

test("v2 publishes a decodable status for a reason and rationale of 2000 escaped characters", async () => {
  const statuses: (ReviewUiStatus | undefined)[] = [];
  const harness = await fixture({
    result: {
      kind: "deny",
      reason: ESCAPED_TEXT,
      decision: decision("deny", { rationale: ESCAPED_TEXT }),
      decisionSource: "llm-reviewer",
    },
    emit: async (_name: string, payload: unknown): Promise<void> => {
      statuses.push(
        isRecord(payload) ? parseUiStatus(payload.status) : undefined,
      );
    },
  });
  try {
    await harness.evaluate(harness.input());
    await until(
      () => statuses.some((status) => status?.phase === "denied"),
      "the final UI status",
    );
    expect(statuses.at(-1)?.decision?.rationale).toBe("…");
    expect(statuses.at(-1)?.reason).toEndWith("…");
    expectEveryStatusDecodes(statuses);
  } finally {
    await harness.cleanup();
  }
});
