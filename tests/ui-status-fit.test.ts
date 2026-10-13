import { describe, expect, test } from "bun:test";
import {
  createUiStatus,
  decodeUiStatus,
  encodeUiStatus,
  type ReviewUiStatus,
} from "../src/ui-protocol.ts";
import { fitStatus, MAX_STATUS_BYTES } from "../src/ui-status-extras.ts";
import { decision, request } from "./helpers.ts";

/** A character JSON escapes to six bytes. */
const ESCAPED = "\u0001";
const CJK = "界";
const options = {
  model: "openai/gpt-6-luna",
  variant: "max",
  timeoutMs: 120_000,
  emittedAt: 1,
};

const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

/** The status decodes back to itself and fits the cap. */
function expectFits(status: ReviewUiStatus): void {
  expect(jsonBytes(status)).toBeLessThanOrEqual(MAX_STATUS_BYTES);
  expect(decodeUiStatus(encodeUiStatus(status))).toEqual(status);
}

describe("whole-status size fit", () => {
  test("a status under the cap comes back as the same object", () => {
    const status = createUiStatus(request(), "denied", {
      ...options,
      reason: "Concrete reason",
      decision: decision("deny"),
      configWarnings: ["a warning"],
    });
    expect(fitStatus(status)).toBe(status);
    expect(status.reason).toBe("Concrete reason");
    expect(status.decision?.rationale).toBe(
      "The action has unsafe unrequested effects.",
    );
    expectFits(status);
  });

  test("a 2000-character reason of escaped characters is shortened to fit", () => {
    const status = createUiStatus(request(), "denied", {
      ...options,
      reason: ESCAPED.repeat(2_000),
      decision: decision("deny"),
    });
    expect(status.reason).toEndWith("…");
    expect(status.reason?.slice(0, -1)).toBe(
      ESCAPED.repeat((status.reason?.length ?? 0) - 1),
    );
    expect(status.decision?.rationale).toBe(
      "The action has unsafe unrequested effects.",
    );
    expectFits(status);
  });

  test("cuts the reason by no more than the overflow needs", () => {
    const base = createUiStatus(request(), "denied", options);
    const room = MAX_STATUS_BYTES - jsonBytes({ ...base, reason: "" });
    const status = fitStatus({ ...base, reason: "r".repeat(room + 1) });
    expect(status.reason).toBe(`${"r".repeat(room - 3)}…`);
    expect(jsonBytes(status)).toBe(MAX_STATUS_BYTES);
  });

  test("a 2000-character CJK reason and rationale shorten the reason first", () => {
    const status = createUiStatus(request(), "denied", {
      ...options,
      reason: CJK.repeat(2_000),
      decision: decision("deny", { rationale: CJK.repeat(2_000) }),
    });
    expect(status.reason).toEndWith("…");
    expect(status.reason?.slice(0, -1)).toBe(
      CJK.repeat((status.reason?.length ?? 0) - 1),
    );
    expect(status.decision?.rationale).toBe(CJK.repeat(2_000));
    expectFits(status);
  });

  test("shortens the rationale once the reason is used up", () => {
    const status = createUiStatus(request(), "denied", {
      ...options,
      reason: "r".repeat(100),
      decision: decision("deny", { rationale: ESCAPED.repeat(2_000) }),
    });
    expect(status.reason).toBe("…");
    expect(status.decision?.rationale).toEndWith("…");
    expect(status.decision?.rationale.length).toBeGreaterThan(1_000);
    expectFits(status);
  });

  test("cuts 4-byte characters on code-point boundaries", () => {
    const astral = "😀".repeat(4_000);
    const status = fitStatus({
      ...createUiStatus(request(), "denied", options),
      reason: astral,
      decision: decision("deny", { rationale: astral }),
    });
    expect(status.reason).toBe("…");
    expect(status.decision?.rationale).toEndWith("😀…");
    const rationale = status.decision?.rationale ?? "";
    expect(Buffer.from(rationale, "utf8").toString("utf8")).toBe(rationale);
    expectFits(status);
  });

  test("leaves a reason no longer than the ellipsis as it is", () => {
    const base = createUiStatus(request({ id: "i".repeat(13_000) }), "denied", {
      ...options,
      reason: "ok",
    });
    expect(fitStatus(base).reason).toBe("ok");
  });

  test("a maximal script analysis of escaped characters is shortened last", () => {
    const status = createUiStatus(
      request({ metadata: { command: ESCAPED.repeat(500) } }),
      "denied",
      {
        model: ESCAPED.repeat(200),
        variant: ESCAPED.repeat(100),
        timeoutMs: 120_000,
        emittedAt: 1,
        decidedBy: ESCAPED.repeat(200),
        reason: ESCAPED.repeat(2_000),
        decision: decision("deny", {
          rationale: ESCAPED.repeat(2_000),
          script_analysis: ESCAPED.repeat(1_500),
        }),
      },
    );
    const analysis = status.decision?.script_analysis ?? "";
    expect(status.reason).toBe("…");
    expect(status.decision?.rationale).toBe("…");
    expect(analysis).toEndWith("…");
    expect(analysis.length).toBeGreaterThan(1);
    expect(analysis.slice(0, -1)).toBe(ESCAPED.repeat(analysis.length - 1));
    expectFits(status);
  });
});
