import { describe, expect, test } from "bun:test";
import { systemOneRoutingWarnings } from "../src/modules/config/services/system-one-routing.ts";
import {
  ConfigNotices,
  type ConfigToast,
  configToasts,
  sidebarLine,
} from "../src/ui/config-notices.ts";
import { config } from "./helpers.ts";

const NO_REVIEWER =
  'systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; System One escalations still go to you';
const NOT_JEV =
  'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not a System One model';
const DENIAL_NO_REVIEWER =
  "systemOneDenialReview is inactive: no escalationReviewer is configured; System One denials stay final";
const DENIAL_NOT_JEV =
  "systemOneDenialReview is inactive: the reviewer model is not a System One model";
const INVALID = 'systemOneDenialReview "yes" is not a boolean; using false';
const DEGRADED = "global config escalationReviewer is invalid and was ignored";
const LUNA = "openai/gpt-6-luna";

function tracked(): { notices: ConfigNotices; toasts: ConfigToast[] } {
  const toasts: ConfigToast[] = [];
  return { notices: new ConfigNotices((toast) => toasts.push(toast)), toasts };
}

describe("sidebar line", () => {
  test.each([
    [
      [NO_REVIEWER],
      "⚠ reviewer: reasoning-first inactive (no escalationReviewer)",
    ],
    [
      [NOT_JEV],
      "⚠ reviewer: reasoning-first inactive (model is not System One)",
    ],
    [
      [DENIAL_NO_REVIEWER],
      "⚠ reviewer: denial review inactive (no escalationReviewer)",
    ],
    [
      [DENIAL_NOT_JEV],
      "⚠ reviewer: denial review inactive (model is not System One)",
    ],
    [[INVALID], `⚠ reviewer: ${INVALID}`],
    [
      [NOT_JEV, DENIAL_NOT_JEV],
      "⚠ reviewer: 2 config warnings · reasoning-first inactive (model is not System One)",
    ],
  ])("shows %p as %p", (warnings, text) => {
    expect(sidebarLine(warnings, [])).toEqual({ text, tone: "warning" });
  });

  test("a degraded config leads, in the error tone", () => {
    expect(sidebarLine([NOT_JEV], [DEGRADED])).toEqual({
      text: `✕ reviewer: 2 config warnings · auto-approval disabled (${DEGRADED})`,
      tone: "error",
    });
  });

  test.each(["openai/gpt-6-luna", "opencode/jev-1.13-free"])(
    "every inert-setting warning for %p has a short label",
    (model) => {
      const warnings = systemOneRoutingWarnings(
        config({
          model,
          systemOneEscalation: "reasoning-first",
          systemOneDenialReview: true,
        }),
      );
      expect(warnings).toHaveLength(2);
      for (const warning of warnings)
        expect(sidebarLine([warning], [])?.text).not.toContain(warning);
    },
  );

  test("every routing warning has a SHORT_WARNINGS entry, not the raw fallback", () => {
    const emitted = ["openai/gpt-6-luna", "opencode/jev-1.13-free"].flatMap(
      (model) =>
        systemOneRoutingWarnings(
          config({
            model,
            systemOneEscalation: "reasoning-first",
            systemOneDenialReview: true,
          }),
        ),
    );
    expect(emitted).toHaveLength(4);
    for (const warning of emitted)
      expect(sidebarLine([warning], [])?.text).not.toBe(
        `⚠ reviewer: ${warning}`,
      );
  });

  test("a healthy config shows no line", () => {
    expect(sidebarLine([], [])).toBeUndefined();
  });
});

describe("config toasts", () => {
  test("lists every toast, degraded first, without dedupe", () => {
    expect(configToasts([NOT_JEV, NOT_JEV], [DEGRADED])).toEqual([
      {
        variant: "error",
        title: "Permission reviewer config degraded",
        message: `Automatic approval is disabled: ${DEGRADED}.`,
      },
      {
        variant: "warning",
        title: "Permission reviewer config",
        message: NOT_JEV,
      },
      {
        variant: "warning",
        title: "Permission reviewer config",
        message: NOT_JEV,
      },
    ]);
    expect(configToasts([], [])).toEqual([]);
  });
});

describe("config notices", () => {
  test("toasts each distinct entry once per TUI session", () => {
    const { notices, toasts } = tracked();
    notices.update({ configWarnings: [NOT_JEV], configDegraded: [DEGRADED] });
    notices.update({ configWarnings: [NOT_JEV], configDegraded: [DEGRADED] });
    notices.update({});
    notices.update({ configWarnings: [NOT_JEV, DENIAL_NOT_JEV] });
    expect(toasts).toEqual([
      {
        variant: "error",
        title: "Permission reviewer config degraded",
        message: `Automatic approval is disabled: ${DEGRADED}.`,
      },
      {
        variant: "warning",
        title: "Permission reviewer config",
        message: NOT_JEV,
      },
      {
        variant: "warning",
        title: "Permission reviewer config",
        message: DENIAL_NOT_JEV,
      },
    ]);
  });

  test("absent lists clear the sidebar line", () => {
    const { notices } = tracked();
    notices.update({ configWarnings: [NOT_JEV] });
    expect(notices.sidebar()?.tone).toBe("warning");
    notices.update({});
    expect(notices.sidebar()).toBeUndefined();
  });

  test("refresh reads the status RPC, keeps only strings, and survives a failed call", async () => {
    const { notices, toasts } = tracked();
    const live = new AbortController();
    expect(
      await notices.refresh(
        async () => ({
          configWarnings: [NOT_JEV, 1],
          configDegraded: "broken",
        }),
        live.signal,
      ),
    ).toBe(true);
    expect(toasts.map((toast) => toast.message)).toEqual([NOT_JEV]);
    expect(
      await notices.refresh(async () => {
        throw new Error("no status method");
      }, live.signal),
    ).toBe(false);
    expect(notices.sidebar()?.text).toContain("model is not System One");
    live.abort();
    expect(
      await notices.refresh(async () => ({ configWarnings: [] }), live.signal),
    ).toBe(false);
    expect(notices.sidebar()).toBeDefined();
  });

  test("refresh keeps the reasoning reviewer's model, and reset drops it with the lists", async () => {
    const { notices } = tracked();
    const live = new AbortController();
    expect(notices.reasoningModel).toBeUndefined();
    await notices.refresh(
      async () => ({
        escalationReviewerModel: LUNA,
        configWarnings: [NOT_JEV],
      }),
      live.signal,
    );
    expect(notices.reasoningModel).toBe(LUNA);
    notices.reset();
    expect(notices.reasoningModel).toBeUndefined();
    expect(notices.sidebar()).toBeUndefined();
    await notices.refresh(
      async () => ({ escalationReviewerModel: 7 }),
      live.signal,
    );
    expect(notices.reasoningModel).toBeUndefined();
  });

  test("a failed or dropped refresh keeps the model it had", async () => {
    const { notices } = tracked();
    const live = new AbortController();
    await notices.refresh(
      async () => ({ escalationReviewerModel: LUNA }),
      live.signal,
    );
    await notices.refresh(async () => {
      throw new Error("offline");
    }, live.signal);
    expect(notices.reasoningModel).toBe(LUNA);
    live.abort();
    await notices.refresh(
      async () => ({ escalationReviewerModel: "openai/other" }),
      live.signal,
    );
    expect(notices.reasoningModel).toBe(LUNA);
  });
});
