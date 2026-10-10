/** Fields managed by the trust boundary. For these, the boundary's output is
 *  final: the project layer may only tighten them against the trusted
 *  baseline (which already includes inline), and a later inline value must not
 *  undo that tightening. For every other field the documented precedence
 *  applies and inline (trusted, most specific) wins over the project. The
 *  reviewer resource knobs (timeouts, context budgets) are the strictest
 *  case: the project cannot set them at all, in either direction. */
export const TRUST_BOUNDARY_KEYS: ReadonlySet<string> = new Set([
  "confidenceThreshold",
  "systemOneConfidenceThreshold",
  "systemOneReasoningThreshold",
  "audit",
  "auditPath",
  "model",
  "escalationReviewer",
  "policy",
  "repositoryTrust",
  "actorProfiles",
  "enforcementMode",
  "riskPolicy",
  "escalationMode",
  "policyRules",
  "variant",
  "outputFormat",
  "retainReviewSessions",
  "timeoutMs",
  "reviewBudgetMs",
  "maxContextChars",
  "maxPartChars",
  "maxEnrichmentChars",
  "maxIntentChars",
  "transcriptMessages",
  "intentMessages",
  "historyMessages",
  "maxSessionDepth",
  "maxParentSessions",
  "askDecisions",
  "debug",
]);

/** Keys the project layer can never set, in either direction.
 *
 *  - configDegraded describes the state of TRUSTED sources; the project layer
 *    has no say in it (injecting fake degradation would only tighten, but the
 *    field must stay authoritative for the loader that computes it).
 *  - Reviewer resource knobs (timeouts and context budgets): how long a review
 *    may run and how much context (transcript, evidence, session chains) it may
 *    consume. They are not monotonic security fields: raising them means more
 *    conversation sent to the provider, more cost, and longer processing, so a
 *    repository may not move them in either direction. Wrong-typed values are
 *    dropped with them.
 *  - askDecisions: prior user answers are scoped-authorization evidence for the
 *    reviewer. Only trusted layers may decide whether the reviewer sees them; a
 *    repository can neither strip them nor inject them.
 *  - auditPath: only trusted global/inline config may choose the audit
 *    destination. A repository must never be able to redirect or silence the
 *    audit trail by pointing it at /dev/null or a path it controls.
 *  - model and policy: the reviewer destination and the tenant policy text are
 *    trusted decisions. A repository must not choose where code/context is sent
 *    for review, nor rewrite the policy the reviewer enforces. The reasoning
 *    variant, the decision output format, and review-session retention are the
 *    same class of decision: a weaker variant, a looser output format, or
 *    silenced retention must not be selectable from a repository.
 *  - actorProfiles: name→profile mappings are a trust delegation (which agent
 *    gets which capability profile). Only trusted global/inline config may
 *    grant them; otherwise a repository could promote its own agent to a
 *    higher-privilege profile ("build" → "operator"). trustedProjects opt-in is
 *    a future item; until then the project layer cannot define mappings. */
export const TRUSTED_ONLY_KEYS = [
  "configDegraded",
  "timeoutMs",
  "reviewBudgetMs",
  "maxContextChars",
  "maxPartChars",
  "maxEnrichmentChars",
  "maxIntentChars",
  "transcriptMessages",
  "intentMessages",
  "historyMessages",
  "maxSessionDepth",
  "maxParentSessions",
  "askDecisions",
  "auditPath",
  "model",
  "escalationReviewer",
  "policy",
  "variant",
  "outputFormat",
  "retainReviewSessions",
  "debug",
  "actorProfiles",
] as const;

/** Numeric floors: project config can raise but not lower them. Confidence
 *  floors guard the decision gate and are monotonic hardening: a stricter
 *  threshold is always safer, so the project may add one. */
export const CONFIDENCE_FLOOR_KEYS = [
  "confidenceThreshold",
  "systemOneConfidenceThreshold",
  "systemOneReasoningThreshold",
] as const;
