import { afterEach, describe, expect, test } from "bun:test";
import { setGlobalConfigPathForTests } from "../../src/config/loader.ts";
import { resolveConfig } from "../../src/config.ts";
import { buildEvidence, buildTranscript } from "../../src/context.ts";
import type { MessageWithParts } from "../../src/types.ts";
import { MockClient, request, runtime } from "../helpers.ts";
import { DIR, WT } from "./trust-fixtures.ts";

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

describe("trust hardening — evidence truncation", () => {
  const config = resolveConfig({
    maxContextChars: 4_000,
    maxPartChars: 500,
    transcriptMessages: 12,
  });

  function message(id: string, text: string): MessageWithParts {
    return { info: { id, role: "user" }, parts: [{ type: "text", text }] };
  }

  test("transcript overflow keeps the newest messages", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      message(`m${i}`, `MSG_${String(i).padStart(2, "0")}_${"x".repeat(900)}`),
    );
    const transcript = buildTranscript(messages, config);
    // The newest message survives the budget cut…
    expect(transcript).toContain("MSG_11");
    // …and the oldest message is dropped entirely (its unique prefix gone),
    // where a head-keeping truncation would have kept it and lost MSG_11.
    expect(transcript).not.toContain("MSG_00_");
  });

  test("an over-long pending command keeps head and tail with a middle elision marker", () => {
    const tail = "printf done; rm -rf /tmp/scratch-final-step";
    const command = `printf 'x'.repeat(5000) # ${"A".repeat(9000)}\n${tail}`;
    const envelope = {
      request: request({
        permission: "bash",
        patterns: ["*"],
        metadata: { command },
      }),
      directory: DIR,
      worktree: WT,
      transcript: "",
      intentHistory: "",
      enrichment: "",
      sshAudit: [],
    };
    const evidence = buildEvidence(envelope as never, config);
    expect(evidence).toContain("<elided");
    expect(evidence).toContain("rm -rf /tmp/scratch-final-step");
  });
});

describe("trust hardening — elided action evidence blocks automatic approval", () => {
  test("an LLM allow for a command whose middle was elided escalates instead", async () => {
    const client = new MockClient();
    const harness = runtime(client);
    const longCommand = `printf '${"x".repeat(9_000)}' ; rm -rf /tmp/scratch ; echo ${"y".repeat(9_000)}`;
    const result = await harness.runtime.process(
      request({ metadata: { command: longCommand }, patterns: [longCommand] }),
    );
    expect(result.kind).toBe("escalate");
    expect(result.reason).toContain("elided or truncated");
    expect(client.replies).toHaveLength(0);
    expect(client.uiStatuses.map((s) => s.phase)).toEqual([
      "reviewing",
      "manual",
    ]);
  });

  test("wrapper nesting beyond the lexer budget is denied before any model call", async () => {
    // The deterministic brake cannot resolve this structure within its
    // budget, so the request is rejected with the resource-limit reason
    // before evidence collection or a model call: a fooled model allow never
    // gets the chance to auto-approve it.
    const client = new MockClient();
    const harness = runtime(client);
    const command = `${"env -S ".repeat(33)}rm -rf /`;
    const result = await harness.runtime.process(
      request({ metadata: { command }, patterns: [command] }),
    );
    expect(result.kind).toBe("deny");
    expect(result.reason).toContain("exceeded the static analysis budget");
    expect(result.reason).not.toContain(
      "unmistakable broad system destruction",
    );
    // No reviewer session is ever created: the limit is resolved before any
    // model call, and the deny itself is delivered as the single reply.
    expect(client.creates).toHaveLength(0);
    expect(client.replies).toHaveLength(1);
  });

  test("a wide command past the total effective-command budget never reaches the model", async () => {
    // Thousands of independent segments each fit every per-segment ceiling;
    // only the shared per-request budget catches the total. The engine must
    // stop it deterministically without spending a review.
    const client = new MockClient();
    const harness = runtime(client);
    const command = Array.from(
      { length: 9_000 },
      (_, i) => `echo segment-${i}`,
    ).join(";");
    const result = await harness.runtime.process(
      request({ metadata: { command }, patterns: [command] }),
    );
    expect(result.kind).toBe("deny");
    expect(result.reason).toContain("exceeded the static analysis budget");
    expect(client.creates).toHaveLength(0);
    expect(client.replies).toHaveLength(1);
  });
});
