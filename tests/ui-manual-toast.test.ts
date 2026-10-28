import { describe, expect, test } from "bun:test";
import type { HandoffTrigger } from "../src/kernel/review-result.ts";
import { budgetExhaustedResult } from "../src/modules/reviewer/services/system-one-budget.ts";
import {
  createUiStatus,
  type ReviewUiStatus,
} from "../src/modules/status/models/ui-protocol.ts";
import { manualToast } from "../src/ui/manual-toast.ts";
import { config, request } from "./helpers.ts";

const FALLBACK =
  "The reviewer could not decide. This permission now needs your approval.";
const JEV = "opencode/jev-1.13-free";
const LUNA = "omniroute/auto/gpt-6-luna";
const BUDGET_REASON =
  "No review time left for the reasoning reviewer after System One escalated: 4s of the review budget remain and a hand-off needs 15s. Jev was unsure.";

function manual(extra: Partial<ReviewUiStatus>): ReviewUiStatus {
  return {
    ...createUiStatus(request(), "manual", {
      model: LUNA,
      variant: "medium",
      timeoutMs: 10_000,
    }),
    ...extra,
  };
}

describe("manual-review toast", () => {
  test("reasoning-escalated", () => {
    expect(
      manualToast(
        manual({
          resolution: "reasoning-escalated",
          reason: "the force push targets main.",
        }),
        FALLBACK,
      ),
    ).toEqual({
      variant: "warning",
      title: "Manual review required",
      message:
        "gpt-6-luna reviewed this after System One; it needs your approval: the force push targets main.",
    });
    expect(
      manualToast(manual({ resolution: "reasoning-escalated" }), FALLBACK)
        .message,
    ).toBe(
      `gpt-6-luna reviewed this after System One; it needs your approval: ${FALLBACK}`,
    );
  });

  test("reasoning reviewer unavailable", () => {
    const reason =
      "reasoning reviewer failed (TimeoutError): The operation timed out.";
    expect(
      manualToast(
        manual({ resolution: "reasoning-unavailable", reason }),
        FALLBACK,
      ),
    ).toEqual({
      variant: "error",
      title: "Reasoning reviewer unavailable",
      message: `gpt-6-luna failed (timeout). This permission needs your approval. ${reason}`,
    });
    expect(
      manualToast(manual({ resolution: "reasoning-unavailable" }), FALLBACK)
        .message,
    ).toBe("gpt-6-luna failed. This permission needs your approval.");
  });

  test("no review time left", () => {
    const handoff = {
      from: JEV,
      to: LUNA,
      trigger: "jev-failure",
      failureKind: "timeout",
    } as const;
    expect(
      manualToast(
        manual({ model: JEV, resolution: "budget-exhausted", handoff }),
        FALLBACK,
      ),
    ).toEqual({
      variant: "warning",
      title: "Manual review required",
      message:
        "No review time left for gpt-6-luna after System One (System One timed out).",
    });
    expect(
      manualToast(
        manual({
          model: JEV,
          resolution: "budget-exhausted",
          reason: "Budget below the floor.",
        }),
        FALLBACK,
      ).message,
    ).toBe("Budget below the floor.");
  });

  test("no review time left, in the shape the engine reports without a hand-off", () => {
    const status = manual({
      model: JEV,
      resolution: "budget-exhausted",
      reason: BUDGET_REASON,
    });
    const rest =
      "4s of the review budget remain and a hand-off needs 15s. Jev was unsure.";
    expect(manualToast(status, FALLBACK)).toEqual({
      variant: "warning",
      title: "Manual review required",
      message: `No review time left for the reasoning reviewer after System One (System One escalated). ${rest}`,
    });
    expect(manualToast(status, FALLBACK, LUNA).message).toBe(
      `No review time left for gpt-6-luna after System One (System One escalated). ${rest}`,
    );
  });

  test("no review time left with an empty model name falls back to the generic name", () => {
    const status = manual({
      model: JEV,
      resolution: "budget-exhausted",
      reason: BUDGET_REASON,
    });
    for (const empty of ["", " / "])
      expect(manualToast(status, FALLBACK, empty).message).toStartWith(
        "No review time left for the reasoning reviewer after System One (System One escalated).",
      );
  });

  test("a reasoning reviewer whose last segment is empty is never a blank name", () => {
    const handoff = { from: JEV, to: "///", trigger: "jev-escalate" } as const;
    const toast = (extra: Partial<ReviewUiStatus>): string =>
      manualToast(manual({ handoff, reason: "why", ...extra }), FALLBACK)
        .message;
    expect(toast({ resolution: "reasoning-escalated" })).toStartWith(
      "/// reviewed this after System One;",
    );
    expect(toast({ resolution: "reasoning-unavailable" })).toStartWith(
      "/// failed.",
    );
    expect(
      toast({
        model: JEV,
        resolution: "budget-exhausted",
        reason: BUDGET_REASON,
      }),
    ).toStartWith(
      "No review time left for the reasoning reviewer after System One (System One escalated).",
    );
  });

  test("no review time left after a hand-off states the lead once", () => {
    const handoff = { from: JEV, to: LUNA, trigger: "jev-escalate" } as const;
    expect(
      manualToast(
        manual({
          model: JEV,
          resolution: "budget-exhausted",
          handoff,
          reason: BUDGET_REASON,
        }),
        FALLBACK,
      ).message,
    ).toBe(
      "No review time left for gpt-6-luna after System One (System One escalated). 4s of the review budget remain and a hand-off needs 15s. Jev was unsure.",
    );
  });

  test.each<HandoffTrigger>([
    "jev-escalate",
    "jev-uncertain-allow",
    "jev-gate",
    "jev-invalid",
    "jev-failure",
    "jev-uncertain-deny",
  ])(
    "no review time left reshapes the engine's real reason after %s",
    (trigger) => {
      const result = budgetExhaustedResult(
        {
          result: {
            kind: "escalate",
            reason: "Jev's own reason: x.",
            decisionSource: "system-one-reviewer",
          },
          category: "general",
        },
        trigger,
        14_999,
        config(),
      );
      const message = manualToast(
        manual({
          model: JEV,
          resolution: "budget-exhausted",
          reason: result.reason,
        }),
        FALLBACK,
        LUNA,
      ).message;
      expect(message).toStartWith(
        "No review time left for gpt-6-luna after System One (",
      );
      expect(message).toEndWith(
        "14s of the review budget remain and a hand-off needs 15s. Jev's own reason: x.",
      );
      expect(message).not.toContain("the reasoning reviewer");
    },
  );

  test("no review time left without the engine's reason shape", () => {
    expect(
      manualToast(
        manual({ resolution: "budget-exhausted", reason: "Out of time." }),
        FALLBACK,
        LUNA,
      ).message,
    ).toBe("Out of time.");
    expect(
      manualToast(manual({ resolution: "budget-exhausted" }), FALLBACK, LUNA),
    ).toEqual({
      variant: "warning",
      title: "Manual review required",
      message:
        "No review time left for the reasoning reviewer after System One.",
    });
  });

  test('a reviewer resolution, or none, shows the reason under "Manual review required"', () => {
    for (const resolution of ["reviewer", undefined] as const) {
      expect(
        manualToast(
          manual({
            ...(resolution ? { resolution } : {}),
            reason: "Low confidence",
          }),
          FALLBACK,
        ),
      ).toEqual({
        variant: "warning",
        title: "Manual review required",
        message: "Low confidence",
      });
      expect(
        manualToast(manual(resolution ? { resolution } : {}), FALLBACK).message,
      ).toBe(FALLBACK);
    }
  });
});
