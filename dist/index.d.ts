import { Plugin as Plugin$1 } from '@opencode-ai/plugin';
import { Plugin } from '@opencode/plugin';

interface ShellToken {
    /** Original text including any surrounding quotes. */
    raw: string;
    /** Unquoted/normalized value used for comparisons. */
    value: string;
    /** Value split into spans by quoting: every character of `value` appears
     *  in exactly one span, marked `quoted` when it came from inside quotes
     *  or from a backslash escape. An operator character (`>`, `*`, …) only
     *  acts as an operator while it sits in an UNQUOTED span: a glued, partly
     *  quoted `>"/dev/sda"` still redirects, while `'>/dev/sda'` is data. */
    spans?: Array<{
        text: string;
        quoted: boolean;
    }>;
}
interface ShellSegment {
    tokens: ShellToken[];
    /** Separator that terminated this segment (`;`, `|`, `||`, `&`, `&&`, `(`,
     *  `)`). Newlines and carriage returns are reported as `;`. Absent for the
     *  final segment when the command does not end with a separator. A segment
     *  with no tokens and `endedBy` `(` or `)` is a paren marker: it exists so
     *  grouping events are never lost, and carries no command of its own. */
    endedBy?: string;
    /** The last separator seen before this segment's first token, counting
     *  separators whose (empty) segment was dropped: in `( a ) | b`, segment
     *  `b` ended up after a dropped empty segment, so its separator lineage is
     *  `)` and then `|`, and `precededBy` reports `|`. Absent for the first
     *  segment. */
    precededBy?: string;
}

interface VerifiedScriptEvidence {
    sha256: string;
    destination: string;
    port?: number;
    shell: "bash" | "sh";
    bytes?: number;
    status: "full" | "reused" | "unavailable";
    text: string;
    cacheKey?: string;
}

type RiskLevel = "low" | "medium" | "high" | "critical";
type UserAuthorization = "high" | "medium" | "low" | "unknown";
type ReviewOutcome = "allow" | "deny" | "escalate";
type ScopeAlignment = "aligned" | "partial" | "misaligned" | "unknown";
type EvidenceSufficiency = "sufficient" | "partial" | "insufficient" | "unknown";
/** How final escalations are disposed after reviewer/policy/fail-safe produce them. */
type EscalationMode = "manual" | "deny";
/** Effective disposition applied to an internal escalate result. */
type EscalationDisposition = "manual" | "deny";
interface ReviewDecision {
    /** Structured-decision schema version. Always 2 for the current schema. */
    version: 2;
    outcome: ReviewOutcome;
    risk_level: RiskLevel;
    user_authorization: UserAuthorization;
    /** How well the request aligns with the recovered user/delegated intent. */
    scope_alignment: ScopeAlignment;
    /** Whether the evidence was sufficient to decide confidently. */
    evidence_completeness: EvidenceSufficiency;
    rationale: string;
    confidence: number;
    /** Optional script-only semantic analysis. Never conveys authorization. */
    script_analysis?: string;
}
interface PermissionToolSource {
    messageID: string;
    callID: string;
}
interface PermissionRequest {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
    always: string[];
    tool?: PermissionToolSource;
}
interface MessageWithParts {
    info: Record<string, unknown> & {
        id?: string;
        role?: string;
        structured?: unknown;
    };
    parts: Array<Record<string, unknown>>;
}
/** Deterministic risk×authorization matrix that gates reviewer `allow`
 *  outcomes. For each risk level, lists the authorization levels that permit an
 *  auto-allow. An empty array means no authorization permits auto-allow at that
 *  risk (the action is escalated). Only ever RESTRICTS; deny/escalate are always
 *  preserved. */
interface RiskPolicy {
    allow: {
        low: UserAuthorization[];
        medium: UserAuthorization[];
        high: UserAuthorization[];
        critical: UserAuthorization[];
    };
    minimumConfidence: number;
    onInvalidDecision: "manual" | "deny";
    onReviewerFailure: "manual" | "deny";
}
/** Conservative repository trust model. A repository cannot mark itself trusted
 *  through project configuration alone — trust comes from global config or an
 *  interactive decision stored outside the repo. */
type RepositoryTrust = "trusted" | "untrusted" | "unknown";
/** A declarative policy condition: matches capability/actor facts. Every field
 *  is optional; the rule matches when ALL specified fields match. A missing
 *  `when` (or `{ always: true }`) makes the rule universal. */
interface PolicyCondition {
    /** Explicit catch-all: valid only as the sole key. */
    always?: true;
    actionClass?: CapabilityActionClass[];
    actorProfile?: ActorProfile[];
    writesWorkspace?: boolean;
    writesExternal?: boolean;
    writesTemporary?: boolean;
    deletion?: boolean;
    executesCode?: boolean;
    createsAdHocCode?: boolean;
    packageManagement?: boolean;
    gitMutation?: boolean;
    networkObserved?: boolean;
    credentialRead?: boolean;
    privilegeEscalation?: boolean;
    remoteEnabled?: boolean;
    persistence?: boolean;
    repositoryTrust?: RepositoryTrust[];
}
/** A declarative rule that routes a request based on capability+actor facts.
 *  `when` is optional: omitting it (or `{ always: true }`) matches every
 *  request. An explicitly empty `when: {}` is rejected at load. */
