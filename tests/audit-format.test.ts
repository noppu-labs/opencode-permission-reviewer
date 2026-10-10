import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuditWriter,
  readAuditSummary,
  resolveAuditPath,
} from "../src/audit.ts";
import type { ReviewAuditRecord } from "../src/audit-record.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { redactSecrets } from "../src/redact.ts";
import { GITHUB_PAT_ALPHANUMERIC } from "./fixtures/synthetic-secrets.ts";
import { defined, systemOneScores } from "./helpers.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "approval-reviewer-format-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const identity = {
  requestID: "r",
  sessionID: "s",
  permission: "bash",
  outcome: "allow",
  reason: "ok",
};

// One line per summary branch; the expected summary below counts each.
const MIXED_LINES = [
  JSON.stringify({
    timestamp: "2026-01-02T00:00:00.000Z",
    ...identity,
    schemaVersion: 2,
    hostGeneration: "v2",
    application: "reply-accepted",
    riskLevel: "low",
    decisionSource: "system-one-reviewer",
    actor: { name: "build", profile: "primary" },
  }),
  JSON.stringify({
    timestamp: "2026-01-01T00:00:00.000Z",
    ...identity,
    sessionID: undefined,
    outcome: 5,
    permission: 7,
    hostGeneration: "v1",
    application: "bogus",
    actor: { name: "helper", profile: "unknown" },
  }),
  JSON.stringify({
    timestamp: 3,
    ...identity,
    schemaVersion: null,
    hostGeneration: "v3",
    application: 9,
  }),
  JSON.stringify({
    timestamp: "2026-01-03T00:00:00.000Z",
    ...identity,
    application: "human-pending",
    actor: { profile: "primary" },
  }),
  `${JSON.stringify({ ...identity, actor: { name: "x" } })}\r`,
  JSON.stringify({ ...identity, actor: { name: "", profile: "primary" } }),
  JSON.stringify({ ...identity, actor: "primary" }),
  JSON.stringify({ outcome: "deny" }),
  "not json",
  "42",
  "null",
  "[1]",
  '"text"',
  "   ",
  "",
];

describe("audit summary counts", () => {
  test("summarizes every record shape the reader distinguishes", () => {
    const file = join(directory, "audit.jsonl");
    writeFileSync(file, `${MIXED_LINES.join("\n")}\n`);
    expect(readAuditSummary(file)).toEqual({
      path: file,
      exists: true,
      truncated: false,
      totalLines: 13,
      validRecords: 8,
      invalidLines: 5,
      bySchemaVersion: { "1": 7, "2": 1 },
      byHostGeneration: { v1: 1, v2: 1, "legacy-unspecified": 6 },
      byApplication: { "reply-accepted": 1, "human-pending": 1 },
      byOutcome: { allow: 6, deny: 1 },
      byRiskLevel: { low: 1, "(none)": 7 },
      byDecisionSource: { "system-one-reviewer": 1 },
      byPermission: { bash: 6 },
      unknownActorNames: [
        { name: "(no actor field)", count: 2 },
        { name: "(unnamed)", count: 2 },
        { name: "", count: 1 },
        { name: "helper", count: 1 },
        { name: "x", count: 1 },
      ],
      missingRequiredFields: [
        { lineNo: 2, missing: ["sessionID"] },
        { lineNo: 5, missing: ["timestamp"] },
        { lineNo: 6, missing: ["timestamp"] },
        { lineNo: 7, missing: ["timestamp"] },
        {
          lineNo: 8,
          missing: [
            "timestamp",
            "requestID",
            "sessionID",
            "permission",
            "reason",
          ],
        },
      ],
      firstTimestamp: "2026-01-01T00:00:00.000Z",
      lastTimestamp: "2026-01-03T00:00:00.000Z",
    });
  });

  test("an empty file exists with nothing counted and no timestamps", () => {
    const file = join(directory, "audit.jsonl");
    writeFileSync(file, "");
    const summary = readAuditSummary(file);
    expect(summary).toMatchObject({ exists: true, totalLines: 0 });
    expect("firstTimestamp" in summary).toBe(false);
    expect("lastTimestamp" in summary).toBe(false);
  });

  test("a missing file returns the empty summary", () => {
    const file = join(directory, "absent.jsonl");
    expect(readAuditSummary(file)).toEqual({
      path: file,
      exists: false,
      truncated: false,
      totalLines: 0,
      validRecords: 0,
      invalidLines: 0,
      bySchemaVersion: {},
      byHostGeneration: {},
      byApplication: {},
      byOutcome: {},
      byRiskLevel: {},
      byDecisionSource: {},
      byPermission: {},
      unknownActorNames: [],
      missingRequiredFields: [],
    });
  });
});

