import { expect, test } from "bun:test";
import { setupWithServices } from "../src/adapters/opencode/v2/server.ts";
import type { ReviewExecutionResult } from "../src/types.ts";
import { decision, systemOneScores } from "./helpers.ts";
import { fixture, type ServerFixture } from "./v2-server-fixture.ts";

test("server maps decisions without elevating existing allow or deny and reports application independently", async () => {
  for (const kind of ["allow", "deny", "escalate"] as const) {
    const harness = await fixture({
      result: {
        kind,
        reason: "Fixture outcome",
        decision: decision(kind),
        decisionSource: "llm-reviewer",
      },
    });
    try {
      for (const effect of ["allow", "deny"] as const) {
        const unchanged = { ...harness.input(), effect };
        // Sequential: each evaluation is checked before the next runs against the same review state.
        await harness.evaluate(unchanged);
        expect(unchanged.effect).toBe(effect);
      }
      expect(harness.reviews()).toBe(0);
      const input = harness.input();
      await harness.evaluate(input);
      expect(input.effect).toBe(kind === "escalate" ? "ask" : kind);
      expect(harness.reviews()).toBe(1);
      expect((await harness.rpc.snapshot()).reviews).toHaveLength(1);
      expect(await harness.rpc.status()).toMatchObject({
        host: "v2",
        pending: 0,
        connection: "verified",
      });
      expect(await harness.rpc.identity()).toBeTruthy();
      await harness.dispose();
      expect(harness.registrationDisposals()).toBe(4);
      expect((await harness.records())[0]?.application).toBe(
        kind === "escalate" ? "human-pending" : "evaluation-returned",
      );
      const after = harness.input();
      await harness.evaluate(after);
      expect(after.effect).toBe("deny");
    } finally {
      await harness.cleanup();
    }
  }
});

const INTERRUPTIONS: Array<{
  budget: number;
  interrupt: (harness: ServerFixture) => Promise<void> | void;
}> = [
  { budget: 20, interrupt: (): void => {} },
  {
    budget: 5000,
    interrupt: (harness: ServerFixture): void => harness.event("ses_main"),
  },
  {
    budget: 5000,
    interrupt: (harness: ServerFixture): void => harness.endEvents(),
  },
  {
    budget: 5000,
    interrupt: (harness: ServerFixture): Promise<void> => harness.dispose(),
  },
];

test("deadline, interrupted session, event loss, and shutdown suppress late approvals", async () => {
  for (const { budget, interrupt } of INTERRUPTIONS) {
    let release!: () => void;
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await fixture({ delay, budget });
    try {
      const input = harness.input();
      const work = harness.evaluate(input);
      while (harness.reviews() === 0) await Bun.sleep(1);
      harness.event("ses_main", "/another-location");
      await Bun.sleep(1);
      expect(input.effect).toBe("ask");
      await interrupt(harness);
      await work;
      expect(input.effect).toBe("deny");
      release();
      await Bun.sleep(1);
      expect(input.effect).toBe("deny");
    } finally {
      release();
      await harness.cleanup();
    }
  }
});