interface PolicyRule {
    id: string;
    source: "builtin" | "global" | "project" | "inline";
    when?: PolicyCondition;
    effect: "review" | "manual" | "deny" | "allow";
    reason: string;
}
/** The result of evaluating the declarative policy. */
interface PolicyTrace {
    /** Stable hash of the effective rule set (not the matched rules) for audit
     *  reproducibility. */
    effectivePolicyHash: string;
    matchedRules: Array<{
        id: string;
        source: string;
        effect: string;
        reason: string;
    }>;
    /** The route the engine computed (counterfactual in observe mode: what enforce
     *  mode WOULD have done with the same facts and rules). */
    finalRoute: "review" | "manual" | "deny" | "allow";
    mode: "observe" | "enforce";
}
type ReviewerOutputFormat = "json_schema" | "text";
interface EscalationReviewerConfig {
    model: string;
    variant: string;
    outputFormat: ReviewerOutputFormat;
    timeoutMs: number;
}
interface ReviewerConfig {
    model: string;
    variant: string;
    /** How the reviewer model returns its decision. `json_schema` requests
     *  OpenCode's structured-output format (requires provider support); `text`
     *  asks the model to emit JSON in plain text and parses it locally. */
    outputFormat: ReviewerOutputFormat;
    /** Optional reasoning reviewer for valid System One decisions that remain
     *  uncertain or conflict with deterministic review gates. */
    escalationReviewer?: EscalationReviewerConfig;
    /** Calibrated outcome-confidence floor for System One decisions. */
    systemOneConfidenceThreshold: number;
    /** Minimum combined non-escalate probability for routing an explicit
     *  System One escalation to the optional reasoning reviewer. */
    systemOneReasoningThreshold: number;
    timeoutMs: number;
    /** Total review budget, including context, queueing, and retries. */
    reviewBudgetMs?: number;
    maxContextChars: number;
    maxPartChars: number;
    maxEnrichmentChars: number;
    maxIntentChars: number;
    transcriptMessages: number;
    intentMessages: number;
    historyMessages: number;
    confidenceThreshold: number;
    retainReviewSessions: boolean;
    audit: boolean;
    auditPath?: string;
    policy?: string;
    debug: boolean;
    /** When "observe", actor evidence is collected and audited but never enforces
     *  new gates; "enforce" applies declarative policy routes. */
    enforcementMode: "observe" | "enforce";
    /**
     * How internal `escalate` results are disposed before UI/reply.
     * - `manual` (default): leave the request for a human (interactive mode).
     * - `deny`: convert every final escalation into a reject with rationale
     *   (non-interactive fail-closed). Never relaxes an explicit deny.
     */
    escalationMode: EscalationMode;
    /** Max hops when walking session parents (default 8). */
    maxSessionDepth: number;
    /** Max parent sessions fetched during lineage traversal. */
    maxParentSessions: number;
    /** Trusted name→profile mappings (empty by default; no mappings shipped). */
    actorProfiles: Record<string, ActorProfile>;
    /** Deterministic risk×authorization gate, configurable but defaults reproduce
     *  the previous hard-coded matrix exactly. */
    riskPolicy: RiskPolicy;
    /** Repository trust level derived from global config (never from project). */
    repositoryTrust: RepositoryTrust;
    /** Declarative policy rules (empty by default; observe mode audits the trace
     *  without enforcing). Project-sourced allow rules are rejected. */
    policyRules: PolicyRule[];
    /** Capture user answers to agent ask dialogs (question tool) and surface
     *  them to the reviewer as scoped authorization evidence. */
    askDecisions: boolean;
    /** Non-empty when a TRUSTED config source (global file, inline options)
     *  existed but could not be fully honored (malformed file, unreadable file,
     *  or rules dropped by validation). Degraded configs block automatic
     *  approval: restrictions may have been lost, so requests escalate instead. */
    configDegraded?: string[];
}
interface ReviewEnvelope {
    request: PermissionRequest;
    directory: string;
    worktree: string;
    transcript: string;
    intentHistory: string;
    enrichment: string;
    verifiedScript?: VerifiedScriptEvidence;
    sshAudit: NonNullable<ReviewAuditRecord["ssh"]>;
    preflightDenial?: string;
    /** Agent-aware context (actor, lineage, intent). Observe-only: flows into the
     *  reviewer prompt and audit as evidence, never into enforcement decisions.
     *  Optional so older callers/tests still compile. */
    actor?: ActorContext;
    lineage?: SessionLineage;
    intent?: IntentContext;
    evidenceCompleteness?: EvidenceCompleteness;
    /** Structured capability facts derived from the bash command. Observe-only:
     *  feeds the reviewer prompt and audit, never enforcement. */
    capability?: CapabilityAssessment;
    /** The policy trace produced for this request, surfaced to the reviewer prompt
     *  as EFFECTIVE_POLICY_SUMMARY and to audit. Observe-only. */
    policyTrace?: PolicyTrace;
    /** Per-phase timing captured during evidence assembly (context/enrichment).
     *  The reviewer and reply phases are timed in the coordinator. */
    timings?: {
        contextMs?: number;
        enrichmentMs?: number;
        reviewerMs?: number;
        replyMs?: number;
    };
    /** False when a material part of the action under review (e.g. an elided
     *  command segment) never reached the rendered evidence. Blocking: the
     *  coordinator must not auto-approve an action the reviewer could not see
     *  in full, whatever confidence the model reports. */
    actionEvidenceComplete?: boolean;
    /** The parsed command reused across evidence providers. */
    parsedCommand?: ParsedCommand;
    /** Operational purpose of the pending action (evidence, never authorization). */
    actionPurpose?: ActionPurpose;
    /** User answers to agent ask dialogs in this session or its ancestors,
     *  captured live from question events. Observe-only: flows into the reviewer
     *  prompt (USER_ASK_DECISIONS) and audit, never into enforcement. */
    askDecisions?: AskDecision[];
}
/** Which layer produced the final decision for a request. Threaded into the
 *  audit record so reports can split outcomes by source. */
