import type { ReviewAuditRecord } from "../src/audit-record.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { ReviewCoordinator as ApprovalReviewerRuntime } from "../src/core/review-coordinator.ts";
import { probeCapabilities } from "../src/opencode/capability-detection.ts";
import type {
  ClientResponse,
  OpenCodeClientLike,
  RuntimeContext,
} from "../src/opencode/types.ts";
import type { SystemOneScores } from "../src/system-one/system-one-types.ts";
import type {
  PermissionRequest,
  ReviewDecision,
  ReviewerConfig,
} from "../src/types.ts";
import type { ReviewUiStatus } from "../src/ui-protocol.ts";

/** Narrows a value a test expects to be present; a throw fails the test with a clear message. */
export function defined<T>(value: T | null | undefined, label = "value"): T {
  if (value == null) throw new Error(`expected ${label} to be defined`);
  return value;
}

export function decision(
  outcome: ReviewDecision["outcome"],
  overrides: Partial<ReviewDecision> = {},
): ReviewDecision {
  return {
    version: 2,
    outcome,
    risk_level: outcome === "deny" ? "high" : "low",
    user_authorization: outcome === "allow" ? "high" : "low",
    rationale:
      outcome === "allow"
        ? "The action is narrow, reversible, and explicitly requested."
        : "The action has unsafe unrequested effects.",
    confidence: 0.95,
    scope_alignment: "aligned",
    evidence_completeness: "sufficient",
    ...overrides,
  };
}

/** Synthetic Jev scores shaped like a parsed escalation handed to a reasoning reviewer. */
export function systemOneScores(): SystemOneScores {
  return {
    returnedModel: "jev-1.13.0",
    outcome: {
      choice: "escalate",
      confidence: 0.52,
      probabilities: { allow: 0.31, deny: 0.17, escalate: 0.52 },
    },
    supporting: {
      riskLevel: { choice: "medium", confidence: 0.64 },
      userAuthorization: { choice: "medium", confidence: 0.58 },
      scopeAlignment: { choice: "aligned", confidence: 0.81 },
      evidenceCompleteness: { choice: "partial", confidence: 0.47 },
      primaryBasis: { choice: "insufficient_evidence", confidence: 0.39 },
    },
    signals: {
      materialAuthorization: 0.62,
      withinIntentScope: 0.84,
      unauthorizedDataLoss: 0.21,
      untrustedSensitiveDisclosure: 0.03,
      excessiveCredentialAccess: 0.02,
      unauthorizedSecurityChange: 0.04,
      unauthorizedExternalMutation: 0.05,
      essentialEvidenceMissing: 0.44,
      absolutePolicyDeny: 0.06,
    },
    contradictions: [],
    reasoningRecommended: true,
  };
}

export function request(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: "per_1",
    sessionID: "ses_main",
    permission: "bash",
    patterns: ["printf safe"],
    metadata: { command: "printf safe" },
    always: ["printf *"],
    tool: { messageID: "msg_1", callID: "call_1" },
    ...overrides,
  };
}

export class MockClient implements OpenCodeClientLike {
  readonly creates: unknown[] = [];
  readonly messageQueries: unknown[] = [];
  readonly prompts: unknown[] = [];
  readonly deletes: unknown[] = [];
  readonly toolQueries: unknown[] = [];
  readonly replies: unknown[] = [];
  readonly uiStatuses: ReviewUiStatus[] = [];
  nextStructured: unknown = decision("allow");
  /** When set, `session.prompt` returns text parts instead of `info.structured`. */
  nextText: string | undefined;
  /** Per-call text responses for `session.prompt`; shifted in order, overrides `nextText`. */
  nextTexts: string[] = [];
  promptImpl?: (
    options: unknown,
  ) => Promise<ClientResponse<Record<string, unknown>>>;
  messagesImpl?: (options: unknown) => Promise<ClientResponse<unknown>>;
  messageData: unknown = [
    {
      info: { id: "msg_user", role: "user" },
      parts: [{ type: "text", text: "Run the narrow safe command." }],
    },
    {
      info: { id: "msg_assistant", role: "assistant" },
      parts: [
        {
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: { input: { command: "printf safe" } },
        },
      ],
    },
  ];
  createError?: unknown;
  messagesError?: unknown;
  promptError?: unknown;
  replyError?: unknown;
  publishStatusError?: unknown;
  toolIdsError?: unknown;
  /** Host MCP inventory the isolated-location guard reads. Empty means the
   *  location is MCP-free; tests set an entry to exercise the fail-closed path. */
  mcpServers: Record<string, unknown> = {};
  mcpError?: unknown;
  mcpStatusImpl?: (
    options: unknown,
  ) => Promise<ClientResponse<Record<string, unknown>>>;
  readonly mcpStatuses: unknown[] = [];
  private sessionCounter = 0;

