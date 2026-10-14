import { describe, expect, test } from "bun:test";
import type { ReviewDecision } from "../src/types.ts";
import {
  createUiStatus,
  decodeUiStatus,
  encodeUiStatus,
  permissionAction,
  type ReviewUiPhase,
  UI_COMMAND_PREFIX,
  UI_START_GRACE_MS,
  UI_WATCHDOG_GRACE_MS,
} from "../src/ui-protocol.ts";
import { ReviewUiState } from "../src/ui-state.ts";
import { decision, request } from "./helpers.ts";

const options = {
  model: "openai/gpt-5.6-luna",
  variant: "max",
  timeoutMs: 120_000,
};

const HANDOFF = {
  from: "opencode/jev-1.13-free",
  to: "openai/gpt-6-luna",
  trigger: "jev-failure",
  failureKind: "timeout",
} as const;

const ROUND_TRIPS: ReadonlyArray<{
  phase: ReviewUiPhase;
  outcome: ReviewDecision["outcome"];
  disposition?: "deny";
}> = [
  { phase: "reviewing", outcome: "allow" },
  { phase: "approved", outcome: "allow" },
  { phase: "denied", outcome: "deny", disposition: "deny" },
  { phase: "manual", outcome: "escalate" },
];

describe("TUI status protocol", () => {
  test("round-trips every phase without losing decision details", () => {
    for (const { phase, outcome, disposition } of ROUND_TRIPS) {
      const status = createUiStatus(request(), phase, {
        ...options,
        emittedAt: 123,
        reason: "Concrete reason",
        decision: decision(outcome),
        ...(disposition ? { escalationDisposition: disposition } : {}),
      });
      expect(decodeUiStatus(encodeUiStatus(status))).toEqual(status);
      expect(status.escalationDisposition).toBe(disposition);
    }
  });

  test("round-trips the hand-off, resolution, deciding model and config lists", () => {
    const status = createUiStatus(request(), "manual", {
      ...options,
      emittedAt: 123,
      handoff: HANDOFF,
      resolution: "reasoning-unavailable",
      decidedBy: "openai/gpt-6-luna",
      configWarnings: [
        "systemOneDenialReview is inactive: the reviewer model is not Jev",
      ],
      configDegraded: ["global config file is malformed and was ignored"],
    });
    expect(decodeUiStatus(encodeUiStatus(status))).toEqual(status);
  });

  test("omits empty config lists and bounds the hand-off and every list", () => {
    const status = createUiStatus(request(), "approved", {
      ...options,
      handoff: {
        ...HANDOFF,
        from: "j".repeat(300),
        failureKind: "k".repeat(80),
      },
      decidedBy: ` ${"b".repeat(300)} `,
      configWarnings: [],
      configDegraded: Array.from(
        { length: 8 },
        (_, index) => `${index} ${"d".repeat(400)}`,
      ),
    });
    expect(status.configWarnings).toBeUndefined();
    expect(status.configDegraded).toHaveLength(5);
    expect(status.configDegraded?.every((entry) => entry.length <= 200)).toBe(
      true,
    );
    expect(status.handoff?.from).toHaveLength(200);
    expect(status.handoff?.failureKind).toHaveLength(40);
    expect(status.handoff?.trigger).toBe("jev-failure");
    expect(status.decidedBy).toBe(`${"b".repeat(199)}…`);
  });

  test("a status with every field at its bound stays under the command cap", () => {
    const long = (char: string, length: number): string => char.repeat(length);
    const status = createUiStatus(
      request({ metadata: { command: long("c", 900) } }),
      "denied",
      {
        model: long("m", 300),
        variant: long("v", 200),
        timeoutMs: 120_000,
        reason: long("r", 3_000),
        decision: decision("deny", { rationale: long("x", 2_000) }),
        escalationDisposition: "deny",
        actorName: long("a", 300),
        actorProfile: "operator",
        handoff: {
          from: long("f", 300),
          to: long("t", 300),
          trigger: "jev-uncertain-deny",
          failureKind: long("k", 80),
        },
        resolution: "reasoning-escalated",
        decidedBy: long("b", 300),
        configWarnings: Array.from({ length: 9 }, () => long("w", 400)),
        configDegraded: Array.from({ length: 9 }, () => long("d", 400)),
      },
    );
    const encoded = encodeUiStatus(status);
    expect(encoded.length - UI_COMMAND_PREFIX.length).toBeLessThanOrEqual(
      16_000,
    );
    expect(decodeUiStatus(encoded)).toEqual(status);
  });

  test("a status with multi-byte text at every bound still decodes", () => {
    const list = (tag: string): string[] =>
      Array.from({ length: 5 }, (_, i) => `${tag}${i}${"界".repeat(250)}`);
    const status = createUiStatus(
      request({ metadata: { command: "界".repeat(600) } }),
      "manual",
      {
        ...options,
        reason: "界".repeat(3_000),
        handoff: HANDOFF,
        resolution: "budget-exhausted",
        decidedBy: "openai/gpt-6-luna",
        configWarnings: list("w"),
        configDegraded: list("d"),
      },
    );
    const decoded = decodeUiStatus(encodeUiStatus(status));
    expect(decoded).toBeDefined();
    expect(decoded?.configDegraded?.[0]).toStartWith("d0");
  });

  test("rejects invalid escalationDisposition values", () => {
    const status = createUiStatus(request(), "denied", {
      ...options,
      escalationDisposition: "deny",
    });
    const payload = { ...status, escalationDisposition: "sometimes" };
    const encoded = `${UI_COMMAND_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    expect(decodeUiStatus(encoded)).toBeUndefined();
  });

  test("rejects unrelated, malformed, oversized, and structurally invalid commands", () => {
    expect(decodeUiStatus("session.new")).toBeUndefined();
    expect(decodeUiStatus(`${UI_COMMAND_PREFIX}%%%`)).toBeUndefined();
    expect(
      decodeUiStatus(`${UI_COMMAND_PREFIX}${"a".repeat(16_001)}`),
    ).toBeUndefined();
    const invalid = Buffer.from(
      JSON.stringify({ version: 1, phase: "approved" }),
    ).toString("base64url");
    expect(decodeUiStatus(`${UI_COMMAND_PREFIX}${invalid}`)).toBeUndefined();
  });

  test("uses the concrete command and bounds untrusted display text", () => {
    expect(
      permissionAction(request({ metadata: { command: "printf safe" } })),
    ).toBe("$ printf safe");
    const action = permissionAction(
      request({
        metadata: { command: `x${" ".repeat(20)}${"y".repeat(800)}` },
      }),
    );
    expect(action.length).toBeLessThanOrEqual(500);
    expect(action).not.toContain("  ");
  });
});

describe("TUI state machine", () => {
  test("starts in reviewing and requires an explicit server acknowledgement", () => {
    const state = new ReviewUiState(options);
    state.asked(request(), 1_000);
    expect(state.get("per_1")?.phase).toBe("reviewing");
    expect(state.expire(1_000 + UI_START_GRACE_MS - 1)).toHaveLength(0);
    expect(state.expire(1_000 + UI_START_GRACE_MS)).toMatchObject([
      {
        phase: "unknown",
        reason: "The reviewer did not acknowledge the start of the review.",
      },
    ]);
  });

  test("an acknowledged review uses the model timeout plus watchdog grace", () => {
    const state = new ReviewUiState(options);
    const asked = state.asked(request(), 1_000);
    state.apply({ ...asked, emittedAt: 1_100 });
    expect(
      state.expire(1_000 + options.timeoutMs + UI_WATCHDOG_GRACE_MS - 1),
    ).toHaveLength(0);
    expect(
      state.expire(1_000 + options.timeoutMs + UI_WATCHDOG_GRACE_MS)[0]?.phase,
    ).toBe("unknown");
  });

  test("accepts the first server acknowledgement despite transport clock skew", () => {
    const state = new ReviewUiState(options);
    const local = state.asked(request(), 1_000);
    expect(state.apply({ ...local, emittedAt: 990 })).toBe(true);
    expect(state.expire(1_000 + UI_START_GRACE_MS)).toHaveLength(0);
    expect(
      state.expire(1_000 + options.timeoutMs + UI_WATCHDOG_GRACE_MS)[0]?.phase,
    ).toBe("unknown");
  });

  test("ignores stale network status and preserves terminal results after permission.replied", () => {
    const state = new ReviewUiState(options);
    const asked = state.asked(request(), 1_000);
    const approved = {
      ...asked,
      phase: "approved" as const,
      emittedAt: 2_000,
      reason: "Safe",
    };
    expect(state.apply(approved)).toBe(true);
    expect(state.apply({ ...asked, emittedAt: 1_500 })).toBe(false);
    state.replied("per_1");
    expect(state.get("per_1")?.phase).toBe("approved");
  });

  test("reveals manual permissions and removes them after the human replies", () => {
    const state = new ReviewUiState(options);
    const status = createUiStatus(request(), "manual", {
      ...options,
      emittedAt: 2_000,
      reason: "Low confidence",
    });
    state.apply(status);
    expect(state.get("per_1")?.phase).toBe("manual");
    state.replied("per_1");
    expect(state.get("per_1")).toBeUndefined();
  });

  test("dismisses automatic results after their visual dwell time", () => {
    const state = new ReviewUiState(options);
    const approved = createUiStatus(request(), "approved", {
      ...options,
      emittedAt: 1_000,
      reason: "Safe",
    });
    state.apply(approved);
    expect(state.dismissResults(5_999)).toHaveLength(0);
    expect(state.dismissResults(6_000)).toEqual(["per_1"]);

    const denied = createUiStatus(request({ id: "per_2" }), "denied", {
      ...options,
      emittedAt: 3_000,
      reason: "Unsafe",
    });
    state.apply(denied);
    expect(state.dismissResults(7_999)).toHaveLength(0);
    expect(state.dismissResults(8_000)).toEqual(["per_2"]);
  });

  test("finds child-session requests from their visible parent and resists parent cycles", () => {
    const state = new ReviewUiState(options);
    state.asked(request({ sessionID: "ses_child" }), 1_000);
    expect(
      state.activeFor("ses_parent", (id) =>
        id === "ses_child" ? "ses_parent" : undefined,
      )?.requestID,
    ).toBe("per_1");
    expect(
      state.activeFor("ses_other", (id) =>
        id === "ses_child" ? "ses_cycle" : "ses_child",
      ),
    ).toBeUndefined();
  });

  test("skips manual entries and prefers a newer reviewing request over a terminal result", () => {
    const state = new ReviewUiState(options);
    state.apply(
      createUiStatus(request({ id: "per_old" }), "manual", {
        ...options,
        emittedAt: 1_000,
        reason: "Low confidence",
      }),
    );
    state.apply(
      createUiStatus(request({ id: "per_done" }), "approved", {
        ...options,
        emittedAt: 2_000,
        reason: "Safe",
      }),
    );
    state.asked(request({ id: "per_new" }), 3_000);
    expect(state.activeFor("ses_main", () => undefined)?.requestID).toBe(
      "per_new",
    );
    expect(state.activeFor("ses_main", () => undefined)?.phase).toBe(
      "reviewing",
    );
  });

  test("a hand-off keeps the review's start time and its watchdog", () => {
    const state = new ReviewUiState(options);
    const asked = state.asked(request(), 1_000);
    state.apply({ ...asked, emittedAt: 1_100 });
    expect(
      state.apply({
        ...asked,
        model: "openai/gpt-6-luna",
        emittedAt: 9_000,
        handoff: HANDOFF,
      }),
    ).toBe(true);
    expect(state.get("per_1")).toMatchObject({
      emittedAt: 1_000,
      model: "openai/gpt-6-luna",
      handoff: HANDOFF,
    });
    expect(
      state.expire(1_000 + options.timeoutMs + UI_WATCHDOG_GRACE_MS)[0]?.phase,
    ).toBe("unknown");
  });

  test("a late plain reviewing status never replaces the hand-off", () => {
    const state = new ReviewUiState(options);
    const asked = state.asked(request(), 1_000);
    state.apply({ ...asked, emittedAt: 1_200, handoff: HANDOFF });
    expect(state.apply({ ...asked, emittedAt: 1_100 })).toBe(false);
    expect(state.get("per_1")?.handoff).toEqual(HANDOFF);
    expect(state.get("per_1")?.emittedAt).toBe(1_000);
  });

  test("a hand-off status as old as the result never replaces it", () => {
    const state = new ReviewUiState(options);
    const asked = state.asked(request(), 1_000);
    state.apply({ ...asked, emittedAt: 1_100 });
    state.apply({
      ...asked,
      phase: "approved",
      emittedAt: 2_000,
      handoff: HANDOFF,
    });
    expect(state.apply({ ...asked, emittedAt: 2_000, handoff: HANDOFF })).toBe(
      false,
    );
    expect(state.get("per_1")?.phase).toBe("approved");
  });

  test("a result after a hand-off replaces it with its own time", () => {
    const state = new ReviewUiState(options);
    const asked = state.asked(request(), 1_000);
    state.apply({ ...asked, emittedAt: 1_200, handoff: HANDOFF });
    const approved = {
      ...asked,
      phase: "approved" as const,
      emittedAt: 9_500,
      handoff: HANDOFF,
    };
    expect(state.apply(approved)).toBe(true);
    expect(state.get("per_1")).toEqual(approved);
  });
});