type DecisionSource = "emergency-brake" | "deterministic-policy" | "llm-reviewer" | "system-one-reviewer" | "manual-superseded" | "failure-safe";
interface ReviewAuditRecord {
    /**
     * Audit schema version. Present on every record; readers default a missing
     * field to `1` (additive — old records are still valid).
     * Bump only on a breaking change to the record shape.
     */
    schemaVersion?: number;
    reviewID?: string;
    hostRequestID?: string;
    hostGeneration?: "v1" | "v2";
    hostVersion?: string;
    generation?: string;
    nativeAction?: string;
    directory?: string;
    application?: "evaluation-returned" | "reply-accepted" | "human-pending" | "superseded" | "cancelled" | "unknown";
    pluginVersion?: string;
    effectiveConfigHash?: string;
    actionFingerprint?: string;
    /** Version of the structured-decision schema the reviewer was asked to emit. */
    decisionSchemaVersion?: number;
    /** Version of the reviewer system prompt used for this decision. */
    promptVersion?: string;
    /** Which layer produced the outcome (brake, policy, reviewer, supersede,
     *  failure-safe). Absent on legacy v1 records. */
    decisionSource?: DecisionSource;
    timestamp: string;
    durationMs: number;
    requestID: string;
    sessionID: string;
    permission: string;
    /** Stable hash of the canonical request (permission, patterns, metadata,
     *  tool) for cross-record correlation. Absent on legacy v1 records. */
    actionHash?: string;
    outcome: ReviewExecutionResult["kind"];
    reason: string;
    riskLevel?: RiskLevel;
    userAuthorization?: UserAuthorization;
    /** How well the action aligned with the recovered intent (from the reviewer
     *  decision). Absent when no reviewer decision was reached. */
    scopeAlignment?: ScopeAlignment;
    confidence?: number;
    /**
     * Structured outcome emitted by the reviewer LLM before gates/disposition.
     * Absent when no valid structured decision was produced (brake, policy,
     * failure-safe, supersede).
     */
    reviewerOutcome?: ReviewOutcome;
    /**
     * How an internal escalate was disposed. Present only when the logical result
     * was escalate (or a gate converted allow→escalate) and enforcement chose
     * manual or deny. Absent for explicit deny, allow, and manual-superseded.
     */
    escalationDisposition?: EscalationDisposition;
    /** The model that produced the final reviewer decision. */
    reviewerModel?: string;
    /** Present when a System One result was handed to a reasoning reviewer. */
    reviewerEscalatedFrom?: {
        model: string;
        reason: string;
    };
    /** Per-phase timings. Absent on legacy v1 records and on deterministic paths
     *  that never reach that phase. */
    timings?: {
        contextMs?: number;
        enrichmentMs?: number;
        reviewerMs?: number;
        replyMs?: number;
    };
    /** Non-fatal warnings accumulated during evidence collection/analysis. */
    warnings?: string[];
    reviewerSessionID?: string;
    /** Content identity and inspection mode only; never script text or local path. */
    verifiedScript?: {
        sha256: string;
        status: "full" | "reused" | "unavailable";
        bytes?: number;
    };
    /** Root session of the request's ancestry (additive; absent when lineage was
     *  unavailable). */
    rootSessionID?: string;
    /** Overall evidence completeness for the request (additive). */
    evidenceCompleteness?: string;
    /** Resolved actor snapshot for audit (additive). Uses identityCompleteness
     *  (not the decision's numeric confidence) to avoid field ambiguity; v2 also
     *  carries identitySource + confidence. */
    actor?: {
        name?: string;
        mode?: string;
        profile: ActorProfile;
        identityCompleteness: "complete" | "partial" | "unknown";
        /** How the agent identity was established (tool-message, session-api,
         *  unavailable, …). Absent on legacy v1 records. */
        identitySource?: string;
        /** Reliability of the identity claim. Absent on legacy v1 records. */
        confidence?: EvidenceConfidence;
        delegationDepth?: number;
    };
    ssh?: Array<{
        destination: string;
        port?: string;
        remoteCommandSha256?: string;
        stdinSource?: string;
        stdinStatus?: string;
        stdinReason?: string;
    }>;
    /** Additive capability snapshot for audit (observe-only). */
    capability?: {
        actionClass: string;
        summary: string;
        parserCompleteness: string;
        executesCode?: boolean;
        createsAdHocCode?: boolean;
        invokesPackageLifecycleScripts?: boolean;
        writeEffects?: {
            temporaryWrite?: boolean;
            workspaceWrite?: boolean;
            externalWrite?: boolean;
            deletion?: boolean;
        };
        networkObserved?: boolean;
        credentialRead?: boolean;
        privilegeEscalation?: boolean;
        persistence?: boolean;
        remoteEnabled?: boolean;
        gitMutation?: boolean;
    };
    /** Additive policy trace for audit (observe-only). */
    policyTrace?: {
        effectivePolicyHash: string;
        matchedRules: Array<{
            id: string;
            source: string;
            effect: string;
            reason: string;
        }>;
        finalRoute: string;
        mode: string;
    };
    /** Additive snapshot of the ask decisions surfaced to the reviewer prompt
     *  (observe-only; capped to the most recent few). */
    askDecisions?: Array<{
        at: number;
        question: string;
        answer: string;
    }>;
}
interface ApprovedAnnotation {
    requestID: string;
    sessionID: string;
    decision: ReviewDecision;
}
interface ReviewExecutionResult {
    kind: "allow" | "deny" | "escalate";
    decision?: ReviewDecision;
    reason: string;
    reviewSessionID?: string;
    /** Which layer produced this result; threaded into the audit record. */
    decisionSource?: DecisionSource;
    /** Actual model that produced the final reviewer decision. */
    reviewerModel?: string;
    /** Primary model and routing reason when a second reviewer was used. */
    reviewerEscalatedFrom?: {
        model: string;
        reason: string;
    };
    /**
     * Structured outcome from the reviewer LLM before gates/disposition.
     * Absent when no valid structured decision was produced.
     */
    reviewerOutcome?: ReviewOutcome;
    /**
     * How an internal escalate was disposed at the enforcement boundary.
     * Absent when the result was never an escalate (explicit allow/deny) or when
     * the request was already answered manually (`manual-superseded`).
     */
    escalationDisposition?: EscalationDisposition;
}
/** Reliability of a derived fact. */
type EvidenceConfidence = "confirmed" | "high" | "medium" | "low" | "unknown";
/** Every non-trivial derived fact carries provenance so the LLM and audit can
 *  weigh claims by how reliably they were established. */
