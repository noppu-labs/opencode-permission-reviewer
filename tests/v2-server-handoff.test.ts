import { expect, test } from "bun:test";
import type { ReviewUiStatus } from "../src/ui-protocol.ts";
import { decision } from "./helpers.ts";
import { until } from "./poll-until.ts";
import { lifecycle } from "./v2-server-fixture.ts";

const { start } = lifecycle();
const JEV = "opencode/jev-1.13-free";
const LUNA = "openai/gpt-6-luna";
const HANDOFF = { from: JEV, to: LUNA, trigger: "jev-escalate" } as const;
const REASONING = {
  model: LUNA,
  variant: "high",
  outputFormat: "json_schema",
  timeoutMs: 120_000,
} as const;
const INERT =
  "systemOneDenialReview is inactive: no escalationReviewer is configured; Jev denials stay final";

function emitted(): {
  statuses: ReviewUiStatus[];
  emit: (name: string, payload: unknown) => Promise<void>;
} {
  const statuses: ReviewUiStatus[] = [];
  return {
    statuses,
    emit: async (_name: string, payload: unknown): Promise<void> => {
      statuses.push((payload as { status: ReviewUiStatus }).status);
    },
  };
}

test("the hand-off status keeps the first start time and names the reasoning reviewer", async () => {
  const events = emitted();
  const harness = await start({
    emit: events.emit,
    handoff: HANDOFF,
    config: { model: JEV, escalationReviewer: REASONING },
    result: {
      kind: "allow",
      reason: "Luna approved.",
      decision: decision("allow"),
      decisionSource: "llm-reviewer",
      reviewerModel: LUNA,
      reviewerEscalatedFrom: {
        model: JEV,
        reason: "Jev escalated.",
        trigger: "jev-escalate",
      },
    },
  });
  await harness.evaluate(harness.input());
  await until(() => events.statuses.length === 3, "three statuses");
  const [first, handoff, final] = events.statuses;
  expect(first).toMatchObject({
    phase: "reviewing",
    model: JEV,
    variant: "system-one",
  });
  expect(handoff).toMatchObject({
    phase: "reviewing",
    model: LUNA,
    variant: "high",
    handoff: HANDOFF,
    emittedAt: first?.emittedAt,
  });
  expect(final).toMatchObject({
    phase: "approved",
    model: LUNA,
    handoff: HANDOFF,
  });
});

test("a manual result carries its resolution and a fail-closed block its disposition", async () => {
  const manualEvents = emitted();
  const manual = await start({
    emit: manualEvents.emit,
    config: { model: JEV, escalationReviewer: REASONING },
    result: {
      kind: "escalate",
      reason: "Both escalated.",
      decisionSource: "llm-reviewer",
      reviewerModel: LUNA,
      resolution: "reasoning-escalated",
      reviewerEscalatedFrom: {
        model: JEV,
        reason: "Jev escalated.",
        trigger: "jev-escalate",
      },
    },
  });
  await manual.evaluate(manual.input());
  await until(() => manualEvents.statuses.length === 2, "manual status");
  expect(manualEvents.statuses[1]).toMatchObject({
    phase: "manual",
    resolution: "reasoning-escalated",
    handoff: HANDOFF,
  });

  const blockedEvents = emitted();
  const blocked = await start({
    emit: blockedEvents.emit,
    result: {
      kind: "deny",
      reason: "Escalation denied by escalationMode.",
      decisionSource: "failure-safe",
      escalationDisposition: "deny",
    },
  });
  await blocked.evaluate(blocked.input());
  await until(() => blockedEvents.statuses.length === 2, "denied status");
  expect(blockedEvents.statuses[1]).toMatchObject({
    phase: "denied",
    escalationDisposition: "deny",
  });
});

test("the status RPC reports config warnings beside the degraded reasons", async () => {
  const warned = await start({ config: { configWarnings: [INERT] } });
  expect(await warned.rpc.status()).toMatchObject({
    configWarnings: [INERT],
    configDegraded: [],
  });
  const healthy = await start();
  expect(await healthy.rpc.status()).toMatchObject({
    configWarnings: [],
    configDegraded: [],
  });
});

test("the status RPC names the configured reasoning reviewer's model", async () => {
  const configured = await start({
    config: { model: JEV, escalationReviewer: REASONING },
  });
  expect(await configured.rpc.status()).toMatchObject({
    escalationReviewerModel: LUNA,
  });
  const none = await start();
  expect((await none.rpc.status()).escalationReviewerModel).toBeUndefined();
});
