import { describe, expect, test } from "bun:test";
import type { ReviewAuditRecord } from "../src/audit-record.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { ATTEMPT_REGISTERED } from "../src/core/review-coordinator-support.ts";
import {
  attemptWith,
  auditCall,
  FULL_EVIDENCE,
  FULL_RESULT,
  fullRecord,
  sinkContext,
  writeAudit,
} from "./coordinator-audit-fixtures.ts";
import { defined, request } from "./helpers.ts";
import { actor, capability } from "./policy-fixtures.ts";

const ALLOW = { kind: "allow", reason: "ok" } as const;

describe("writeReviewAudit", () => {
  test("without an audit sink it returns before the attempt lookup and the supersede check", async () => {
    const ctx = sinkContext([]);
    delete ctx.writeAudit;
    const call = auditCall(ctx, [], ALLOW);
    await writeAudit(call);
    expect(call.supersededChecks).toEqual([]);
  });

  test("with an audit sink and no registered attempt it fails the registration invariant", async () => {
    await expect(
      writeAudit(auditCall(sinkContext([]), [], ALLOW)),
    ).rejects.toThrow(ATTEMPT_REGISTERED);
  });

  test("a result without a decision source and with a decision records llm-reviewer; the full record keeps its key order", async () => {
    const records: ReviewAuditRecord[] = [];
    const pending = request();
    const call = auditCall(
      sinkContext(records, { hostVersion: "1.2.3" }),
      [attemptWith(FULL_EVIDENCE)],
      FULL_RESULT,
    );
    await writeAudit(call, pending);
    expect(call.supersededChecks).toEqual([pending.id]);
    expect(records).toHaveLength(1);
    const { timestamp, durationMs, ...stable } = defined(
      records[0],
      "audit record",
    );
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(stable)).toBe(JSON.stringify(fullRecord(stable)));
  });

  test("a result without a decision source or decision records failure-safe; empty facts drop their keys", async () => {
    const records: ReviewAuditRecord[] = [];
    const bare = actor("unknown");
    const call = auditCall(
      sinkContext(records),
      [
        attemptWith(
          {
            sshAudit: [],
            actor: {
              ...bare,
              agentName: { ...bare.agentName, value: undefined },
              mode: { ...bare.mode, value: undefined },
            },
            capability: capability({ executesCode: false }),
            verifiedScript: {
              sha256: "b".repeat(64),
              destination: "host.invalid",
              shell: "sh",
              status: "unavailable",
              text: "",
            },
          },
          "human-pending",
        ),
      ],
      { kind: "escalate", reason: "unsure" },
    );
    call.superseded = true;
    await writeAudit(call);
    const record = defined(records[0], "audit record");
    expect(record).toMatchObject({
      decisionSource: "failure-safe",
      hostVersion: "unknown",
      application: "superseded",
      reviewerModel: DEFAULT_CONFIG.model,
    });
    expect(JSON.stringify(record.verifiedScript)).toBe(
      JSON.stringify({ sha256: "b".repeat(64), status: "unavailable" }),
    );
    expect(record.actor).toEqual({
      profile: "unknown",
      identityCompleteness: "complete",
      identitySource: "static-analysis",
      confidence: "high",
      delegationDepth: 0,
    });
    expect(record.capability).toEqual({
      actionClass: "read-only",
      summary: "read-only",
      parserCompleteness: "complete-for-supported-form",
      writeEffects: {},
    });
    const absent = [
      "warnings",
      "timings",
      "evidenceCompleteness",
      "riskLevel",
      "reviewerSessionID",
      "ssh",
      "policyTrace",
      "askDecisions",
    ];
    expect(absent.filter((key) => Object.hasOwn(record, key))).toEqual([]);
  });

  test.each([
    ["an Error", new Error("disk full"), "disk full"],
    ["a non-Error value", "sink closed", "sink closed"],
  ])(
    "a sink that rejects with %s is logged, not thrown",
    async (_label, failure, message) => {
      const call = auditCall(
        sinkContext([], {
          writeAudit: (): Promise<void> => Promise.reject(failure),
        }),
        [attemptWith({})],
        ALLOW,
      );
      await writeAudit(call);
      expect(call.logs).toEqual([
        [
          "failed to write review audit",
          { requestID: "per_1", error: message },
        ],
      ]);
    },
  );
});