interface Provenanced<T> {
    value: T;
    source: "permission-event" | "tool-message" | "session-api" | "parent-session" | "global-config" | "project-config" | "effective-permissions" | "static-analysis" | "heuristic" | "unavailable";
    confidence: EvidenceConfidence;
    notes?: string[];
}
/** Generic policy templates, NOT automatic trust levels. */
type ActorProfile = "read-only" | "validation" | "workspace" | "operator" | "reviewer" | "unknown";
/** Normalized effective-permission summary when the SDK exposes it.
 *  The v1 SDK does not expose effective rules, so this stays `undefined`. */
interface EffectivePermissionSummary {
    edit: "allow" | "ask" | "deny" | "mixed" | "unknown";
    bash: "allow" | "ask" | "deny" | "mixed" | "unknown";
    task: "allow" | "ask" | "deny" | "mixed" | "unknown";
    externalDirectory: "allow" | "ask" | "deny" | "mixed" | "unknown";
    source: "session" | "agent-config" | "derived" | "unknown";
}
/** Who is requesting the permission. */
interface ActorContext {
    agentName: Provenanced<string | undefined>;
    mode: Provenanced<string | undefined>;
    profile: Provenanced<ActorProfile>;
    sessionID: string;
    parentSessionID: Provenanced<string | undefined>;
    rootSessionID: Provenanced<string>;
    delegationDepth: Provenanced<number>;
    effectivePermissions?: EffectivePermissionSummary;
    identityCompleteness: "complete" | "partial" | "unknown";
}
/** A node in the session ancestry chain. */
interface SessionNode {
    sessionID: string;
    parentID?: string;
    title?: string;
    version?: string;
    actorName?: string;
    mode?: string;
    createdAt?: number;
}
/** The resolved session ancestry with failure modes made explicit. */
interface SessionLineage {
    origin?: "human-root" | "delegated" | "unknown";
    nodes: SessionNode[];
    rootSessionID: string;
    depth: number;
    cycleDetected: boolean;
    truncated: boolean;
    missingParents: string[];
}
/** A single authorization/intent statement. */
interface IntentBlock {
    sessionID: string;
    messageID: string;
    actor: "user" | "assistant" | "system" | "unknown";
    text: string;
    synthetic: boolean;
    createdAt?: number;
    provenance: Provenanced<"intent">;
}
/** One user decision on an agent-initiated ask dialog (question tool). The
 *  question text is agent-generated and untrusted; only the answer is a user
 *  authorization signal, scoped to the subject and time of the ask. */
interface AskDecision {
    /** Epoch ms when the reply (or dismissal) was observed. */
    at: number;
    /** What the agent asked, already redacted and truncated. */
    question: string;
    /** The option labels the user selected, or a dismissal marker. */
    answer: string;
}
/** Direct user intent kept separate from delegated task. */
interface IntentContext {
    directUserIntent: IntentBlock[];
    delegatedTask: IntentBlock[];
    localSessionIntent: IntentBlock[];
    conflictingInstructions: string[];
    latestExplicitAuthorization?: IntentBlock;
    completeness: "complete" | "partial" | "insufficient";
}
/** Meta-summary of what evidence was available. */
interface EvidenceCompleteness {
    permission: boolean;
    actor: boolean;
    lineage: boolean;
    directUserIntent: boolean;
    delegatedTask: boolean;
    /** Whether a non-unavailable ACTION_PURPOSE was recovered. */
    purpose: boolean;
    capability: boolean;
    repositoryState: boolean;
    referencedCode: boolean;
    reasons: string[];
    overall: "sufficient" | "partial" | "insufficient";
}
/**
 * Operational purpose of the pending action — what the agent appears to be
 * trying to accomplish. This is untrusted evidence: it never demonstrates
 * user authorization by itself.
 */
interface ActionPurpose {
    text?: string;
    source: "agent-context" | "intent-derived" | "unavailable";
    confidence: EvidenceConfidence;
}
/** How completely the command could be statically analyzed. */
type ParserCompleteness = 
/** Fully parsed: no variables, globs, substitutions, or heredoc bodies. */
"complete-for-supported-form"
/** Some constructs could not be resolved (variables, partial heredoc). */
 | "partial"
/** Heavy dynamic constructs (command substitution, eval, dynamic heredoc). */
 | "opaque";
/** A redirection extracted from a parsed command segment. */
interface Redirection {
    /** `>` `>>` `<` `2>` `&>` etc. */
    operator: string;
    /** Target path (file descriptor targets normalized to a path when possible). */
    target: string;
    /** Whether the target was quoted in the source (affects literal-ness). */
    quoted: boolean;
}
/** A heredoc extracted before lexing so its body never reaches the lexer/brake. */
interface HeredocRecord {
    /** The literal delimiter token as it appeared (`EOF`, `END`, …). */
    delimiter: string;
    /** `<<` (expansion on) or `<<-` (tabs stripped) — normalized form. */
    operator: string;
    /** Whether the delimiter was quoted, disabling expansion (`<<'EOF'`). */
    expansionDisabled: boolean;
    /** Bounded + redacted body (truncated to a safe length). */
    bodyBounded: string;
    /** SHA-256 of the full, unredacted body (stable identity without leaking it). */
    bodySha256: string;
    /** Whether the body was truncated for storage. */
    truncated: boolean;
    /** Output path associated with the heredoc when a `> path` precedes it. */
    outputTarget?: string;
    /** Whether the body is dynamically constructed (unresolvable expansion). */
    dynamic: boolean;
}
/** A command parsed into a reusable structure. Wraps the existing lexer output
 *  plus pre-extracted redirections and heredocs. */
