import { describe, expect, test } from "bun:test";
import { invariant } from "../src/invariant.ts";

describe("invariant", () => {
  test("returns when the condition holds", () => {
    expect(() => invariant({ value: "x" }, "unused")).not.toThrow();
  });

  test("throws an Error carrying the message when the condition fails", () => {
    expect(() => invariant(undefined, "tokens[i] is in bounds")).toThrow(
      new Error("tokens[i] is in bounds"),
    );
  });
});
