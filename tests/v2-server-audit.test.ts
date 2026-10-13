import { expect, test } from "bun:test";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../src/types.ts";
import { config, decision, defined, systemOneScores } from "./helpers.ts";
import { until } from "./poll-until.ts";
import { lifecycle } from "./v2-server-fixture.ts";

const { start, held, release } = lifecycle();

const AUDIT_KEYS = [
  "schemaVersion",
  "decisionSchemaVersion",
  "pluginVersion",
  "promptVersion",
  "reviewerModel",
  "reviewerEscalatedFrom",
  "systemOne",
  "effectiveConfigHash",
  "configWarnings",
  "actionFingerprint",
  "reviewID",
  "requestID",
  "hostGeneration",
  "hostVersion",
  "generation",
  "directory",
  "nativeAction",
  "sessionID",
  "permission",
  "timestamp",
  "durationMs",
  "outcome",
  "reason",
  "decisionSource",
  "reviewerOutcome",
  "riskLevel",
  "userAuthorization",
  "scopeAlignment",
  "confidence",
  "escalationDisposition",
  "resolution",
  "policyTrace",
  "evidenceCompleteness",
  "warnings",
  "ssh",
  "verifiedScript",
  "askDecisions",
  "rootSessionID",
  "actor",
  "application",
  "reviewerSessionID",
  "timings",
];

const OPTIONAL_RESULT_KEYS = [
  "reviewerEscalatedFrom",
  "systemOne",
  "escalationDisposition",
  "resolution",
  "configWarnings",
  "reviewerSessionID",
];

/** Adds the evidence groups the fixture's providers never produce, as a
 *  reviewer backend would see them on the envelope. */
function enrichEvidence(script: {
  bytes?: number;
}): (evidence: ReviewEnvelope) => void {
  return (evidence: ReviewEnvelope): void => {
    evidence.verifiedScript = {
      sha256: "a".repeat(64),
      destination: "host.invalid",
      shell: "sh",
      ...script,
      status: "full",
      text: "printf safe",
    };
    evidence.sshAudit = [{ destination: "host.invalid" }];
    evidence.askDecisions = Array.from({ length: 6 }, (_, index) => ({
      at: index,
      sessionID: "ses_main",
      question: `Question ${index}`,
      answer: `Answer ${index}`,
    }));
    const actor = defined(evidence.actor, "actor");
    actor.agentName = { ...actor.agentName, value: "build" };
  };
}

test("v2 audit records keep every field group in their key order", async () => {
  const harness = await start({
    config: { configWarnings: ["fixture warning"] },
    result: {
      kind: "allow",
      reason: "Fixture outcome",
      decision: decision("allow"),
      decisionSource: "llm-reviewer",
      reviewSessionID: "ses_review",
      reviewerModel: "openai/escalated",
      reviewerEscalatedFrom: {
        model: "opencode/jev-1.13-free",
        reason: "Jev was unsure.",
        trigger: "jev-uncertain-allow",
      },
      systemOne: systemOneScores(),
      escalationDisposition: "manual",
      resolution: "reasoning-escalated",
    },
    inspect: enrichEvidence({ bytes: 12 }),
  });
  await harness.evaluate(harness.input());
  await harness.dispose();
  const [record] = await harness.records();
  expect(Object.keys(defined(record, "audit record"))).toEqual(AUDIT_KEYS);
  expect(record).toMatchObject({
    nativeAction: "shell",
    permission: "bash",
    outcome: "allow",
    application: "evaluation-returned",
    reviewerSessionID: "ses_review",
    escalationDisposition: "manual",
    configWarnings: ["fixture warning"],
    resolution: "reasoning-escalated",
    reviewerEscalatedFrom: { trigger: "jev-uncertain-allow" },
    ssh: [{ destination: "host.invalid" }],
    verifiedScript: { sha256: "a".repeat(64), status: "full", bytes: 12 },
    rootSessionID: "ses_main",
  });
  expect(Object.keys(defined(record?.actor, "actor") as object)).toEqual([
    "name",
    "profile",
    "identityCompleteness",
    "identitySource",
    "confidence",
    "delegationDepth",
  ]);
  expect(record?.askDecisions).toEqual(
    [1, 2, 3, 4, 5].map((at) => ({
      at,
      question: `Question ${at}`,
      answer: `Answer ${at}`,
    })),
  );
  expect(String(record?.actionFingerprint)).toMatch(/^v2:[0-9a-f]{64}$/);
});

test("v2 audit records omit absent optional groups and a verified script's missing byte count", async () => {
  const harness = await start({ inspect: enrichEvidence({}) });
  await harness.evaluate(harness.input());
  await harness.dispose();
  const [record] = await harness.records();
  expect(Object.keys(defined(record, "audit record"))).toEqual(
    AUDIT_KEYS.filter((key) => !OPTIONAL_RESULT_KEYS.includes(key)),
  );
  expect(record?.reviewerModel).toBe(config().model);
  expect(record?.verifiedScript).toEqual({
    sha256: "a".repeat(64),
    status: "full",
  });
});

