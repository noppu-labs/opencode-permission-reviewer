import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { stableJson } from "../src/context/prompt-budget.ts";
import { buildTranscript } from "../src/context.ts";
import type { MessageWithParts, ReviewerConfig } from "../src/types.ts";

const cfg = (maxPartChars: number): ReviewerConfig => ({
  ...DEFAULT_CONFIG,
  maxPartChars,
});

const message = (
  id: string,
  role: string,
  parts: Array<Record<string, unknown>>,
): MessageWithParts => ({ info: { id, role }, parts });

describe("buildTranscript — one line per part kind", () => {
  test("files, tools, unknown kinds and untyped parts are serialized; step markers are not", () => {
    const file = {
      type: "file",
      mime: "text/plain",
      filename: "a.txt",
      url: "file:///a.txt",
      source: "dropped",
    };
    const tool = {
      type: "tool",
      tool: "bash",
      callID: "c1",
      state: { status: "completed" },
      metadata: "dropped",
    };
    const patch = { type: "patch", hash: "h1", files: ["x.ts"] };
    const untyped = { type: 7, note: "untyped" };
    const transcript = buildTranscript(
      [
        message("a1", "assistant", [
          file,
          { type: "step-start" },
          tool,
          { type: "step-finish" },
          patch,
          { type: "snapshot", snapshot: "abc" },
          untyped,
          { type: "text", text: "  " },
          { type: "text", text: "Done" },
        ]),
        message("a2", "assistant", [
          { type: "step-start" },
          { type: "snapshot" },
        ]),
      ],
      cfg(500),
    );
    expect(transcript).toBe(
      [
        "MESSAGE role=assistant id=a1",
        `file: ${stableJson({ mime: "text/plain", filename: "a.txt", url: "file:///a.txt" }, 1_000)}`,
        `tool: ${stableJson({ type: "tool", tool: "bash", callID: "c1", state: { status: "completed" } }, 500)}`,
        `patch: ${stableJson(patch, 500)}`,
        `unknown: ${stableJson(untyped, 500)}`,
        "text: Done",
      ].join("\n"),
    );
  });

  test("unknown kinds are bounded by the smaller of the part budget and 2000", () => {
    const patch = { type: "patch", body: "x".repeat(3_000) };
    const run = (max: number): string =>
      buildTranscript([message("a1", "assistant", [patch])], cfg(max));
    expect(run(3_000)).toBe(
      `MESSAGE role=assistant id=a1\npatch: ${stableJson(patch, 2_000)}`,
    );
    expect(run(100)).toBe(
      `MESSAGE role=assistant id=a1\npatch: ${stableJson(patch, 100)}`,
    );
  });

  test("synthetic text is dropped from user messages only", () => {
    const parts = [
      { type: "text", text: "Flagged", synthetic: true },
      { type: "text", text: "Ignored", ignored: true },
      { type: "text", text: " magic compact: compaction in progress " },
      { type: "text", text: "You have 40 WEIGHTED tokens left" },
      { type: "text", text: "Kept" },
    ];
    const transcript = buildTranscript(
      [message("u1", "user", parts), message("a1", "assistant", parts)],
      cfg(500),
    );
    expect(transcript).toBe(
      [
        "MESSAGE role=user id=u1\ntext: Kept",
        [
          "MESSAGE role=assistant id=a1",
          "text: Flagged",
          "text: Ignored",
          "text:  magic compact: compaction in progress ",
          "text: You have 40 WEIGHTED tokens left",
          "text: Kept",
        ].join("\n"),
      ].join("\n\n"),
    );
  });
});
