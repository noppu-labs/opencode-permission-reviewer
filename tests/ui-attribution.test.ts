import { describe, expect, test } from "bun:test";
import type {
  HandoffInfo,
  HandoffTrigger,
} from "../src/kernel/review-result.ts";
import {
  createUiStatus,
  type ReviewUiStatus,
} from "../src/modules/status/models/ui-protocol.ts";
import {
  attributionText,
  handoffCause,
  modelLabel,
  resultDetail,
  reviewerLabel,
  shortModelName,
} from "../src/ui/attribution.ts";
import { request } from "./helpers.ts";

const JEV = "opencode/jev-1.13-free";
const LUNA = "omniroute/auto/gpt-6-luna";

function status(
  phase: ReviewUiStatus["phase"],
  extra: Partial<ReviewUiStatus> = {},
): ReviewUiStatus {
  return {
    ...createUiStatus(request(), phase, {
      model: LUNA,
      variant: "medium",
      timeoutMs: 10_000,
    }),
    ...extra,
  };
}

function handoff(trigger: HandoffTrigger, failureKind?: string): HandoffInfo {
  return {
    from: JEV,
    to: LUNA,
    trigger,
    ...(failureKind === undefined ? {} : { failureKind }),
  };
}

describe("short model name", () => {
  test.each([
    ["omniroute/auto/gpt-6-luna", "gpt-6-luna"],
    ["gpt-6-luna", "gpt-6-luna"],
    ["openai/gpt-6-luna/", "gpt-6-luna"],
    [" openai / gpt-6-luna ", "gpt-6-luna"],
    ["", ""],
    ["   ", ""],
  ])("shortens %p to %p", (model, short) => {
    expect(shortModelName(model)).toBe(short);
  });
});

describe("model label", () => {
  test.each([
    ["typesafe-ai/jev-1.13.0", "jev-1.13.0"],
    ["omniroute/auto/gpt-6-luna", "gpt-6-luna"],
    ["gpt-6-luna", "gpt-6-luna"],
    ["///", "///"],
  ])("labels %p as %p", (model, label) => {
    expect(modelLabel(model)).toBe(label);
  });
});

describe("attribution text", () => {
  test.each<[string, HandoffTrigger, string | undefined, string, string]>([
    [
      "escalate",
      "jev-escalate",
      undefined,
      "gpt-6-luna after Jev's escalation",
      "gpt-6-luna after Jev's escalation",
    ],
    [
      "uncertain allow",
      "jev-uncertain-allow",
      undefined,
      "gpt-6-luna after Jev's uncertain approval",
      "gpt-6-luna after Jev's uncertain approval",
    ],
    [
      "gate",
      "jev-gate",
      undefined,
      "gpt-6-luna after a safety gate stopped Jev's approval",
      "gpt-6-luna after a safety gate stopped Jev's approval",
    ],
    [
      "invalid",
      "jev-invalid",
      undefined,
      "gpt-6-luna after Jev's invalid response",
      "gpt-6-luna after Jev's invalid response",
    ],
    [
      "failure",
      "jev-failure",
      "timeout",
      "gpt-6-luna after Jev failed (timeout)",
      "gpt-6-luna after Jev failed (timeout)",
    ],
    [
      "failure without a kind",
      "jev-failure",
      undefined,
      "gpt-6-luna after Jev failed",
      "gpt-6-luna after Jev failed",
    ],
    [
      "uncertain deny",
      "jev-uncertain-deny",
      undefined,
      "gpt-6-luna overturned Jev's denial",
      "gpt-6-luna confirmed Jev's denial",
    ],
  ])(
    "credits %s on approval and on a block",
    (_name, trigger, kind, approved, blocked) => {
      expect(
        attributionText(
          status("approved", { handoff: handoff(trigger, kind) }),
        ),
      ).toBe(approved);
      expect(
        attributionText(status("denied", { handoff: handoff(trigger, kind) })),
      ).toBe(blocked);
    },
  );

  test("names the deciding model alone without a hand-off", () => {
    expect(
      attributionText(status("approved", { model: JEV, decidedBy: JEV })),
    ).toBe("jev-1.13-free");
    expect(
      attributionText(status("approved", { model: "", decidedBy: "" })),
    ).toBeUndefined();
  });

  test("credits the model that decided, not the model the status names", () => {
    expect(
      attributionText(status("denied", { model: LUNA, decidedBy: JEV })),
    ).toBe("jev-1.13-free");
  });

  test("credits no model when none decided", () => {
    expect(attributionText(status("denied", { model: JEV }))).toBeUndefined();
    expect(attributionText(status("manual", { model: LUNA }))).toBeUndefined();
  });

  test("the hand-off phrase wins over the deciding model", () => {
    expect(
      attributionText(
        status("approved", {
          handoff: handoff("jev-escalate"),
          decidedBy: LUNA,
        }),
      ),
    ).toBe("gpt-6-luna after Jev's escalation");
  });

  test("uncertain-deny fail-closed never claims the denial was confirmed", () => {
    expect(
      attributionText(
        status("denied", {
          handoff: handoff("jev-uncertain-deny"),
          escalationDisposition: "deny",
        }),
      ),
    ).toBe("gpt-6-luna after Jev's uncertain denial");
    expect(
      attributionText(
        status("reviewing", { handoff: handoff("jev-uncertain-deny") }),
      ),
    ).toBe("gpt-6-luna after Jev's uncertain denial");
  });

  test("a fail-closed result after the reasoning reviewer failed credits no model", () => {
    const failed = status("denied", {
      model: JEV,
      handoff: handoff("jev-failure", "timeout"),
      resolution: "reasoning-unavailable",
      escalationDisposition: "deny",
      reason: "reasoning reviewer failed (Error): boom",
    });
    expect(attributionText(failed)).toBeUndefined();
    expect(resultDetail(failed)).toBe(
      "reasoning reviewer failed (Error): boom",
    );
  });

  test("budget-exhausted credits the model that ran, never the reasoning reviewer", () => {
    expect(
      attributionText(
        status("denied", {
          model: JEV,
          handoff: handoff("jev-escalate"),
          resolution: "budget-exhausted",
          escalationDisposition: "deny",
        }),
      ),
    ).toBe("jev-1.13-free");
  });
});