interface ParsedCommand {
    /** The command after heredoc bodies were replaced with placeholders. */
    sanitizedCommand: string;
    /** Lexed segments of the sanitized command. */
    segments: ShellSegment[];
    /** Effective commands (wrappers peeled) per segment. */
    effective: ShellToken[][];
    /** Redirections grouped by segment index. */
    redirections: Redirection[][];
    /** Heredocs extracted before lexing. */
    heredocs: HeredocRecord[];
    /** Whether the original command contained any dynamic constructs. */
    hasDynamicConstructs: boolean;
    /** True when the lexer's depth or expansion budget stopped command-string
     *  resolution early; `effective` is then a prefix of the real structure and
     *  deterministic facts do not cover the whole command. */
    analysisTruncated: boolean;
}
/** High-level classification of what the action does. */
type CapabilityActionClass = "read-only" | "workspace-write" | "temporary-write" | "external-write" | "destruction" | "code-execution" | "package-management" | "git-mutation" | "network" | "remote-operation" | "service-management" | "persistence" | "privilege-escalation" | "unknown";
/** What the action can do, what it appears to do, and analysis confidence. */
interface CapabilityAssessment {
    /** Best single-label summary of the dominant capability. */
    actionClass: Provenanced<CapabilityActionClass>;
    /** Human-readable summary of the detected surface. */
    summary: string;
    /** Executes an interpreter or runtime (sh, python, node, bun, …). */
    executesCode: Provenanced<boolean | "unknown">;
    /** Executes code that lives in the repository (scripts, test files). */
    executesRepositoryCode: Provenanced<boolean | "unknown">;
    /** Executes ad-hoc code generated by the agent (heredoc/inline). */
    createsAdHocCode: Provenanced<boolean | "unknown">;
    /** Invokes a known test runner (pytest, jest, bun test, …). */
    invokesExistingTestRunner: Provenanced<boolean | "unknown">;
    /** Runs a package manager that may execute lifecycle scripts. */
    invokesPackageLifecycleScripts: Provenanced<boolean | "unknown">;
    /** Reads literal credential material through a known file reader. */
    credentialRead: Provenanced<boolean | "unknown">;
    /** Detected file-write surface. */
    writeEffects: {
        temporaryWrite: Provenanced<boolean | "unknown">;
        workspaceWrite: Provenanced<boolean | "unknown">;
        externalWrite: Provenanced<boolean | "unknown">;
        deletion: Provenanced<boolean | "unknown">;
    };
    /** Detected network surface. */
    network: {
        observed: Provenanced<boolean | "unknown">;
        possible: Provenanced<boolean | "unknown">;
        /** Hosts/destinations observed literally in the command. */
        destinations: string[];
        observedAccess: Provenanced<boolean | "unknown">;
        possibleAccess: Provenanced<boolean | "unknown">;
    };
    /** Detected process side-effects. */
    process: {
        childProcesses: Provenanced<boolean | "unknown">;
        persistence: Provenanced<boolean | "unknown">;
        privilegeEscalation: Provenanced<boolean | "unknown">;
    };
    /** Detected remote-operation surface (ssh, etc.). */
    remote: {
        enabled: Provenanced<boolean | "unknown">;
        mutationHint: Provenanced<boolean | "unknown">;
    };
    /** Detected git mutation surface. */
    git: {
        observed: Provenanced<boolean | "unknown">;
        possible: Provenanced<boolean | "unknown">;
        observedAccess: Provenanced<boolean | "unknown">;
        possibleAccess: Provenanced<boolean | "unknown">;
    };
    /** How completely the command could be analyzed. */
    parserCompleteness: ParserCompleteness;
    /** Free-form warnings about analysis limitations. */
    analysisWarnings: string[];
}

/** The host passing an options object does not attest who authored it. */
type InlineOptionsTrust = "trusted" | "project" | "unknown";

/** Load and merge config from global, project, and inline sources.
 *
 * Precedence (lowest to highest): builtin defaults → global → project → inline,
 * with one deliberate exception: security-sensitive fields cross a trust
 * boundary where the untrusted project layer can only TIGHTEN the trusted
 * baseline (see mergeWithTrustBoundary), and that hardening survives even
 * when inline set the same field.
 *
 * When no global or project files exist (the common case), the result is
 * byte-identical to calling `resolveConfig(inlineOptions)` directly. */
declare function loadResolvedConfig(inlineOptions: Record<string, unknown> | undefined, directory?: string, inlineTrust?: InlineOptionsTrust): ReviewerConfig;

type Context = Parameters<Plugin.Plugin["setup"]>[0];
declare function setup(ctx: Context): Promise<() => Promise<void>>;

/** What the plugin learned about the host client at startup. */
interface OpenCodeCapabilities {
    /** A public SDK method to answer a permission request exists. */
    publicPermissionReply: boolean;
    /** That public method can carry a free-text feedback `message`. */
    permissionReplyMessage: boolean;
    /** The authenticated raw `_client.post` transport is reachable. */
    rawAuthenticatedTransport: boolean;
    /** `client.session.get` is available (lineage walking depends on it). */
    sessionGet: boolean;
    /** Session records expose a `parentID` (lineage traversal). */
    sessionParentID: boolean;
    /** Assistant messages carry an `agent` field (actor identity). */
    assistantAgentMetadata: boolean;
    /** Assistant messages carry a `mode` field (actor identity). */
    assistantModeMetadata: boolean;
    /** Effective permission rules can be resolved per session. */
    effectivePermissions: boolean;
    /** `client.tui.publish` is available for status broadcasting. */
    tuiPublish: boolean;
}