test.each([
  {
    model: "openai/gpt-6-luna",
    backend: "v2-isolated-session",
    outputFormat: config().outputFormat,
    variant: config().variant,
    structured: true,
  },
  {
    model: "opencode/jev-1.13-free",
    backend: "system-one",
    outputFormat: "system_one",
    variant: "system-one",
    structured: false,
  },
])(
  "v2 status and snapshot keep their key order and report the $backend backend",
  async ({ model, structured, ...expected }) => {
    const harness = await start({ config: { model } });
    const status = await harness.rpc.status();
    expect(Object.keys(status)).toEqual([
      "host",
      "hostVersion",
      "generation",
      "directory",
      "adapter",
      "backend",
      "active",
      "pending",
      "revision",
      "outputFormat",
      "model",
      "variant",
      "configDegraded",
      "configWarnings",
      "effectiveConfigHash",
      "connection",
      "eventConnection",
      "capabilities",
    ]);
    expect(status).toMatchObject({
      ...expected,
      adapter: "permission.evaluate",
      active: true,
      pending: 0,
      revision: 0,
      model,
      configDegraded: [],
      connection: "not-probed",
      eventConnection: "connected",
      capabilities: {
        structuredTool: structured,
        text: structured,
        retention: structured,
        nativeJsonSchema: false,
      },
    });
    expect(Object.keys(await harness.rpc.snapshot())).toEqual([
      "generation",
      "revision",
      "directory",
      "reviews",
    ]);
  },
);

const escalationReviewer: Partial<ReviewerConfig> = {
  escalationReviewer: {
    model: "openai/escalated",
    variant: "high",
    outputFormat: config().outputFormat,
    timeoutMs: 5000,
  },
};

test.each([
  {
    title: "the configured variant",
    model: "openai/gpt-6-luna",
    escalation: {},
    result: {},
    reviewer: "openai/gpt-6-luna",
    variant: config().variant,
  },
  {
    title: "the configured variant for the configured reviewer",
    model: "openai/gpt-6-luna",
    escalation: {},
    result: { reviewerModel: "openai/gpt-6-luna" },
    reviewer: "openai/gpt-6-luna",
    variant: config().variant,
  },
  {
    title: "the escalation reviewer's variant",
    model: "opencode/jev-1.13-free",
    escalation: escalationReviewer,
    result: { reviewerModel: "openai/escalated" },
    reviewer: "openai/escalated",
    variant: "high",
  },
  {
    title: "the configured variant without an escalation reviewer",
    model: "opencode/jev-1.13-free",
    escalation: {},
    result: { reviewerModel: "openai/escalated" },
    reviewer: "openai/escalated",
    variant: config().variant,
  },
  {
    title: "the System One variant",
    model: "opencode/jev-1.13-free",
    escalation: {},
    result: {},
    reviewer: "opencode/jev-1.13-free",
    variant: "system-one",
  },
])(
  "v2 final UI status names $title",
  async ({ model, escalation, result, reviewer, variant }) => {
    const denied: ReviewExecutionResult = {
      kind: "deny",
      reason: "Fixture deny",
      decision: decision("deny"),
      decisionSource: "llm-reviewer",
      ...result,
    };
    const harness = await start({
      config: { model, ...escalation },
      result: denied,
    });
    await harness.evaluate(harness.input());
    await until(
      async () =>
        (
          (await harness.rpc.snapshot()).reviews[0] as
            | { phase?: string }
            | undefined
        )?.phase !== "reviewing",
      "the final UI status",
    );
    const [status] = (await harness.rpc.snapshot()).reviews;
    expect(status).toMatchObject({
      phase: "denied",
      model: reviewer,
      variant,
      reason: "Fixture deny",
      decision: decision("deny"),
    });
  },
);

test("v2 reviews deny an action that can no longer be serialised for revalidation", async () => {
  const scores = systemOneScores();
  const harness = await start({
    result: {
      kind: "allow",
      reason: "Fixture allow",
      decision: decision("allow"),
      decisionSource: "llm-reviewer",
      systemOne: scores,
    },
    delay: held(),
  });
  const input = harness.input();
  const work = harness.evaluate(input);
  await harness.started(1);
  Reflect.set(input, "metadata", { count: 1n });
  release();
  await work;
  expect(input.effect).toBe("deny");
  expect(input.message).toBe("Pending action could not be revalidated");
  await harness.dispose();
  const [record] = await harness.records();
  expect(record).toMatchObject({
    outcome: "deny",
    reason: "Pending action could not be revalidated",
    decisionSource: "failure-safe",
    systemOne: scores,
  });
});

test("v2 reviews without an audit writer still apply and the overload still denies", async () => {
  const harness = await start({ config: { audit: false }, delay: held() });
  const inputs = Array.from({ length: 32 }, (_, index) =>
    harness.input(`ses_${index}`),
  );
  const work = Promise.all(inputs.map(harness.evaluate));
  await harness.started(32);
  const overload = harness.input("ses_overload");
  await harness.evaluate(overload);
  expect(overload.message).toBe("Reviewer concurrency limit reached");
  release();
  await work;
  expect(inputs.every((input) => input.effect === "allow")).toBe(true);
  await expect(harness.records()).rejects.toThrow("ENOENT");
});

test("v2 concurrency-limit audit records keep their key order", async () => {
  const harness = await start({ delay: held() });
  const work = Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      harness.evaluate(harness.input(`ses_${index}`)),
    ),
  );
  await harness.started(32);
  await harness.evaluate(harness.input("ses_overload"));
  release();
  await work;
  await harness.dispose();
  const record = (await harness.records()).find(
    (entry) => entry.sessionID === "ses_overload",
  );
  expect(Object.keys(defined(record, "overload record"))).toEqual([
    "schemaVersion",
    "reviewID",
    "requestID",
    "hostGeneration",
    "hostVersion",
    "generation",
    "directory",
    "sessionID",
    "nativeAction",
    "permission",
    "outcome",
    "reason",
    "timestamp",
    "durationMs",
    "application",
    "decisionSource",
  ]);
  expect(record).toMatchObject({
    nativeAction: "shell",
    permission: "shell",
    outcome: "deny",
    durationMs: 0,
    application: "evaluation-returned",
    decisionSource: "failure-safe",
  });
  expect(record?.reviewID).toBe(record?.requestID);
});
