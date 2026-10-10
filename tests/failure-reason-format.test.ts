import { describe, expect, test } from "bun:test";
import { formatFailureReason } from "../src/failure-reason.ts";

function withCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

function throwingCause(message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "cause", {
    get(): never {
      throw new Error("cause getter");
    },
  });
  return error;
}

describe("failure reason for non-error throws", () => {
  test.each<[string, unknown, string]>([
    [
      "a string",
      "string failure",
      "probe failed (UnknownError): string failure",
    ],
    ["undefined", undefined, "probe failed (UnknownError): undefined"],
    ["an empty string", "", "probe failed (UnknownError): unknown error"],
    [
      "a value without a string form",
      Object.create(null),
      "probe failed (UnknownError): unknown error",
    ],
  ])("%s", (_label, error, expected) => {
    expect(formatFailureReason("probe", error)).toBe(expected);
  });

  test("a long value is truncated to 500 characters", () => {
    const reason = formatFailureReason("probe", "y".repeat(600));
    expect(reason).toBe(
      `probe failed (UnknownError): ${"y".repeat(497 - 29)}...`,
    );
  });
});

describe("failure reason cause chain", () => {
  test.each<[string, Error, string]>([
    ["no cause", new Error("boom"), "probe failed (Error): boom"],
    ["a null cause", withCause("boom", null), "probe failed (Error): boom"],
    [
      "a string cause ends the chain",
      withCause("boom", "socket closed"),
      "probe failed (Error): boom; caused by: socket closed",
    ],
    [
      "an empty string cause is skipped",
      withCause("boom", ""),
      "probe failed (Error): boom",
    ],
    [
      "an object cause",
      withCause("boom", { code: 1 }),
      "probe failed (Error): boom; caused by: [object Object]",
    ],
    [
      "an error cause without a message",
      withCause("boom", new Error("")),
      "probe failed (Error): boom; caused by: Error",
    ],
    [
      "two causes, the third dropped",
      withCause("boom", withCause("one", withCause("two", new Error("three")))),
      "probe failed (Error): boom; caused by: one; caused by: two",
    ],
    [
      "a throwing cause getter on the error",
      throwingCause("boom"),
      "probe failed (Error): boom",
    ],
    [
      "a throwing cause getter on the first cause",
      withCause("boom", throwingCause("one")),
      "probe failed (Error): boom; caused by: one",
    ],
  ])("%s", (_label, error, expected) => {
    expect(formatFailureReason("probe", error)).toBe(expected);
  });

  test("a reason code and a name are carried into the label", () => {
    const error = new TypeError("bad") as TypeError & { reason?: unknown };
    error.reason = 503;
    expect(formatFailureReason("  probe  ", error)).toBe(
      "probe failed (TypeError, reason=503): bad",
    );
  });

  test("a result of exactly 500 characters is not truncated", () => {
    const base = "probe failed (Error): ";
    const message = "z".repeat(500 - base.length);
    expect(formatFailureReason("probe", new Error(message))).toBe(
      `${base}${message}`,
    );
  });

  test("a value whose type check throws falls back to the generic reason", () => {
    const hostile = new Proxy(new Error("boom"), {
      getPrototypeOf(): never {
        throw new Error("prototype trap");
      },
    });
    expect(formatFailureReason("probe", hostile)).toBe(
      "review failed: unknown error",
    );
  });
});