type ReviewUiPhase = "reviewing" | "approved" | "denied" | "manual" | "unknown";
interface ReviewUiStatus {
    version: 1;
    requestID: string;
    sessionID: string;
    phase: ReviewUiPhase;
    permission: string;
    action: string;
    model: string;
    variant: string;
    emittedAt: number;
    timeoutMs: number;
    reason?: string;
    decision?: ReviewDecision;
    /**
     * When phase is `denied` and this is `"deny"`, the block came from fail-closed
     * escalation disposition rather than an explicit reviewer/policy deny.
     */
    escalationDisposition?: EscalationDisposition;
    /** Resolved actor (absent on the initial "reviewing" phase, before context
     *  collection completes). */
    actorName?: string;
    actorProfile?: ActorProfile;
}
declare function permissionAction(request: PermissionRequest): string;
declare function createUiStatus(request: PermissionRequest, phase: ReviewUiPhase, options: {
    model: string;
    variant: string;
    timeoutMs: number;
    reason?: string;
    decision?: ReviewDecision;
    escalationDisposition?: EscalationDisposition;
    emittedAt?: number;
    actorName?: string;
    actorProfile?: ActorProfile;
}): ReviewUiStatus;
declare function encodeUiStatus(status: ReviewUiStatus): string;
declare function decodeUiStatus(command: string): ReviewUiStatus | undefined;

interface ClientResponse<T> {
    data?: T;
    error?: unknown;
}
interface OpenCodeClientLike {
    session: {
        create(options: unknown): Promise<ClientResponse<Record<string, unknown>>>;
        messages(options: unknown): Promise<ClientResponse<unknown>>;
        prompt(options: unknown): Promise<ClientResponse<Record<string, unknown>>>;
        delete?(options: unknown): Promise<ClientResponse<unknown>>;
        abort?(options: unknown): Promise<ClientResponse<unknown>>;
        /** Fetch session metadata (parentID, title, …). Optional: the actor resolver
         *  degrades to "lineage unavailable" when the host client does not expose it. */
        get?(options: unknown): Promise<ClientResponse<unknown>>;
    };
    tool: {
        ids(options?: unknown): Promise<ClientResponse<string[]>>;
    };
    /** Host MCP inventory, keyed by server name. The V1 host exposes
     *  `mcp.status({ query: { directory } })` and returns `{}` for a location
     *  whose config excludes MCP. Optional so narrow clients still typecheck;
     *  the reviewer guard fails closed when it is absent. */
    mcp?: {
        status(options?: unknown): Promise<ClientResponse<Record<string, unknown>>>;
    };
}
interface RuntimeContext {
    hostVersion?: string;
    client: OpenCodeClientLike;
    /** What the plugin learned about the host client at startup (probe result).
     *  Surfaced to diagnostics and available to any future adapter consumer. */
    capabilities: OpenCodeCapabilities;
    permissionReply(options: unknown): Promise<ClientResponse<unknown>>;
    publishUiStatus?(status: ReviewUiStatus): Promise<ClientResponse<unknown>>;
    writeAudit?(record: ReviewAuditRecord): Promise<void>;
    directory: string;
    worktree: string;
    /** Where reviewer sessions run when isolation is available: a directory
     *  without project instructions or project config. Production resolves the
     *  shared data directory; tests inject a scratch path so they never touch
     *  the developer's HOME. */
    reviewerDirectoryBase?: string;
}

interface SshAuditSummary {
    destination: string;
    port?: string;
    remoteCommandSha256?: string;
    stdinSource?: string;
    stdinStatus?: string;
    stdinReason?: string;
}
interface SshEnrichmentResult {
    text: string;
    audit: SshAuditSummary[];
    preflightDenial?: string;
}
declare function enrichSshEvidence(request: PermissionRequest, directory: string, worktree: string, maxChars: number): Promise<SshEnrichmentResult>;

/**
 * A single piece of evidence gathered about a permission request. The runtime
 * only consumes `text`, `audit`, and `preflightDenial` today; the remaining
 * fields give future providers room to surface warnings and cost without
 * changing the interface.
 */
interface EvidenceFragment {
    kind: "ssh" | "local_script" | "git";
    text: string;
    audit?: SshAuditSummary[];
    preflightDenial?: string;
    warnings?: string[];
    durationMs?: number;
}
interface EvidenceProviderInput {
    request: PermissionRequest;
    directory: string;
    worktree: string;
    maxChars: number;
}
/**
 * Enriches a permission request with one category of evidence (SSH analysis,
 * local script inspection, Git state, …). Providers run concurrently and their
 * fragments are assembled into a single review envelope.
 */
interface EvidenceProvider {
    readonly id: string;
    collect(input: EvidenceProviderInput): Promise<EvidenceFragment>;
}

/**
 * Captures user answers to agent ask dialogs (the `question` tool) from the
 * OpenCode event stream and exposes them as compact, session-scoped
 * authorization evidence for the reviewer prompt.
 *
 * The host runs questions through a dedicated service (`question.asked` /
 * `question.replied` / `question.rejected` events) that never touches the
 * permission pipeline, so these decisions are invisible to a permission-only
 * observer. This registry is the counterpart capture layer: it is
 * enrichment-only — question events never trigger, supersede, or enforce
 * anything — and it is total (malformed events are dropped, never thrown).
 *
 * Robustness rules:
 * - One logical ask = one record, keyed by the per-ask request ID. The v1 and
 *   v2 event spellings of the same ask upsert into the same entry, and a
 *   replayed reply or rejection is ignored.
 * - A reply or rejection without a matching pending ask is dropped (the
 *   question text is unknowable after the fact).
 * - Pending asks expire (TTL) so a very late reply cannot pair with a stale
 *   question from another context.
 * - Resolved decisions are FIFO-bounded globally; the per-review limit is
 *   applied at query time, not storage time.
 * - Question and answer text is redacted before storage; a credential pasted
 *   as a custom answer must never land in the registry, prompt, or audit.
 */
