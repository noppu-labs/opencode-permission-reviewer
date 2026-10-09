# Safety

This page covers the threat model the plugin assumes and the safety properties it enforces.
[How it works](HOW-IT-WORKS.md) walks through the review pipeline that implements them.

## Threat model

The plugin is a defense-in-depth aid and does not provide a complete sandbox. It reviews
`ask`-classified actions with a second model call and fails safe to manual review, or to denial
with `escalationMode: "deny"`, when anything is uncertain. It does not replace OpenCode's own
permission system, your model provider's safety layers, or good OS-level hygiene.

A determinedly adversarial agent may still attempt to mislead the reviewer. The deterministic
emergency brake and the untrusted-evidence prompt mitigate that risk but cannot fully eliminate it.

The deterministic gates check a decision's consistency, not its semantic correctness. A reviewer
model that misclassifies an unsafe action as low risk can produce an unsafe `allow` in either
output format, so pick as strong a reviewer model as your budget allows.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Safety properties

### Scope

- The plugin reviews only `ask` requests. V1 handles `permission.asked`, and V2 handles
  `permission.evaluate` without replacing an existing host decision.

### Decisions

- A decision the model labels critical is never auto-approved, whatever its outcome says. This
  does not guarantee that the model classifies every dangerous action correctly.
- With the default `riskPolicy` matrix, high-risk actions with low or unknown authorization and
  medium-risk actions with unknown authorization are deterministically escalated. The model
  cannot get them auto-approved by labeling a contradictory combination. Only trusted global
  configuration can widen that matrix.
- An `allow` the reviewer judged misaligned with the user's intent escalates, and so does an
  `allow` at medium or high risk with insufficient evidence.
- Invalid, low-confidence, or inconsistent output never becomes an approval, and neither do
  reviewer errors or timeouts.
- A degraded trusted config (see [Degraded config](CONFIGURATION.md#degraded-config)), or evidence
  where a material part of the action itself was elided or truncated, blocks automatic approval
  regardless of confidence.
- Final escalations reach the user or are denied according to `escalationMode`; some V2 host
  failures deny directly.
- A narrow deterministic emergency brake rejects unmistakable root destruction and direct
  credential-file export before any model call. See
  [Emergency brake](HOW-IT-WORKS.md#2-emergency-brake) for the forms it recognizes and its limits.
- A manual reply that arrives while a review is in flight supersedes it. The reviewer stops without
  replying or resurrecting a UI state.

### Reviewer isolation

- Reviewer sessions cannot request permissions recursively. A wildcard session permission rule
  denies every tool except the reviewer's own structured-output result tool in `json_schema` mode.
  The rule also covers MCP tools and takes precedence over agent-config allows.
- The reviewer session runs outside the project directory, so repository instructions (`AGENTS.md`
  and project-config `instructions`) are not part of its system prompt. If the isolated directory
  cannot be established, the review cannot auto-approve; it does not run with degraded isolation.

### Evidence and intent

- Known common credential formats are redacted from reviewer evidence. Redaction is defense in
  depth and does not guarantee that every possible secret is detected.
- SSH commands and executable stdin receive bounded, untrusted action enrichment. Enrichment never
  makes an approval decision on its own. [Evidence enrichment](HOW-IT-WORKS.md#evidence-enrichment)
  describes what is collected.
- Synthetic compaction and control messages are excluded from authorization evidence.

Long-session user intent is recovered separately from recent operational context, and later
explicit requests supersede conflicting older ones:

- V2 reads literal user messages from the persisted message API, including history before
  compaction.
- V1 scans bounded recent-history windows of up to 2,000 messages.
- Both keep the configured intent count and character budget.

Intent appears once in the reviewer prompt. Operational reasoning and duplicate tool evidence are
omitted, while attachments and distinct results remain visible. Long literal intent keeps its
beginning and end, with an explicit omission marker.

### Feedback, audit, and UI

- Approvals are silent to the primary agent; denials return the rationale as feedback. See
  [Reply](HOW-IT-WORKS.md#6-reply).
- Audit failures never affect or relax the safety decision.
- UI status messages are versioned, request-scoped, and bounded, and they travel through
  OpenCode's own workspace TUI event channel.
