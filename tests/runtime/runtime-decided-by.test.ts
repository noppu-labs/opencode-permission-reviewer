import { expect, test } from "bun:test";
import type { ReviewerConfig } from "../../src/types.ts";
import { resultDetail } from "../../src/ui/attribution.ts";
import type { ReviewUiStatus } from "../../src/ui-protocol.ts";
import { defined, MockClient, request, runtime } from "../helpers.ts";

const LUNA = "openai/gpt-6-luna";
const DENY_ALL: Partial<ReviewerConfig> = {
  enforcementMode: "enforce",
  policyRules: [
    {
      id: "always-deny",
      source: "global",
      effect: "deny",
      reason: "rule says deny",
      when: { always: true },
    },
  ],
};

async function finalStatus(
  client: MockClient,
  overrides: Partial<ReviewerConfig> = {},
  pending = request(),
): Promise<ReviewUiStatus> {
  const harness = runtime(client, { model: LUNA, ...overrides });
  harness.runtime.handle(pending);
  await harness.runtime.waitForIdle();
  return defined(client.uiStatuses.at(-1), "final status");
}

test("a model-decided review credits the model ahead of the reason", async () => {
  const final = await finalStatus(new MockClient());
  expect(final.phase).toBe("approved");
  expect(final.decidedBy).toBe(LUNA);
  expect(resultDetail(final)).toBe(`gpt-6-luna — ${final.reason}`);
});

function failingContext(): MockClient {
  const client = new MockClient();
  client.messagesError = { message: "database unavailable" };
  return client;
}

test.each<
  [
    string,
    MockClient,
    Partial<ReviewerConfig>,
    string | undefined,
    ReviewUiStatus["phase"],
  ]
>([
  ["the emergency brake", new MockClient(), {}, "rm -rf /", "denied"],
  ["a deterministic policy", new MockClient(), DENY_ALL, undefined, "denied"],
  ["a context failure", failingContext(), {}, undefined, "manual"],
])(
  "%s credits no model and shows the reason alone",
  async (_name, client, overrides, command, phase) => {
    const pending =
      command === undefined ? request() : request({ metadata: { command } });
    const final = await finalStatus(client, overrides, pending);
    expect(final.phase).toBe(phase);
    expect(final.decidedBy).toBeUndefined();
    expect(final.reason).toBeTruthy();
    expect(resultDetail(final)).toBe(final.reason);
  },
);