/** Marker recorded when the user dismisses an ask without answering. */
declare const DISMISSED_ANSWER = "Dismissed by user";
type Logger$1 = (message: string, details?: unknown) => void;
/** What the evidence assembler consumes: a bounded, lineage-scoped query. */
interface AskDecisionSource {
    recentFor(sessionIDs: string[], limit?: number): AskDecision[];
}
declare class AskDecisionRegistry implements AskDecisionSource {
    private readonly pending;
    private readonly resolved;
    private readonly log;
    private readonly now;
    constructor(logger?: Logger$1, now?: () => number);
    /**
     * Observe one raw event. Total: never throws; anything malformed or
     * unrelated is dropped silently. Must be called synchronously from the event
     * hook so registry mutations are visible to reviews started later.
     */
    observe(event: unknown): void;
    /**
     * Decisions visible to a review running in `sessionIDs` (the requesting
     * session plus its resolved ancestors), oldest first, bounded to the most
     * recent `limit`. Sibling and unrelated sessions are never visible.
     */
    recentFor(sessionIDs: string[], limit?: number): AskDecision[];
    /** Observed-but-unresolved asks (diagnostics only). */
    pendingCount(): number;
    /** Resolved decisions retained (diagnostics only). */
    resolvedCount(): number;
    private takePending;
    private store;
    /** Enforce the pending cap and TTL. Map iteration order is insertion
     *  order, so `keys().next()` is the oldest entry. */
    private prunePending;
    private pruneExpired;
}

type Logger = (message: string, details?: unknown) => void;
/**
 * Owns the review lifecycle for permission requests: orchestration, the
 * supersede state machine, and the model call. The adapter (transport) and the
 * evidence providers are injected so this class stays focused on ordering and
 * races.
 */
declare class ReviewCoordinator {
    private readonly ctx;
    private readonly config;
    private readonly generation;
    private readonly attempts;
    private stopped;
    private readonly limiter;
    private readonly pending;
    private readonly backend;
    /**
     * Request IDs that a human (or any other reply source) resolved while the
     * automatic review was still in flight. The in-flight review must then give
     * up silently: no `emit`, no `reply`. OpenCode resolves a request on a
     * first-writer basis, so a late programmatic reply returns 404
     * PermissionNotFoundError — we treat that the same way.
     */
    private readonly resolvedManually;
    private readonly log;
    private readonly providers;
    private readonly scriptRegistry;
    /** Live ask-decision capture (enrichment-only; undefined when disabled). */
    private readonly askDecisions;
    /** Bound for metadata SDK calls (session create, tool listing, replies,
     *  status publishing): a hung call must never leave a review pending
     *  forever; the reviewer prompt keeps its own full timeout budget. */
    private readonly metadataCallTimeoutMs;
    constructor(ctx: RuntimeContext, config: ReviewerConfig, logger?: Logger, providers?: EvidenceProvider[], askDecisions?: AskDecisionSource);
    pendingCount(): number;
    waitForIdle(): Promise<void>;
    dispose(): Promise<void>;
    handle(request: PermissionRequest): void;
    process(request: PermissionRequest): Promise<ReviewExecutionResult>;
    private supersedeResult;
    private isSuperseded;
    /**
     * Reject a request with `reject` while honoring supersede. Returns `undefined`
     * when the rejection was applied, or the supersede result when the request had
     * already been answered manually (so the caller returns it unchanged).
     */
    private denyAndReply;
    /**
     * Apply a fully disposed result (allow / deny / escalate) to UI + reply.
     * This is the single side-effect boundary after logical disposition.
     */
    private applyDisposition;
    private processRequest;
    handlePermissionReply(event: unknown): void;
    /**
     * @deprecated No-op. Approvals no longer annotate tool results so they do not
     * contaminate the primary agent context. Kept for public API compatibility;
     * the plugin no longer registers a host hook that calls this. Rationale
     * remains in audit, TUI, and debug.
     */
    annotateToolResult(callID: string, output: {
        output?: unknown;
        metadata?: unknown;
    }): void;
    private collectEnvelope;
    private audit;
    private runReviewer;
    private remember;
    /** Fold the reviewer phase's elapsed time into the request's timing record. */
    private recordReviewerMs;
    /**
     * Send a permission reply. Returns `true` on success, `false` when the
     * request was already resolved by another source (human TUI, a duplicate
     * event, etc.) so the caller can treat itself as superseded. Other errors
     * (transport failure, malformed reply) are still thrown.
     */
    private safeReply;
    private emit;
}

/**
 * Normalize a raw OpenCode event into a {@link PermissionRequest}.
 *
 * Returns `undefined` for anything that is not a well-formed
 * `permission.asked` event, so callers can ignore irrelevant events without
 * inspecting their shape.
 */
declare function extractPermissionRequest(event: unknown): PermissionRequest | undefined;

declare function resolveConfig(options: Record<string, unknown> | undefined): ReviewerConfig;

declare function parseDecision(value: unknown): ReviewDecision | undefined;
declare function enforceDecision(decision: ReviewDecision, config: ReviewerConfig): ReviewExecutionResult;
declare const DECISION_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["version", "outcome", "risk_level", "user_authorization", "scope_alignment", "evidence_completeness", "rationale", "confidence"];
    readonly properties: {
        readonly version: {
            readonly type: "number";
            readonly enum: readonly [2];
            readonly description: "Structured-decision schema version. Must be exactly 2.";
        };
        readonly outcome: {
            readonly type: "string";
            readonly enum: readonly ["allow", "deny", "escalate"];
            readonly description: "allow executes once, deny rejects, escalate leaves the request for a human";
        };
        readonly risk_level: {
            readonly type: "string";
            readonly enum: readonly ["low", "medium", "high", "critical"];
        };
        readonly user_authorization: {
            readonly type: "string";
            readonly enum: readonly ["high", "medium", "low", "unknown"];
        };
        readonly rationale: {
            readonly type: "string";
            readonly minLength: 3;
            readonly maxLength: 2000;
            readonly description: "One concise sentence explaining the main reason for the decision";
        };
        readonly confidence: {
            readonly type: "number";
            readonly minimum: 0;
            readonly maximum: 1;
        };
        readonly scope_alignment: {
            readonly type: "string";
            readonly enum: readonly ["aligned", "partial", "misaligned", "unknown"];
            readonly description: "How well the request aligns with the recovered user or delegated intent: aligned (within scope), partial (tangential), misaligned (outside scope), unknown (insufficient context).";
        };
        readonly evidence_completeness: {
            readonly type: "string";
            readonly enum: readonly ["sufficient", "partial", "insufficient", "unknown"];
            readonly description: "Whether the evidence was sufficient to decide: sufficient, partial (some gaps), insufficient (major gaps), unknown.";
        };
        readonly script_analysis: {
            readonly type: "string";
            readonly minLength: 20;
            readonly maxLength: 1500;
            readonly description: "Optional factual analysis of a fully supplied verified script. Describe effects and uncertainty, never user authorization or an approval.";
        };
    };
};

