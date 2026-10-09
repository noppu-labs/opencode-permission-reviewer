# Configuration

This page covers how to register the plugin on OpenCode V1 and V2, every reviewer option, how
config layers combine across the trust boundary, and the audit log. For choosing and configuring
the reviewer model itself, see [Reviewer models](REVIEWER-MODELS.md).

## Shared reviewer settings

Put reviewer settings in the trusted global file `~/.config/opencode/permission-reviewer.jsonc`.
On V1, both the server plugin and the TUI overlay read this file, so you set shared options once
instead of repeating them in two plugin entries. On V2, the server reads the file and the TUI
receives effective settings and review status from the server.

## OpenCode V1

Register the plugin in your `opencode.json`, either the project file or
`~/.config/opencode/opencode.json`. Use an absolute path to a checkout, or the npm package name
after `bun add` or `npm install`:

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-permission-reviewer"],
  // or: "plugin": ["@noppu-labs/opencode-permission-reviewer"],
  "permission": {
    "bash": "ask", // at least one ask rule, or the plugin is a no-op
  },
}
```

For the optional TUI overlay, register the plugin in `~/.config/opencode/tui.json`:

```jsonc
// tui.json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-permission-reviewer"],
}
```

Restart OpenCode fully after you install or rebuild the plugin. The host imports the plugin once
at startup, and a live session keeps the previous code in memory, so it will not show a rebuilt
overlay. The [README](../README.md#configure) has a quick smoke test.

## OpenCode V2

V2 uses `plugins` with object entries. The same package supplies `setup()` for the server and a
separate TUI adapter. Pass `--host v2` to the installer to select this format:

```bash
bunx @noppu-labs/opencode-permission-reviewer init --host v2 --npm --tui --yes
```

```jsonc
// opencode.json
{
  "plugins": [{ "package": "@noppu-labs/opencode-permission-reviewer", "options": {} }],
  "permissions": [{ "action": "shell", "resource": "*", "effect": "ask" }],
}
```

The optional interface belongs in the global `cli.json`, not a project `tui.json`. The installer
writes it to the correct destination.

Reviewer settings belong in the trusted global `permission-reviewer.jsonc`. V2 inline options are
of unknown provenance and can only tighten security restrictions.

### Reviewer sessions and host connection

For normal models, V2 uses the official authenticated client to manage isolated reviewer
sessions. It reuses one reviewer location per backend and removes every MCP server there,
including servers that other plugins add from code. Before each review it checks that the
location has no MCP servers. Jev uses its direct typed API instead (see
[Jev System One reviewer](REVIEWER-MODELS.md#jev-system-one-reviewer)).

The plugin discovers the registered service without starting or stopping it. For an independent
`serve`, set `OPENCODE_PERMISSION_REVIEWER_HOST_URL` and the host's `OPENCODE_PASSWORD` in the
trusted process environment. An identity check rejects connections to a different plugin
instance. Provider credentials stay inside OpenCode. See [Migration and rollback](../MIGRATION.md)
for the full connection requirements.

### Structured output, retention, and budget

Structured output uses a dedicated schema-validated result tool. All operational tools stay
disabled.

`retainReviewSessions: false` removes the auxiliary session after the review, and `true` keeps it
for inspection on either host generation. Leave it `false` in normal use.

`reviewBudgetMs` bounds the whole review. Its default is `2 * timeoutMs + 60000`, and retries
consume this budget.

## Cost

Every `ask` action makes one reviewer call, which can take up to `timeoutMs`. Normal models use an
extra child session, and Jev uses a direct typed request. Your model spend scales with how much
your policy `ask`s. To reduce it, lower the reasoning `variant` where the model supports it, or
raise `confidenceThreshold`.

## All configuration options

Every option is optional. Numeric options are clamped to the bounds below, and an invalid value
falls back to the default.

| Option                         | Default                                                   | Bounds / type                       | Description                                                                                   |
| ------------------------------ | --------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `model`                        | `openai/gpt-6-luna`                                       | `provider/model`                    | Reviewer model (override with any provider/model)                                             |
| `variant`                      | `medium`                                                  | non-empty string                    | Reasoning variant passed to OpenCode                                                          |
| `outputFormat`                 | `json_schema`                                             | `json_schema` / `text`              | How the reviewer returns its decision (`text` for models without structured output)           |
| `escalationReviewer`           | unset                                                     | trusted object                      | Optional reasoning reviewer for valid but difficult Jev decisions                             |
| `timeoutMs`                    | `120000`                                                  | `5000` to `600000`                  | Review timeout                                                                                |
| `reviewBudgetMs`               | `2 * timeoutMs + 60000`                                   | `5000` to `900000`                  | Total budget for one review, including retries                                                |
| `confidenceThreshold`          | `0.7`                                                     | `0.5` to `1`                        | Minimum confidence to auto-act; below it escalates                                            |
| `systemOneConfidenceThreshold` | `0.4`                                                     | `0.3` to `1`                        | Calibrated Jev outcome-confidence floor; below it escalates                                   |
| `systemOneReasoningThreshold`  | `0.38`                                                    | `0` to `1`                          | Combined `allow`/`deny` probability required to send an explicit Jev escalation to reasoning  |
| `maxContextChars`              | `32000`                                                   | `4000` to `200000`                  | Total transcript evidence budget                                                              |
| `maxPartChars`                 | `8000`                                                    | `500` to `50000`                    | Per-message-part budget                                                                       |
| `maxEnrichmentChars`           | `24000`                                                   | `1000` to `100000`                  | SSH / script / Git enrichment budget                                                          |
| `maxIntentChars`               | `8000`                                                    | `1000` to `50000`                   | User-intent history budget                                                                    |
| `transcriptMessages`           | `12`                                                      | `1` to `100`                        | Recent messages shown to the reviewer                                                         |
| `intentMessages`               | `8`                                                       | `1` to `50`                         | Genuine user intents kept                                                                     |
| `historyMessages`              | `200`                                                     | `20` to `500`                       | Operational messages fetched; literal user intent is recovered separately                     |
| `retainReviewSessions`         | `false`                                                   | boolean                             | Keep reviewer child sessions (debug only)                                                     |
| `audit`                        | `true`                                                    | boolean                             | Append one JSONL audit record per review                                                      |
| `auditPath`                    | `~/.local/share/opencode/permission-reviewer-audit.jsonl` | path                                | Audit file location                                                                           |
| `policy`                       | built-in default                                          | string                              | Full local override of the tenant policy text                                                 |
| `debug`                        | `false`                                                   | boolean                             | Verbose logs to stderr                                                                        |
| `enforcementMode`              | `observe`                                                 | `observe` / `enforce`               | `enforce` applies declarative policy routes; `observe` audits them only                       |
| `escalationMode`               | `manual`                                                  | `manual` / `deny`                   | How final escalations are disposed (`manual` = human; `deny` = fail-closed reject)            |
| `maxSessionDepth`              | `8`                                                       | `1` to `32`                         | Parent-session lineage walk depth                                                             |
| `maxParentSessions`            | `8`                                                       | `0` to `32`                         | Max parent sessions resolved for actor context                                                |
| `actorProfiles`                | `{}`                                                      | name → profile map                  | Trusted agent name → profile (`read-only`, `validation`, `workspace`, …)                      |
| `riskPolicy`                   | built-in conservative matrix                              | object                              | Override `allow` cells per risk level and failure modes (`onInvalidDecision`, …)              |
| `repositoryTrust`              | `unknown`                                                 | `trusted` / `untrusted` / `unknown` | Repository trust level used by the policy engine                                              |
| `policyRules`                  | `[]`                                                      | array                               | Declarative rules (most-restrictive wins); project rules combine with trusted ones            |
| `askDecisions`                 | `true`                                                    | boolean                             | Show the reviewer what the user answered in agent ask dialogs (scoped authorization evidence) |

## Config layers and the trust boundary

Config is layered. Each layer overrides the one before it:

1. Built-in defaults.
2. Trusted global config, `~/.config/opencode/permission-reviewer.jsonc`.
3. Untrusted project config, `.opencode/permission-reviewer.jsonc`.
4. Unknown-origin inline plugin options.

The project layer crosses a trust boundary. It cannot set some fields at all, and it can only
tighten the security-sensitive fields it may set. Its hardening survives even when a trusted layer
set the same field.

The project layer cannot:

- Choose the reviewer `model`, `escalationReviewer`, `variant`, or `outputFormat`, or replace the
  `policy` text. These decide where code and context travel and how the reviewer enforces and
  reports.
- Redirect `auditPath`.
- Flip `retainReviewSessions`, `askDecisions`, or `debug`.
- Grant `actorProfiles`.
- Set `repositoryTrust: "trusted"`.
- Set `enforcementMode` in either direction.
- Relax a trusted `escalationMode: "deny"`, a failure-mode deny knob, `confidenceThreshold`,
  `systemOneConfidenceThreshold`, `systemOneReasoningThreshold`, or `riskPolicy`.

The project layer cannot set the reviewer resource options at all: `timeoutMs`, `reviewBudgetMs`,
`maxContextChars`, `maxPartChars`, `maxEnrichmentChars`, `maxIntentChars`, `transcriptMessages`,
`intentMessages`, `historyMessages`, `maxSessionDepth`, and `maxParentSessions`. They decide how
long a review runs and how much conversation reaches the provider. Raising them sends more to the
provider and lowering them hides evidence, so only global configuration may change them.

Project and inline values of the wrong type, including `null`, are ignored. They are never
normalized back to defaults.

## Degraded config

A config file that exists but cannot be honored fails closed on the trusted side. Any of these
marks the run as degraded:

- A malformed or unreadable global config.
- Trusted `policyRules` dropped by validation.
- An invalid `escalationReviewer`, `enforcementMode`, or `escalationMode` in the global config.

In a degraded run, reviews still run, but automatic approval stays off and everything escalates
until the file is fixed. The plugin reports the degradation on stderr.

A malformed project file is reported and ignored, without degrading the run: the project layer
can only add restrictions, so losing it never loosens the trusted config.

## Declarative policy rules

In `policyRules`, a `when` condition drops the whole rule if it has an unknown key (a typo), a
`false` flag, or is an empty object. This keeps a mistyped rule from turning into a universal
match.

To write a catch-all rule, spell it explicitly: omit `when` entirely, or use
`"when": { "always": true }`, which is valid only on its own. A catch-all from the trusted global
config matches everything. Allow rules from the project config are still rejected outright.

## Headless use

Reviews run inside the OpenCode server, and the TUI overlay is optional. The plugin therefore works
with a headless `opencode serve` and with any client that drives it through the server API. The
compatibility matrix in CI and the live test harnesses exercise it this way, with no TUI attached.

With no one at a terminal, a manual escalation has nobody to answer it. Use fail-closed mode for
unattended agents, as described in the next section.

`opencode run` is not covered by the tests. In non-interactive mode it answers pending permission
requests itself, rejecting them or approving them with `--auto`, so its answer can arrive before a
review finishes. Check it against your host version before relying on it.

## Interactive vs autonomous

| Mode                     | Config                     | Behavior                                                                |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------- |
| Interactive (default)    | `escalationMode: "manual"` | Uncertainty escalates to you; OpenCode's native approval UI takes over  |
| Autonomous / fail-closed | `escalationMode: "deny"`   | Every final escalation becomes a reject with rationale; no human prompt |

For unattended agents, set fail-closed mode in the global config, not in the repository:

```jsonc
// ~/.config/opencode/permission-reviewer.jsonc
{
  "escalationMode": "deny",
}
```

Under interactive mode you can also harden individual failure cases. Each knob affects only its
own case:

```jsonc
{
  "riskPolicy": {
    "onInvalidDecision": "deny", // invalid structured output → reject
    "onReviewerFailure": "deny", // timeout / transport failure → reject
  },
}
```

## Audit log

`audit` defaults to `true`. Set `audit: false` to disable it.

Each completed review appends one JSON object to the audit path. The file is created with mode
`0600` and kept at that mode: a pre-existing audit file with looser permissions is tightened
before it receives new records. Each record (`schemaVersion: 3`) contains:

- Outcome and decision source.
- Rationale, risk, authorization, and confidence.
- Per-phase latency.
- Reviewer model.
- Optional `reviewerOutcome` and `escalationDisposition`, which distinguish an explicit deny from a
  fail-closed escalation that became a deny.
- Optional System One escalation origin.
- A bounded SSH summary.

Remote commands are stored as SHA-256, never in clear text.

### System One scores

When Jev (System One) returns a valid decision, the record also has a `systemOne` field with Jev's
own scores. It is present even when a reasoning reviewer made the final call and the top-level
`confidence` and `riskLevel` are that reviewer's. It holds:

- The model ID the provider reported.
- The outcome with its probabilities.
- The choice and confidence of each supporting classification.
- The nine 0 to 1 safety signals.
- The consistency checks that failed.
- Whether reasoning was recommended.

The model ID is capped at 128 characters and redacted like other free text. Everything else is
numbers and fixed labels, never evidence or command text.

The field is absent when Jev never ran (a deterministic route), when its answer was invalid or its
call failed, and on V1 hosts when a manual answer superseded the automatic review.

```json
"systemOne": {
  "returnedModel": "jev-1.13.0",
  "outcome": { "choice": "allow", "confidence": 0.55, "probabilities": { "allow": 0.55, "deny": 0.05, "escalate": 0.4 } },
  "supporting": {
    "riskLevel": { "choice": "low", "confidence": 0.82 },
    "userAuthorization": { "choice": "high", "confidence": 0.77 },
    "scopeAlignment": { "choice": "aligned", "confidence": 0.9 },
    "evidenceCompleteness": { "choice": "partial", "confidence": 0.61 },
    "primaryBasis": { "choice": "authorized_reversible_change", "confidence": 0.58 }
  },
  "signals": { "materialAuthorization": 0.81, "withinIntentScope": 0.88, "unauthorizedDataLoss": 0.12, "untrustedSensitiveDisclosure": 0.01, "excessiveCredentialAccess": 0.01, "unauthorizedSecurityChange": 0.02, "unauthorizedExternalMutation": 0.03, "essentialEvidenceMissing": 0.27, "absolutePolicyDeny": 0.02 },
  "contradictions": ["an allow with incomplete evidence lacks strong outcome confidence"],
  "reasoningRecommended": true
}
```