test("overload stays bounded and independent sessions keep independent outcomes", async () => {
  let release!: () => void;
  const harness = await fixture({
    delay: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  try {
    const inputs = Array.from({ length: 32 }, (_, index) =>
      harness.input(`ses_${index}`),
    );
    const work = Promise.all(inputs.map(harness.evaluate));
    while (harness.reviews() < 32) await Bun.sleep(1);
    const overload = harness.input("ses_overload");
    await harness.evaluate(overload);
    expect(overload.effect).toBe("deny");
    expect((await harness.rpc.status()).pending).toBe(32);
    harness.event("ses_0");
    release();
    await work;
    expect(inputs[0]?.effect).toBe("deny");
    expect(inputs.slice(1).every((input) => input.effect === "allow")).toBe(
      true,
    );
  } finally {
    release();
    await harness.cleanup();
  }
});

test("v2 host setup enforces the supported range and reports it", async () => {
  for (const version of ["2.0.22", "2.0.23", "2.0.26", "2.1.0"]) {
    const harness = await fixture({ hostVersion: version });
    try {
      expect(await harness.rpc.status()).toMatchObject({
        host: "v2",
        hostVersion: version,
      });
    } finally {
      await harness.cleanup();
    }
  }
  await Promise.all(
    ["2.0.21", "3.0.0", "2.0.22-beta.1"].map(async (version) => {
      const ctx = {
        app: { version },
        location: { directory: "/tmp", project: { directory: "/tmp" } },
      } as unknown as Parameters<typeof setupWithServices>[0];
      const services = {
        loadConfig: () => {
          throw new Error("setup must reject the host before loading config");
        },
        connect: () => {
          throw new Error("setup must reject the host before connecting");
        },
        createBackend: () => {
          throw new Error(
            "setup must reject the host before creating a backend",
          );
        },
      } as unknown as Parameters<typeof setupWithServices>[1];
      await expect(setupWithServices(ctx, services)).rejects.toThrow(
        `Unsupported OpenCode V2 host ${version}; supported range is >=2.0.22 <3`,
      );
    }),
  );
});

test("action mutations and incomplete evidence cannot reuse an approval, and connection failures stay visible", async () => {
  let release!: () => void;
  const changing = await fixture({
    delay: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  try {
    const input = changing.input();
    const work = changing.evaluate(input);
    while (changing.reviews() === 0) await Bun.sleep(1);
    Reflect.set(input, "metadata", { command: "printf changed" });
    release();
    await work;
    expect(input.effect).toBe("deny");
    expect(input.message).toContain("changed during");
  } finally {
    release();
    await changing.cleanup();
  }
  for (const connectionError of [false, true]) {
    const harness = await fixture({ connectionError });
    try {
      const input = harness.input();
      Reflect.set(input, "metadata", {});
      await harness.evaluate(input);
      expect(input.effect).not.toBe("allow");
      if (connectionError)
        expect(await harness.rpc.status()).toMatchObject({
          connection: "failed",
        });
    } finally {
      await harness.cleanup();
    }
  }
});

test("v2 audit records carry Jev's scores only when the reviewer result has them", async () => {
  const scores = systemOneScores();
  const allowScores: typeof scores = {
    ...scores,
    outcome: {
      choice: "allow",
      confidence: 0.83,
      probabilities: { allow: 0.83, deny: 0.05, escalate: 0.12 },
    },
    supporting: {
      ...scores.supporting,
      evidenceCompleteness: { choice: "sufficient", confidence: 0.77 },
      primaryBasis: { choice: "authorized_routine", confidence: 0.72 },
    },
    reasoningRecommended: false,
  };
  const cases: Array<{
    result: ReviewExecutionResult;
    expected?: typeof scores;
  }> = [
    {
      result: {
        kind: "allow",
        reason: "Fixture Jev-only allow",
        decision: decision("allow"),
        decisionSource: "system-one-reviewer",
        reviewerModel: "opencode/jev-1.13-free",
        systemOne: allowScores,
      },
      expected: allowScores,
    },
    {
      result: {
        kind: "deny",
        reason: "Fixture reasoning deny",
        decision: decision("deny"),
        decisionSource: "llm-reviewer",
        reviewerModel: "openai/gpt-5.6-luna",
        reviewerEscalatedFrom: {
          model: "opencode/jev-1.13-free",
          reason: "Jev was unsure.",
        },
        systemOne: scores,
      },
      expected: scores,
    },
    {
      result: {
        kind: "escalate",
        reason:
          "System One reviewer returned a missing, invalid, or ambiguous decision.",
        decisionSource: "failure-safe",
        reviewerModel: "opencode/jev-1.13-free",
      },
    },
  ];
  for (const { result, expected } of cases) {
    const harness = await fixture({ result });
    try {
      await harness.evaluate(harness.input());
      await harness.dispose();
      const [record] = await harness.records();
      expect(record?.decisionSource).toBe(result.decisionSource);
      expect(record?.systemOne).toEqual(expected);
      if (result.reviewerEscalatedFrom)
        expect(record?.reviewerEscalatedFrom).toEqual(
          result.reviewerEscalatedFrom,
        );
    } finally {
      await harness.cleanup();
    }
  }
});

test("v2 failure-safe overrides keep Jev's scores from the replaced result", async () => {
  const scores = systemOneScores();
  let release!: () => void;
  const harness = await fixture({
    result: {
      kind: "deny",
      reason: "Fixture reasoning deny",
      decision: decision("deny"),
      decisionSource: "llm-reviewer",
      reviewerModel: "openai/gpt-5.6-luna",
      reviewerEscalatedFrom: {
        model: "opencode/jev-1.13-free",
        reason: "Jev was unsure.",
      },
      systemOne: scores,
    },
    delay: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  try {
    const input = harness.input();
    const work = harness.evaluate(input);
    while (harness.reviews() === 0) await Bun.sleep(1);
    Reflect.set(input, "metadata", { command: "printf changed" });
    release();
    await work;
    expect(input.effect).toBe("deny");
    await harness.dispose();
    const [record] = await harness.records();
    expect(record).toMatchObject({
      outcome: "deny",
      reason: "Pending action changed during its review",
      decisionSource: "failure-safe",
      systemOne: scores,
    });
  } finally {
    release();
    await harness.cleanup();
  }
});
