import { expect, test } from "bun:test";
import type { ReviewerConfig } from "../src/kernel/reviewer-config.ts";
import type { ReviewUiStatus } from "../src/modules/status/models/ui-protocol.ts";
import { resultDetail } from "../src/ui/attribution.ts";
import { decision, defined } from "./helpers.ts";
import { until } from "./poll-until.ts";
import {
  type FixtureOptions,
  type Input,
  lifecycle,
} from "./v2-server-fixture.ts";

const { start } = lifecycle();
const JEV = "opencode/jev-1.13-free";
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
  options: FixtureOptions,
  input?: (base: Input) => Input,
): Promise<ReviewUiStatus> {
  const statuses: ReviewUiStatus[] = [];
  const harness = await start({
    ...options,
    emit: async (_name: string, payload: unknown): Promise<void> => {
      statuses.push((payload as { status: ReviewUiStatus }).status);
    },
  });
  const base = harness.input();
  await harness.evaluate(input === undefined ? base : input(base));
  await until(
    () => statuses.some((status) => status.phase !== "reviewing"),
    "final status",
  );
  return defined(statuses.at(-1), "final status");
}

test("a review Jev decided alone credits Jev ahead of the reason", async () => {
  const final = await finalStatus({
    config: { model: JEV },
    result: {
      kind: "allow",
      reason: "Read-only command.",
      decision: decision("allow"),
      decisionSource: "system-one-reviewer",
      reviewerModel: JEV,
    },
  });
  expect(final.phase).toBe("approved");
  expect(final.decidedBy).toBe(JEV);
  expect(resultDetail(final)).toBe("jev-1.13-free — Read-only command.");
});

test("a reviewer result without a recorded model credits the configured one", async () => {
  const final = await finalStatus({ config: { model: LUNA } });
  expect(final.decidedBy).toBe(LUNA);
  expect(resultDetail(final)).toBe("gpt-6-luna — Fixture decision");
});

test.each<[string, FixtureOptions, ((base: Input) => Input) | undefined]>([
  [
    "the emergency brake",
    { config: { model: JEV } },
    (base: Input): Input => ({ ...base, metadata: { command: "rm -rf /" } }),
  ],
  [
    "a deterministic policy",
    { config: { model: JEV, ...DENY_ALL } },
    undefined,
  ],
  [
    "a context failure",
    { config: { model: JEV }, contextError: new Error("context unavailable") },
    undefined,
  ],
  [
    "a host connection failure",
    { config: { model: JEV }, connectionError: true },
    undefined,
  ],
])(
  "%s credits no model and shows the reason alone",
  async (_name, options, input) => {
    const final = await finalStatus(options, input);
    expect(final.phase).not.toBe("approved");
    expect(final.decidedBy).toBeUndefined();
    expect(final.reason).toBeTruthy();
    expect(resultDetail(final)).toBe(final.reason);
  },
);
