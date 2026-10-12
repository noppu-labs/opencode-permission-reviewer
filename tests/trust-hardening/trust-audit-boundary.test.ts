import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAuditWriter, readAuditSummary } from "../../src/audit.ts";
import { setGlobalConfigPathForTests } from "../../src/config/loader.ts";
import { resolveConfig } from "../../src/config.ts";
import { GITHUB_PAT_ALPHANUMERIC } from "../fixtures/synthetic-secrets.ts";
import { defined, toJsonl } from "../helpers.ts";
import { tempDir } from "./trust-fixtures.ts";

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

describe("trust hardening — audit output boundary", () => {
  test("readAuditSummary tolerates a record with actor null", () => {
    const file = join(tempDir("reviewer-audit-"), "audit.jsonl");
    try {
      writeFileSync(
        file,
        toJsonl([
          {
            timestamp: "2026-01-01T00:00:00.000Z",
            requestID: "r1",
            sessionID: "s1",
            permission: "bash",
            outcome: "allow",
            reason: "ok",
            actor: null,
          },
        ]),
      );
      const summary = readAuditSummary(file);
      expect(summary.validRecords).toBe(1);
      expect(summary.invalidLines).toBe(0);
      expect(
        defined(summary.unknownActorNames[0], "unknown actor name").name,
      ).toBe("(unnamed)");
    } finally {
      rmSync(join(file, ".."), { recursive: true });
    }
  });

  test("the audit writer redacts secrets from the serialized record", async () => {
    const dir = tempDir("reviewer-audit-");
    const file = join(dir, "audit.jsonl");
    try {
      const secret = GITHUB_PAT_ALPHANUMERIC;
      const config = resolveConfig({ audit: true, auditPath: file });
      const write = defined(createAuditWriter(config), "audit writer");
      await write({
        schemaVersion: 2,
        decisionSchemaVersion: 2,
        promptVersion: "test",
        decisionSource: "failure-safe",
        actionHash: "0".repeat(64),
        reviewerModel: config.model,
        timestamp: new Date().toISOString(),
        durationMs: 1,
        requestID: "r1",
        sessionID: "s1",
        permission: "bash",
        outcome: "escalate",
        reason: `transport failed: fetch https://x.invalid?key=${secret}`,
      });
      const line = readFileSync(file, "utf8").trim();
      expect(line).not.toContain(secret);
      expect(line).toContain("[REDACTED");
      // Structural identifiers must survive redaction: the redactor's generic
      // credential-assignment rule would match a serialized `"sessionID":`
      // key and corrupt the record's correlation fields.
      expect(line).toContain('"sessionID":"s1"');
      expect(line).toContain('"requestID":"r1"');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