/**
 * Categories that can be hardened independently of the global escalation mode
 * via `riskPolicy.onInvalidDecision` / `riskPolicy.onReviewerFailure`.
 * `general` covers every other escalate path (LLM escalate, gates, policy
 * manual, context failures, …).
 */
type EscalationCategory = "general" | "invalid-decision" | "reviewer-failure";
/**
 * Resolve the effective disposition for an internal escalate.
 *
 * Precedence is monotonic (restrictive wins):
 * 1. `escalationMode: "deny"` hardens every escalate globally.
 * 2. Category knobs can harden only their own case when mode is `manual`.
 * 3. Nothing can relax a more restrictive setting.
 *
 * `manual-superseded` is never converted: the request is already closed.
 */
declare function resolveEscalationDisposition(result: ReviewExecutionResult, config: ReviewerConfig, category?: EscalationCategory): EscalationDisposition;
/**
 * Single enforcement boundary: convert an internal escalate into the effective
 * disposition used for UI, reply, and audit. Allow/deny and manual-superseded
 * pass through unchanged.
 *
 * When converting escalate → deny, the original reason is preserved so the
 * primary agent still receives actionable feedback. The original structured
 * decision (if any) is kept as-is — never rewritten into a synthetic deny —
 * so audit can distinguish a real LLM escalate from a fail-safe without a
 * structured decision. `reviewerOutcome` is only set when a structured
 * decision actually existed.
 */
declare function applyEscalationDisposition(result: ReviewExecutionResult, config: ReviewerConfig, category?: EscalationCategory): ReviewExecutionResult;

declare function emergencyBrakeReason(request: PermissionRequest): string | undefined;

declare function redactSecrets(input: string): string;

interface UiStateOptions {
    model: string;
    variant: string;
    timeoutMs: number;
}
declare class ReviewUiState {
    private readonly options;
    private readonly requests;
    private readonly acknowledged;
    constructor(options: UiStateOptions);
    asked(request: PermissionRequest, now?: number): ReviewUiStatus;
    apply(status: ReviewUiStatus): boolean;
    replied(requestID: string): void;
    remove(requestID: string): void;
    get(requestID: string): ReviewUiStatus | undefined;
    all(): ReviewUiStatus[];
    activeFor(sessionID: string, parentOf: (sessionID: string) => string | undefined): ReviewUiStatus | undefined;
    expire(now?: number): ReviewUiStatus[];
    dismissResults(now?: number): string[];
}

declare const DEFAULT_AUDIT_PATH = "~/.local/share/opencode/permission-reviewer-audit.jsonl";
declare function createAuditWriter(config: ReviewerConfig, logger?: (message: string, details?: unknown) => void): ((record: ReviewAuditRecord) => Promise<void>) | undefined;

interface LocalScriptEnrichmentResult {
    text: string;
}
declare function enrichLocalScriptEvidence(request: PermissionRequest, directory: string, worktree: string, maxChars: number): Promise<LocalScriptEnrichmentResult>;

interface GitEnrichmentResult {
    text: string;
}
declare function enrichGitEvidence(request: PermissionRequest, directory: string, maxChars: number, worktree?: string): Promise<GitEnrichmentResult>;

declare const server: Plugin$1;
declare const module$1: {
    id: string;
    server: Plugin$1;
    setup: typeof setup;
};

export { type ActionPurpose, type ActorContext, type ActorProfile, ReviewCoordinator as ApprovalReviewerRuntime, type ApprovedAnnotation, type AskDecision, AskDecisionRegistry, type CapabilityActionClass, type CapabilityAssessment, DECISION_SCHEMA, DEFAULT_AUDIT_PATH, DISMISSED_ANSWER, type DecisionSource, type EffectivePermissionSummary, type EscalationDisposition, type EscalationMode, type EscalationReviewerConfig, type EvidenceCompleteness, type EvidenceConfidence, type EvidenceSufficiency, type HeredocRecord, type IntentBlock, type IntentContext, type MessageWithParts, type ParsedCommand, type ParserCompleteness, type PermissionRequest, type PermissionToolSource, type PolicyCondition, type PolicyRule, type PolicyTrace, type Provenanced, type Redirection, type RepositoryTrust, type ReviewAuditRecord, type ReviewDecision, type ReviewEnvelope, type ReviewExecutionResult, type ReviewOutcome, ReviewUiState, type ReviewerConfig, type ReviewerOutputFormat, type RiskLevel, type RiskPolicy, type ScopeAlignment, type SessionLineage, type SessionNode, type UserAuthorization, applyEscalationDisposition, createAuditWriter, createUiStatus, decodeUiStatus, module$1 as default, emergencyBrakeReason, encodeUiStatus, enforceDecision, enrichGitEvidence, enrichLocalScriptEvidence, enrichSshEvidence, extractPermissionRequest, loadResolvedConfig, parseDecision, permissionAction, redactSecrets, resolveConfig, resolveEscalationDisposition, server };
