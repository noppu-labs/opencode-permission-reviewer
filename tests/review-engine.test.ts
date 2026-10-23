import { describe, expect, test } from "bun:test";
import { parseCommand } from "../src/modules/analysis/capability/command-parser.ts";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import {
  evaluateReview,
  type ReviewEnginePorts,
} from "../src/modules/review/services/review-engine.ts";
import type {
  PermissionRequest,
  PolicyRule,
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../src/types.ts";
import { decision, request } from "./helpers.ts";

const SUPERSEDED: ReviewExecutionResult = {
  kind: "escalate",
  reason: "Request already answered manually; automatic review superseded.",
  decisionSource: "manual-superseded",
};

const ALLOW: ReviewExecutionResult = {
  kind: "allow",
  reason: "narrow and requested",
  decision: decision("allow"),
  decisionSource: "llm-reviewer",
};

function envelopeFor(
  pending: PermissionRequest,
  overrides: Partial<ReviewEnvelope> = {},
): ReviewEnvelope {
  return {
    request: pending,
    directory: "/workspace",
    worktree: "/workspace",
    transcript: "",
    intentHistory: "",
    enrichment: "",
    sshAudit: [],
    ...overrides,
  };
}

interface PortOptions {
  /** 1-based call of `active()` that answers false; every other call is true. */
  inactiveAt?: number;
  envelope?: Partial<ReviewEnvelope>;
  review?: ReviewExecutionResult;
}

/** Fake ports that log each call in order, so the tests pin the call sequence. */
function loggedPorts(
  log: string[],
  options: PortOptions = {},
): ReviewEnginePorts {
  let activeCalls = 0;
  return {
    active: (): boolean => {
      activeCalls += 1;
      log.push(`active ${activeCalls}`);
      return activeCalls !== options.inactiveAt;
    },
    auxiliarySession: (sessionID: string): boolean => {
      log.push(`auxiliarySession ${sessionID}`);
      return false;
    },
    collect: async (pending: PermissionRequest): Promise<ReviewEnvelope> => {
      log.push("collect");
      return envelopeFor(pending, options.envelope);
    },
    review: async (
      envelope: ReviewEnvelope,
    ): Promise<ReviewExecutionResult> => {
      log.push(`review ${envelope.policyTrace?.finalRoute}`);
      return options.review ?? ALLOW;
    },
    observe: (envelope: ReviewEnvelope): void => {
      log.push(`observe ${envelope.policyTrace?.finalRoute}`);
    },
  };
}

function enforcing(effect: PolicyRule["effect"]): ReviewerConfig {
  return {
    ...DEFAULT_CONFIG,
    enforcementMode: "enforce",
    policyRules: [
      {
        id: `always-${effect}`,
        source: "global",
        effect,
        reason: `rule says ${effect}`,
        when: { always: true },
      },
    ],
  };
}

describe("evaluateReview", () => {
  const FULL_SEQUENCE = [
    "active 1",
    "auxiliarySession ses_main",
    "collect",
    "active 2",
    "observe review",
    "active 3",
    "review review",
    "active 4",
  ];

  test.each([
    [1, 1],
    [2, 4],
    [3, 6],
    [4, 8],
  ])(
    "active() answering false at call %d supersedes after the first %d port calls",
    async (inactiveAt, calls) => {
      const log: string[] = [];
      const result = await evaluateReview(
        request(),
        DEFAULT_CONFIG,
        loggedPorts(log, { inactiveAt }),
      );
      expect(result).toEqual(SUPERSEDED);
      expect(log).toEqual(FULL_SEQUENCE.slice(0, calls));
    },
  );

  test("an active review calls every port once, in order, and returns the reviewer's allow", async () => {
    const log: string[] = [];
    const result = await evaluateReview(
      request(),
      DEFAULT_CONFIG,
      loggedPorts(log),
    );
    expect(result).toEqual(ALLOW);
    expect(log).toEqual(FULL_SEQUENCE);
  });

  test("an enforce-mode allow route does not short-circuit: the reviewer still runs", async () => {
    const log: string[] = [];
    const result = await evaluateReview(
      request(),
      enforcing("allow"),
      loggedPorts(log),
    );
    expect(result).toEqual(ALLOW);
    expect(log).toEqual([
      "active 1",
      "auxiliarySession ses_main",
      "collect",
      "active 2",
      "observe allow",
      "active 3",
      "review allow",
      "active 4",
    ]);
  });

  test.each([
    ["deny", { kind: "deny" }],
    ["manual", { kind: "escalate", escalationDisposition: "manual" }],
  ] as const)(
    "an enforce-mode %s route returns before the third active() check",
    async (effect, expected) => {
      const log: string[] = [];
      const result = await evaluateReview(
        request(),
        enforcing(effect),
        loggedPorts(log),
      );
      expect(result).toMatchObject({
        ...expected,
        reason: `Declarative policy route: ${effect}. rule says ${effect}`,
        decisionSource: "deterministic-policy",
      });
      expect(log).toEqual([
        "active 1",
        "auxiliarySession ses_main",
        "collect",
        "active 2",
        `observe ${effect}`,
      ]);
    },
  );

  test.each([
    ["manual", "escalate"],
    ["deny", "deny"],
  ] as const)(
    "a truncated command analysis escalates without a reviewer call (escalationMode %s)",
    async (escalationMode, kind) => {
      const log: string[] = [];
      const result = await evaluateReview(
        request(),
        { ...DEFAULT_CONFIG, escalationMode },
        loggedPorts(log, {
          envelope: {
            parsedCommand: {
              ...parseCommand("printf safe"),
              analysisTruncated: true,
            },
          },
        }),
      );
      expect(result).toMatchObject({
        kind,
        escalationDisposition: escalationMode,
        decisionSource: "deterministic-policy",
      });
      expect(result.reason).toContain(
        "exceeded the static analysis depth or expansion budget",
      );
      expect(log).toEqual([
        "active 1",
        "auxiliarySession ses_main",
        "collect",
        "active 2",
        "observe review",
        "active 3",
      ]);
    },
  );

  test("a degraded-config gate on an allow without a decision keeps only the defined reviewer fields", async () => {
    const result = await evaluateReview(
      request(),
      { ...DEFAULT_CONFIG, configDegraded: ["global config is malformed"] },
      loggedPorts([], {
        review: {
          kind: "allow",
          reason: "fine",
          reviewSessionID: "ses_review",
          decisionSource: "llm-reviewer",
        },
      }),
    );
    expect(result).toEqual({
      kind: "escalate",
      reason:
        "Automatic approval is disabled: the reviewer configuration is degraded (global config is malformed). Fix the trusted config to restore auto-approval.",
      reviewSessionID: "ses_review",
      decisionSource: "deterministic-policy",
      escalationDisposition: "manual",
    });
  });

  test("an empty degraded list leaves the allow untouched", async () => {
    const result = await evaluateReview(
      request(),
      { ...DEFAULT_CONFIG, configDegraded: [] },
      loggedPorts([]),
    );
    expect(result).toEqual(ALLOW);
  });

  test("an unavailable verified ssh script adds the script guidance to an escalation", async () => {
    const pending = request({
      metadata: { command: "ssh host.invalid 'bash -s'" },
      patterns: ["ssh host.invalid 'bash -s'"],
    });
    const result = await evaluateReview(
      pending,
      DEFAULT_CONFIG,
      loggedPorts([], {
        envelope: {
          verifiedScript: {
            sha256: "0".repeat(64),
            destination: "host.invalid",
            shell: "bash",
            status: "unavailable",
            text: "",
          },
        },
        review: { kind: "escalate", reason: "needs a look" },
      }),
    );
    expect(result).toEqual({
      kind: "escalate",
      reason:
        "needs a look To inspect this script, stage its exact bytes locally and generate a hash-checked SSH command with opencode-permission-reviewer script command --file PATH --host HOST.",
      escalationDisposition: "manual",
    });
  });

  test("an allow is never given the script guidance", async () => {
    const pending = request({
      metadata: { command: "ssh host.invalid 'bash -s'" },
      patterns: ["ssh host.invalid 'bash -s'"],
    });
    const result = await evaluateReview(
      pending,
      DEFAULT_CONFIG,
      loggedPorts([], {
        envelope: {
          sshAudit: [
            {
              destination: "host.invalid",
              stdinStatus: "truncated",
            },
          ],
        },
      }),
    );
    expect(result).toEqual(ALLOW);
  });
});
