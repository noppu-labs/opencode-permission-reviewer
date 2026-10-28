import { describe, expect, test } from "bun:test";
import {
  createUiStatus,
  decodeUiStatus,
  UI_COMMAND_PREFIX,
} from "../src/modules/status/models/ui-protocol.ts";
import { decision, request } from "./helpers.ts";

const options = {
  model: "openai/gpt-5.6-luna",
  variant: "max",
  timeoutMs: 120_000,
};

const HANDOFF = {
  from: "opencode/jev-1.13-free",
  to: "openai/gpt-6-luna",
  trigger: "jev-uncertain-deny",
} as const;

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
      handoff: HANDOFF,
      resolution: "reasoning-escalated",
      decidedBy: "openai/gpt-6-luna",
      configWarnings: [
        "systemOneDenialReview is inactive: the reviewer model is not a System One model",
      ],
      configDegraded: ["global config file is malformed and was ignored"],
      actionSegments: [
        { text: "$ printf a", separator: "|" },
        { text: "cat <<EOF > out.txt", heredocLines: 2 },
      ],
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
  ["handoff as null", { handoff: null }],
  ["handoff as a string", { handoff: "jev-escalate" }],
  [
    "unlisted handoff trigger",
    { handoff: { ...HANDOFF, trigger: "jev-panic" } },
  ],
  ["handoff without to", { handoff: { from: "a", trigger: "jev-escalate" } }],
  ["handoff from as a number", { handoff: { ...HANDOFF, from: 1 } }],
  [
    "handoff failureKind as a number",
    { handoff: { ...HANDOFF, failureKind: 1 } },
  ],
  ["unlisted resolution", { resolution: "human" }],
  ["resolution as null", { resolution: null }],
  ["decidedBy as a number", { decidedBy: 1 }],
  ["decidedBy as null", { decidedBy: null }],
  ["configWarnings as a string", { configWarnings: "inactive" }],
  ["configWarnings holding a number", { configWarnings: ["inactive", 1] }],
  ["configDegraded as null", { configDegraded: null }],
  ["configDegraded as an object", { configDegraded: { first: "x" } }],
  ["actionSegments as null", { actionSegments: null }],
  ["actionSegments as an object", { actionSegments: { text: "a" } }],
  ["an actionSegments entry as a string", { actionSegments: ["a"] }],
  [
    "an actionSegments entry without text",
    { actionSegments: [{ separator: "|" }] },
  ],
  ["an actionSegments text as a number", { actionSegments: [{ text: 1 }] }],
  [
    "an unlisted actionSegments separator",
    { actionSegments: [{ text: "a", separator: "(" }] },
  ],
  [
    "a fractional heredocLines",
    { actionSegments: [{ text: "a", heredocLines: 1.5 }] },
  ],
  [
    "a negative heredocLines",
    { actionSegments: [{ text: "a", heredocLines: -1 }] },
  ],
  [
    "heredocLines as a string",
    { actionSegments: [{ text: "a", heredocLines: "2" }] },
  ],
  [
    "an infinite heredocLines",
    { actionSegments: [{ text: "a", heredocLines: OVERFLOW }] },
  ],
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
      handoff: undefined,
      resolution: undefined,
      decidedBy: undefined,
      configWarnings: undefined,
      configDegraded: undefined,
      actionSegments: undefined,
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
      decidedBy: "",
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
  ["empty config lists", { configWarnings: [], configDegraded: [] }],
  [
    "a hand-off with a failure kind",
    { handoff: { ...HANDOFF, trigger: "jev-failure", failureKind: "timeout" } },
  ],
  ...(
    [
      "jev-escalate",
      "jev-uncertain-allow",
      "jev-gate",
      "jev-invalid",
      "jev-failure",
      "jev-uncertain-deny",
    ] as const
  ).map((trigger): [string, Record<string, unknown>] => [
    `the ${trigger} hand-off trigger`,
    { handoff: { ...HANDOFF, trigger } },
  ]),
  ...(
    [
      "reviewer",
      "reasoning-escalated",
      "reasoning-unavailable",
      "budget-exhausted",
    ] as const
  ).map((resolution): [string, Record<string, unknown>] => [
    `the ${resolution} resolution`,
    { resolution },
  ]),
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
  ["an empty actionSegments list", { actionSegments: [] }],
  [
    "zero heredoc lines",
    { actionSegments: [{ text: "cat <<EOF", heredocLines: 0 }] },
  ],
  ...(["|", "||", "&&", ";", "&"] as const).map(
    (separator): [string, Record<string, unknown>] => [
      `the ${separator} separator`,
      { actionSegments: [{ text: "a", separator }, { text: "b" }] },
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