describe("strip text", () => {
  test("result line 2 puts attribution ahead of the reason", () => {
    expect(
      resultDetail(
        status("approved", {
          handoff: handoff("jev-escalate"),
          reason: "Requested push.",
        }),
      ),
    ).toBe("gpt-6-luna after Jev's escalation — Requested push.");
    expect(resultDetail(status("unknown", { reason: "No result." }))).toBe(
      "No result.",
    );
    expect(resultDetail(status("approved"))).toBeUndefined();
  });

  test("result line 2 credits the deciding model, else shows the reason alone", () => {
    expect(
      resultDetail(
        status("approved", { decidedBy: JEV, reason: "Read-only command." }),
      ),
    ).toBe("jev-1.13-free — Read-only command.");
    expect(
      resultDetail(
        status("denied", { model: JEV, reason: "Emergency brake: stop." }),
      ),
    ).toBe("Emergency brake: stop.");
    expect(
      resultDetail(status("approved", { decidedBy: "///", reason: "ok" })),
    ).toBe("/// — ok");
  });

  test("the progress label shows the hand-off, else the model's label", () => {
    expect(
      reviewerLabel(status("reviewing", { handoff: handoff("jev-escalate") })),
    ).toBe("gpt-6-luna after Jev's escalation");
    expect(reviewerLabel(status("reviewing"))).toBe("gpt-6-luna");
    expect(reviewerLabel(status("reviewing", { model: "///" }))).toBe("///");
    expect(
      reviewerLabel(
        status("reviewing", {
          handoff: { ...handoff("jev-escalate"), to: "///" },
        }),
      ),
    ).toBe("/// after Jev's escalation");
  });

  test.each<[HandoffTrigger, string | undefined, string]>([
    ["jev-escalate", undefined, "Jev escalated"],
    ["jev-uncertain-allow", undefined, "Jev's approval was uncertain"],
    ["jev-gate", undefined, "a safety gate stopped Jev's approval"],
    ["jev-invalid", undefined, "Jev's response was invalid"],
    ["jev-failure", "timeout", "Jev timed out"],
    ["jev-failure", "client", "Jev failed (client)"],
    ["jev-failure", undefined, "Jev failed"],
    ["jev-uncertain-deny", undefined, "Jev's denial was uncertain"],
  ])("names the cause of a %s hand-off", (trigger, kind, cause) => {
    expect(handoffCause(handoff(trigger, kind))).toBe(cause);
  });
});
