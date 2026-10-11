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

// A status with every optional field set, so each row below changes exactly
// one field of an otherwise accepted payload.
function fullStatus(): Record<string, unknown> {
  return {
    ...createUiStatus(request(), "denied", {
      ...options,
      emittedAt: 123,
      reason: "Concrete reason",
      decision: decision("deny"),
      escalationDisposition: "manual",
      actorName: "builder",
      actorProfile: "workspace",
    }),
  };
}

// JSON cannot encode a non-finite number, but JSON.parse turns 1e400 into
// Infinity, so the marker string is swapped for that literal after encoding.
const OVERFLOW = "__overflow__";
function decodeRaw(payload: unknown): ReturnType<typeof decodeUiStatus> {
  const json = JSON.stringify(payload).replaceAll(`"${OVERFLOW}"`, "1e400");
  return decodeUiStatus(
    `${UI_COMMAND_PREFIX}${Buffer.from(json, "utf8").toString("base64url")}`,
  );
}

const REJECTED_FIELDS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["version 2", { version: 2 }],
  ["version as a string", { version: "1" }],
  ["missing version", { version: undefined }],
  ["requestID as a number", { requestID: 1 }],
  ["missing sessionID", { sessionID: undefined }],
  ["unlisted phase", { phase: "paused" }],
  ["missing phase", { phase: undefined }],
  ["permission as a number", { permission: 1 }],
  ["action as null", { action: null }],
  ["model as a number", { model: 1 }],
  ["missing variant", { variant: undefined }],
  ["emittedAt as a string", { emittedAt: "123" }],
  ["infinite emittedAt", { emittedAt: OVERFLOW }],
  ["missing emittedAt", { emittedAt: undefined }],
  ["timeoutMs as a string", { timeoutMs: "1000" }],
  ["infinite timeoutMs", { timeoutMs: OVERFLOW }],
  ["negative timeoutMs", { timeoutMs: -1 }],
  ["reason as a number", { reason: 1 }],
  ["reason as null", { reason: null }],
  ["decision as null", { decision: null }],
  ["decision as an array", { decision: [] }],
  ["decision as a string", { decision: "deny" }],
  [
    "unlisted decision outcome",
    { decision: decision("deny", { outcome: "maybe" as never }) },
  ],
  [
    "unlisted decision risk_level",
    { decision: decision("deny", { risk_level: "none" as never }) },
  ],
  [
    "unlisted decision user_authorization",
    { decision: decision("deny", { user_authorization: "none" as never }) },
  ],
  [
    "decision rationale as a number",
    { decision: decision("deny", { rationale: 1 as never }) },
  ],
  [
    "decision confidence as a string",
    { decision: decision("deny", { confidence: "0.5" as never }) },
  ],
  [
    "infinite decision confidence",
    { decision: decision("deny", { confidence: OVERFLOW as never }) },
  ],
  [
    "decision confidence below 0",
    { decision: decision("deny", { confidence: -0.01 }) },
  ],
  [
    "decision confidence above 1",
    { decision: decision("deny", { confidence: 1.01 }) },
  ],
  ["escalationDisposition as null", { escalationDisposition: null }],
  ["unlisted escalationDisposition", { escalationDisposition: "escalate" }],
  ["actorName as a number", { actorName: 1 }],
  ["actorName as null", { actorName: null }],
  ["unlisted actorProfile", { actorProfile: "admin" }],
  ["actorProfile as null", { actorProfile: null }],
];

const ACCEPTED_FIELDS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["every optional field set", {}],
  [
    "every optional field absent",
    {
      reason: undefined,
      decision: undefined,
      escalationDisposition: undefined,
      actorName: undefined,
      actorProfile: undefined,
    },
  ],
  ["the unknown phase", { phase: "unknown" }],
  ["a zero timeoutMs", { timeoutMs: 0 }],
  ["a negative emittedAt", { emittedAt: -5 }],
  [
    "empty strings",
    {
      requestID: "",
      sessionID: "",
      permission: "",
      action: "",
      model: "",
      variant: "",
      reason: "",
      actorName: "",
    },
  ],
  ["the deny escalationDisposition", { escalationDisposition: "deny" }],
  ["decision confidence 0", { decision: decision("deny", { confidence: 0 }) }],
  ["decision confidence 1", { decision: decision("allow", { confidence: 1 }) }],
  [
    "a decision with only the checked fields",
    {
      decision: {
        outcome: "escalate",
        risk_level: "critical",
        user_authorization: "unknown",
        rationale: "",
        confidence: 0.5,
      },
    },
  ],
  ["unknown extra fields", { extra: { nested: true }, version: 1 }],
  ...(
    [
      "read-only",
      "validation",
      "workspace",
      "operator",
      "reviewer",
      "unknown",
    ] as const
  ).map((actorProfile): [string, Record<string, unknown>] => [
    `the ${actorProfile} actorProfile`,
    { actorProfile },
  ]),
  ...(["medium", "high", "low"] as const).map(
    (risk_level): [string, Record<string, unknown>] => [
      `the ${risk_level} risk_level and authorization`,
      {
        decision: decision("deny", {
          risk_level,
          user_authorization: risk_level,
        }),
      },
    ],
  ),
];

describe("TUI status protocol field checks", () => {
  test.each(REJECTED_FIELDS)("rejects %s", (_name, overrides) => {
    expect(decodeRaw({ ...fullStatus(), ...overrides })).toBeUndefined();
  });

  test.each(ACCEPTED_FIELDS)(
    "accepts and returns %s unchanged",
    (_name, overrides) => {
      const payload = { ...fullStatus(), ...overrides };
      expect(decodeRaw(payload)).toEqual(JSON.parse(JSON.stringify(payload)));
    },
  );

  test.each([
    ["null", null],
    ["an array", [fullStatus()]],
    ["a string", "status"],
    ["a number", 1],
  ])("rejects a payload that is %s", (_name, payload) => {
    expect(decodeRaw(payload)).toBeUndefined();
  });

  test("accepts a 16000-character payload and rejects the next larger one", () => {
    const status = createUiStatus(request(), "approved", options);
    const unpadded = JSON.stringify({ ...status, reason: "" }).length;
    // ASCII JSON of n bytes encodes to ceil(4n / 3) base64url characters.
    const command = (bytes: number): string =>
      `${UI_COMMAND_PREFIX}${Buffer.from(
        JSON.stringify({ ...status, reason: "r".repeat(bytes - unpadded) }),
        "utf8",
      ).toString("base64url")}`;
    expect(command(12_000).length - UI_COMMAND_PREFIX.length).toBe(16_000);
    expect(decodeUiStatus(command(12_000))?.reason).toHaveLength(
      12_000 - unpadded,
    );
    expect(command(12_001).length - UI_COMMAND_PREFIX.length).toBe(16_002);
    expect(decodeUiStatus(command(12_001))).toBeUndefined();
  });

  test("rejects an empty payload after the prefix", () => {
    expect(decodeUiStatus(UI_COMMAND_PREFIX)).toBeUndefined();
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
});