describe("audit path", () => {
  test("resolves the configured path, or the default one", () => {
    expect(
      resolveAuditPath({ ...DEFAULT_CONFIG, auditPath: "~/audit.jsonl" }),
    ).toBe(join(homedir(), "audit.jsonl"));
    expect(resolveAuditPath(DEFAULT_CONFIG)).toBe(
      join(homedir(), ".local/share/opencode/permission-reviewer-audit.jsonl"),
    );
  });
});

describe("audit line bytes", () => {
  const token = GITHUB_PAT_ALPHANUMERIC;

  async function writtenLine(record: ReviewAuditRecord): Promise<string> {
    const file = join(directory, "audit.jsonl");
    const write = defined(
      createAuditWriter({ ...DEFAULT_CONFIG, audit: true, auditPath: file }),
      "audit writer",
    );
    await write(record);
    return readFileSync(file, "utf8");
  }

  test("a record without optional fields keeps its key order", async () => {
    const record: ReviewAuditRecord = {
      timestamp: "2026-01-01T00:00:00.000Z",
      durationMs: 3,
      requestID: "per_1",
      sessionID: "ses_1",
      permission: "bash",
      outcome: "allow",
      reason: "  first\r\nsecond  ",
    };
    expect(await writtenLine(record)).toBe(
      `${JSON.stringify({ ...record, reason: "first second" })}\n`,
    );
  });

  test("a record with every sanitised field is written byte for byte", async () => {
    const scores = {
      ...systemOneScores(),
      returnedModel: `jev-${"m".repeat(200)}`,
    };
    const record: ReviewAuditRecord = {
      timestamp: "2026-01-01T00:00:00.000Z",
      durationMs: 3,
      requestID: "per_1",
      sessionID: "ses_1",
      permission: "bash",
      outcome: "deny",
      reason: `token ${token}`,
      warnings: [`warned ${token}`, "plain"],
      policyTrace: {
        effectivePolicyHash: "abcd",
        matchedRules: [
          {
            id: "r1",
            source: "global",
            effect: "deny",
            reason: `rule ${token}`,
          },
        ],
        finalRoute: "deny",
        mode: "enforce",
      },
      askDecisions: [{ at: 1, question: `use ${token}?`, answer: token }],
      reviewerModel: "openai/gpt-5.6-luna",
      reviewerEscalatedFrom: {
        model: "opencode/jev-1.13-free",
        reason: `escalated\n${token}`,
      },
      systemOne: scores,
    };
    const expected = {
      ...record,
      reason: redactSecrets(`token ${token}`),
      warnings: [redactSecrets(`warned ${token}`), "plain"],
      policyTrace: {
        effectivePolicyHash: "abcd",
        matchedRules: [
          {
            id: "r1",
            source: "global",
            effect: "deny",
            reason: redactSecrets(`rule ${token}`),
          },
        ],
        finalRoute: "deny",
        mode: "enforce",
      },
      askDecisions: [
        {
          at: 1,
          question: redactSecrets(`use ${token}?`),
          answer: redactSecrets(token),
        },
      ],
      reviewerEscalatedFrom: {
        model: "opencode/jev-1.13-free",
        reason: redactSecrets(`escalated ${token}`),
      },
      systemOne: { ...scores, returnedModel: `jev-${"m".repeat(124)}…` },
    };
    const line = await writtenLine(record);
    expect(line).not.toContain(token);
    expect(line).toBe(`${JSON.stringify(expected)}\n`);
  });
});
