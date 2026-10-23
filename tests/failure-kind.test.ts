import { describe, expect, test } from "bun:test";
import { formatFailureReason } from "../src/modules/decision/failure-reason.ts";
import { failureKind } from "../src/modules/status/models/failure-kind.ts";

function named(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("failure kind", () => {
  test.each<[string, string | undefined]>([
    [
      "reasoning reviewer failed (TimeoutError): The operation timed out.",
      "timeout",
    ],
    [
      "System One reviewer failed (Error): Reviewer timed out after 90000ms",
      "timeout",
    ],
    ["System One reviewer failed (Error): Missing provider key", "error"],
    [
      "reasoning reviewer failed (ClientError, reason=Transport): Transport",
      "client",
    ],
    ["reasoning reviewer failed (UnknownError): boom", "unknown"],
    ["review failed: unknown error", undefined],
    ["Jev escalated the request.", undefined],
    ["", undefined],
  ])("reads %p as %p", (reason, kind) => {
    expect(failureKind(reason)).toBe(kind);
  });

  test("reads back what formatFailureReason writes", () => {
    expect(
      failureKind(
        formatFailureReason(
          "reasoning reviewer",
          named("TimeoutError", "slow"),
        ),
      ),
    ).toBe("timeout");
    expect(
      failureKind(
        formatFailureReason("System One reviewer", named("AbortError", "stop")),
      ),
    ).toBe("abort");
  });

  test.each([
    ["APIConnectionError", "transport"],
    ["RateLimitError", "rate-limit"],
    ["InternalServerError", "server"],
    ["AuthenticationError", "auth"],
    ["APIUserAbortError", "abort"],
    ["constructor", "constructor"],
  ])("reads the SDK's %p as %p", (name, kind) => {
    expect(
      failureKind(formatFailureReason("System One reviewer", named(name, "x"))),
    ).toBe(kind);
  });
});