  session: OpenCodeClientLike["session"];
  tool: OpenCodeClientLike["tool"];
  mcp: NonNullable<OpenCodeClientLike["mcp"]>;

  constructor() {
    this.session = {
      create: async (
        options: unknown,
      ): Promise<ClientResponse<Record<string, unknown>>> => {
        this.creates.push(options);
        if (this.createError !== undefined) return { error: this.createError };
        this.sessionCounter += 1;
        return { data: { id: `ses_review_${this.sessionCounter}` } };
      },
      messages: async (options: unknown): Promise<ClientResponse<unknown>> => {
        this.messageQueries.push(options);
        if (this.messagesImpl) return this.messagesImpl(options);
        if (this.messagesError !== undefined)
          return { error: this.messagesError };
        return { data: this.messageData };
      },
      prompt: async (
        options: unknown,
      ): Promise<ClientResponse<Record<string, unknown>>> => {
        this.prompts.push(options);
        if (this.promptImpl) return this.promptImpl(options);
        if (this.promptError !== undefined) return { error: this.promptError };
        if (this.nextTexts.length > 0) {
          const text = defined(this.nextTexts.shift(), "queued review text");
          return {
            data: {
              info: { id: "msg_review", role: "assistant" },
              parts: [{ type: "text", text }],
            },
          };
        }
        if (this.nextText !== undefined) {
          return {
            data: {
              info: { id: "msg_review", role: "assistant" },
              parts: [{ type: "text", text: this.nextText }],
            },
          };
        }
        return { data: { info: { structured: this.nextStructured } } };
      },
      delete: async (options: unknown): Promise<ClientResponse<unknown>> => {
        this.deletes.push(options);
        return { data: true };
      },
    };
    this.tool = {
      ids: async (options?: unknown): Promise<ClientResponse<string[]>> => {
        this.toolQueries.push(options);
        if (this.toolIdsError !== undefined)
          return { error: this.toolIdsError };
        return { data: ["bash", "read", "write", "webfetch", "task"] };
      },
    };
    this.mcp = {
      status: async (
        options?: unknown,
      ): Promise<ClientResponse<Record<string, unknown>>> => {
        this.mcpStatuses.push(options);
        if (this.mcpStatusImpl) return this.mcpStatusImpl(options);
        if (this.mcpError !== undefined) return { error: this.mcpError };
        return { data: this.mcpServers };
      },
    };
  }

  permissionReply = async (
    options: unknown,
  ): Promise<ClientResponse<boolean>> => {
    this.replies.push(options);
    if (this.replyError !== undefined) return { error: this.replyError };
    return { data: true };
  };

  publishUiStatus = async (
    status: ReviewUiStatus,
  ): Promise<ClientResponse<boolean>> => {
    this.uiStatuses.push(status);
    if (this.publishStatusError !== undefined)
      return { error: this.publishStatusError };
    return { data: true };
  };
}

export function config(
  overrides: Partial<ReviewerConfig> = {},
): ReviewerConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export function runtime(
  client = new MockClient(),
  configOverrides: Partial<ReviewerConfig> = {},
  logger?: (message: string, details?: unknown) => void,
  contextOverrides: Partial<
    Pick<RuntimeContext, "directory" | "worktree" | "reviewerDirectoryBase">
  > = {},
): {
  runtime: ApprovalReviewerRuntime;
  client: MockClient;
  ctx: RuntimeContext;
} {
  const auditRecords: ReviewAuditRecord[] = [];
  const ctx: RuntimeContext = {
    client,
    capabilities: probeCapabilities(client),
    permissionReply: client.permissionReply,
    publishUiStatus: client.publishUiStatus,
    writeAudit: async (record: ReviewAuditRecord): Promise<void> => {
      auditRecords.push(record);
    },
    directory: contextOverrides.directory ?? "/workspace/project",
    worktree:
      contextOverrides.worktree ??
      contextOverrides.directory ??
      "/workspace/project",
    // Reviewer sessions must not be created in the developer's real HOME
    // during tests: point isolation at a scratch directory under the OS temp
    // root (created lazily by the coordinator).
    reviewerDirectoryBase:
      contextOverrides.reviewerDirectoryBase ??
      `${import.meta.dir}/.tmp-reviewer-isolated`,
  };
  return {
    runtime: new ApprovalReviewerRuntime(ctx, config(configOverrides), logger),
    client,
    ctx: Object.assign(ctx, { auditRecords }),
  };
}
