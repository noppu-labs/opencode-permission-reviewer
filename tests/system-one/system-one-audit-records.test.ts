import { describe, expect, test } from "bun:test";
import type { ReviewAuditRecord } from "../../src/audit-record.ts";
import { decision, MockClient, request, runtime } from "../helpers.ts";
import { choice, response } from "./system-one-fixtures.ts";

describe("System One scores in V1 audit records", () => {
  async function withJevEndpoint<T>(
    body: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const previousKey = process.env.OPENCODE_API_KEY;
    const previousFetch = globalThis.fetch;
    process.env.OPENCODE_API_KEY = "synthetic-opencode-key";
    globalThis.fetch = (async () =>
      Response.json(body)) as unknown as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = previousKey;
    }
  }

  function audits(harness: ReturnType<typeof runtime>): ReviewAuditRecord[] {
    return (harness.ctx as unknown as { auditRecords: ReviewAuditRecord[] })
      .auditRecords;
  }

  test("records Jev-only scores and omits them for an invalid decision", async () => {
    const config = { model: "opencode/jev-1.13-free" };
    const allowed = runtime(new MockClient(), config);
    await withJevEndpoint(response(), () => allowed.runtime.process(request()));
    expect(audits(allowed)[0]).toMatchObject({
      outcome: "allow",
      decisionSource: "system-one-reviewer",
      systemOne: {
        returnedModel: "jev-1.13.0",
        outcome: { choice: "allow", confidence: 1 },
      },
    });

    const invalid = runtime(new MockClient(), config);
    await withJevEndpoint({ ...response(), model: "not-jev" }, () =>
      invalid.runtime.process(request()),
    );
    expect(audits(invalid)[0]?.decisionSource).toBe("failure-safe");
    expect(audits(invalid)[0]?.systemOne).toBeUndefined();
  });

  test("records Jev's scores beside the reasoning reviewer's decision", async () => {
    const client = new MockClient();
    client.nextStructured = decision("deny", { confidence: 0.9 });
    const harness = runtime(client, {
      model: "opencode/jev-1.13-free",
      escalationReviewer: {
        model: "openai/gpt-5.6-luna",
        variant: "medium",
        outputFormat: "json_schema",
        timeoutMs: 5_000,
      },
    });
    await withJevEndpoint(
      response({
        outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
      }),
      () => harness.runtime.process(request()),
    );
    const record = audits(harness)[0];
    expect(record).toMatchObject({
      outcome: "deny",
      reviewerModel: "openai/gpt-5.6-luna",
      confidence: 0.9,
      reviewerEscalatedFrom: { model: "opencode/jev-1.13-free" },
      systemOne: {
        outcome: { choice: "escalate", confidence: 0.6 },
        reasoningRecommended: true,
      },
    });
  });
});
