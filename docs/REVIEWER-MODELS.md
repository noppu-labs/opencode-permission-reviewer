# Reviewer models

This page covers how to choose the reviewer model, how to set up a System One reviewer, and
how to use models that do not support structured output. For the full option table and config
layering, see [Configuration](CONFIGURATION.md).

## Choosing the reviewer model

By default the reviewer is a normal OpenCode model invocation with every operational tool denied
at the session-permission level, so it can be any model from any provider you have configured.
System One models (Jev, Liquid AI d1 and Baseten decision models) automatically use the typed
System One API instead.

The model options are:

- `model`: in `provider/model` form. Chat models must match a configured OpenCode provider.
  Supported System One IDs use the [direct System One API](#system-one-reviewers).
- `variant`: a reasoning effort the model supports (`max`, `high`, `medium`, `low`, `none`). It is
  passed straight through to OpenCode.
- `outputFormat`: how the reviewer returns its decision. `json_schema` is the default and uses
  OpenCode's structured output, which needs provider support. `text` asks the model to emit JSON
  in plain text and parses it locally. Use `text` for models that reject the `json_schema` format,
  such as `opencode-go/deepseek-v4-flash`.
- `timeoutMs`: the review timeout.

Whichever model you pick should follow structured output reliably.

Model mistakes can cause unsupported approvals as well as unnecessary escalations, so compare both
safety errors and format validity when you evaluate a model. Higher reasoning variants may cost
more or take longer without always improving the result.

## System One reviewers

System One reviewers are decision models that answer a fixed set of typed questions instead of
running a chat session. The plugin supports Jev, Liquid AI's d1 models and Baseten's decision
models.

Set `model` in the trusted global `~/.config/opencode/permission-reviewer.jsonc`, and put the
matching key in the OpenCode server process environment before you start OpenCode. The System One
call uses the provider's endpoint directly. It does not read OpenCode's `/connect` credentials or
the Command Code CLI login.

The supported routes are:

| Reviewer `model`                                                                                               | Required environment variable | System One API                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `opencode/jev-1.13` (or `opencode/jev-1.13-free`)                                                              | `OPENCODE_API_KEY`            | [OpenCode Zen](https://opencode.ai/docs/en/zen/#jev)                                          |
| `typesafe-ai/jev-1.13.0` (or `typesafe-ai/jev-latest`)                                                         | `TYPESAFE_API_KEY`            | [TypeSafe AI](https://docs.typesafe.ai/sdk/javascript)                                        |
| `commandcode/typesafe/jev`                                                                                     | `CMD_API_KEY`                 | [Command Code Provider API](https://commandcode.ai/docs/provider#decision-models-typesafejev) |
| `liquid-ai/d1` (or `liquid-ai/d1-ultra`)                                                                       | `LIQUID_API_KEY`              | [Liquid AI](https://docs.liquid.ai/lfm/models/d1)                                             |
| `baseten/decision-models/baseten-mammoth-27b-latest` (or `baseten/decision-models/baseten-elephant-9b-latest`) | `BASETEN_API_KEY`             | [Baseten](https://docs.baseten.co/inference/model-apis/decision-models)                       |

Command Code requires an API-enabled plan such as GOAT, Pro, Max, Team, or Provider. The Go plan
has no Provider API access. Put a Command Code API key from Studio in `CMD_API_KEY`. Jev is a
headless decision model on Command Code, so you cannot select it as an interactive Command Code
chat model.

For Liquid AI, create a key in the Liquid Console; its keys start with `liquid_`. Other providers,
such as the `liquid` inference router in OpenCode's model catalog, also read `LIQUID_API_KEY`. The
plugin refuses to send a key that is not shaped like a Liquid AI key, and the review follows the
failure settings instead. The error message never contains the key.

### Choosing a decision model

These notes come from upstream's benchmark of the decision models on its synthetic PRB-600 corpus
(upstream 2.5.0). They are upstream's results, not measurements of this fork, and your own corpus
may differ.

- `baseten/decision-models/baseten-mammoth-27b-latest` scored highest, alone or with a reasoning
  reviewer, with the default thresholds.
- `liquid-ai/d1-ultra` alone made no false denials. With an `escalationReviewer`, set
  `systemOneReasoningThreshold` to `0.6` for it.
- `baseten/decision-models/baseten-elephant-9b-latest` needs `systemOneConfidenceThreshold: 0.6`
  to avoid unsupported approvals.
- `liquid-ai/d1` made unsupported approvals at every threshold and is not recommended.
- Jev 1.14 gained the most from an `escalationReviewer`.

All of them use the same typed questions and the same thresholds as Jev.

### System One only

For a System One model on its own, omit `escalationReviewer`:

```jsonc
// ~/.config/opencode/permission-reviewer.jsonc
{
  "model": "opencode/jev-1.13",
  "timeoutMs": 120000,
}
```

To use another provider, replace `model` with any other ID in the table.

### System One with selective reasoning escalation

To send some System One decisions to a reasoning model, add a chat model that is already configured in
OpenCode as `escalationReviewer`:

```jsonc
// ~/.config/opencode/permission-reviewer.jsonc
{
  "model": "commandcode/typesafe/jev",
  "timeoutMs": 120000,
  "systemOneConfidenceThreshold": 0.4,
  "systemOneReasoningThreshold": 0.38,
  "escalationReviewer": {
    "model": "openai/gpt-6-luna",
    "variant": "medium",
    "outputFormat": "json_schema",
    "timeoutMs": 120000,
  },
}
```

### How System One decisions are handled

A System One model receives typed state and fixed questions instead of a chat session, so
`variant` and `outputFormat` do not apply to the primary call. The plugin reconciles its answers
with deterministic confidence and consistency checks.

- Straightforward valid decisions are enforced normally, including valid denials.
- A difficult `allow` goes to `escalationReviewer` when one is configured.
- An explicit `escalate` goes to `escalationReviewer` only when System One assigns enough combined
  probability to `allow` or `deny` to make a second opinion useful. Clear escalations stay human
  reviews, so you do not pay for another model that is unlikely to resolve them.
- Without `escalationReviewer`, final escalations follow `escalationMode` and the failure
  settings.
- In the default `systemOneEscalation: "standard"` mode, provider failures, timeouts, and invalid
  responses never invoke the second model.

#### `systemOneEscalation: "reasoning-first"`

With a System One `model` and an `escalationReviewer`, every escalation that starts at System One
goes to the reasoning reviewer before it can reach you. System One never sends a request to you
directly, unless less than 15 seconds of the review budget remain.

| System One result                              | `standard`                             | `reasoning-first`                        |
| ---------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| Clean allow or deny                            | final                                  | final                                    |
| Allow with contradictions, gated or not        | reasoning reviewer                     | reasoning reviewer                       |
| `escalate` below `systemOneReasoningThreshold` | you                                    | reasoning reviewer                       |
| `escalate` at or above the threshold           | reasoning reviewer                     | reasoning reviewer                       |
| Consistent allow stopped by a gate             | you                                    | reasoning reviewer                       |
| Invalid or ambiguous answer                    | you, or a deny per `onInvalidDecision` | reasoning reviewer, without its scores   |
| Timeout or transport error                     | you, or a deny per `onReviewerFailure` | reasoning reviewer                       |

`systemOneReasoningThreshold` is ignored in this mode.

#### `systemOneDenialReview: true`

With the same model and reviewer, an uncertain System One denial goes to the reasoning reviewer, which can
confirm or overturn it. A denial is uncertain when it is a System One `deny` that fails at least one of
System One's consistency checks, for example an outcome confidence below
`systemOneConfidenceThreshold`. The denial stays final when System One reports an absolute policy-deny
signal of 0.7 or more, or a data-loss, sensitive-disclosure, credential-access, security-change, or
external-mutation signal of 0.5 or more. Denials from the emergency brake and policy rules are
never reviewed. A reasoning approval of an uncertain denial that System One rated critical risk escalates
instead of allowing. The two settings are independent.

#### After a hand-off

- A reasoning `deny` is final.
- A reasoning `allow` passes the normal gates, applied to the reasoning reviewer's own decision
  (its own risk rating and evidence), and stands only with `sufficient` evidence; otherwise the
  request escalates. Under `reasoning-first`, and for an uncertain denial, when the System One decision
  that triggered the hand-off rated the request critical risk, a reasoning `allow` escalates instead
  of allowing.
- A reasoning `escalate`, an invalid answer, or a reasoning failure is a final escalation.
  `escalationMode`, `riskPolicy.onInvalidDecision`, and `riskPolicy.onReviewerFailure` apply to
  this final outcome, never to System One's own answer.
- A review hands off at most once; the two settings never chain.
- A hand-off needs 15 seconds of the review budget (`reviewBudgetMs`) left, in either mode. With
  less, the request escalates and the audit record has `resolution: "budget-exhausted"`.
- Audit records name the hand-off in `reviewerEscalatedFrom.trigger` and how an escalation ended in
  `resolution`; see [Audit log](CONFIGURATION.md#audit-log).

### System One thresholds

`systemOneConfidenceThreshold` applies to System One's outcome confidence, not to the lowest confidence
among all descriptive fields. The plugin uses the supporting classifications as consistency
signals:

- Very weak support restricts an `allow`.
- Incomplete evidence requires stronger outcome confidence.
- Material safety signals always route away from automatic approval.

This calibration is separate from the chat-reviewer `confidenceThreshold`.

`systemOneReasoningThreshold` controls how much traffic explicit System One escalations send to the
secondary reviewer in `standard` mode. Raising it sends fewer cases to the reasoning reviewer.
Project configuration may raise this value but cannot lower a trusted threshold. Under
`reasoning-first` it is ignored: every System One escalation goes to the reasoning reviewer.

Audit records include System One's own scores; see [System One scores](CONFIGURATION.md#system-one-scores).

## Reviewer models without structured-output support

Some models, such as `opencode-go/deepseek-v4-flash`, do not support OpenCode's `json_schema`
structured-output format and fail with a format error when it is requested. For those models, set
`"outputFormat": "text"`. The reviewer then asks the model to emit its decision as plain JSON and
parses it locally. Set this option in the trusted global `permission-reviewer.jsonc` on either
host:

```jsonc
{
  "model": "opencode-go/deepseek-v4-flash",
  "variant": "high",
  "outputFormat": "text",
  "timeoutMs": 120000,
}
```

Text mode has no host-side schema enforcement. If the response is unparseable, the plugin
re-prompts the reviewer once, mirroring the auto-retry that `json_schema` mode gets from
OpenCode. A response that is still invalid is not auto-approved; it escalates or is denied
according to `escalationMode`.

Parsing fails closed. The entire response must be exactly one JSON object, optionally wrapped in a
single Markdown code fence. Prose around the object, multiple objects, multiple fences, or any
other ambiguity prevents automatic approval.

Every parsed decision still passes the same strict `parseDecision` validation and
`enforceDecision` invariants (for example, model-classified critical risk is not approved), so
text mode cannot approve anything that structured mode would not.

## Limits of the deterministic gates

See [Safety](SAFETY.md#threat-model) for what the deterministic gates cannot catch, in either
output format, and why that argues for as strong a reviewer model as your budget allows.
