# Reviewer models

This page covers how to choose the reviewer model, how to set up the Jev System One reviewer, and
how to use models that do not support structured output. For the full option table and config
layering, see [Configuration](CONFIGURATION.md).

## Choosing the reviewer model

By default the reviewer is a normal OpenCode model invocation with every operational tool denied
at the session-permission level, so it can be any model from any provider you have configured. Jev
models automatically use the typed System One API instead.

The model options are:

- `model`: in `provider/model` form. Chat models must match a configured OpenCode provider.
  Supported Jev IDs use the [direct System One API](#jev-system-one-reviewer).
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

## Jev System One reviewer

Set `model` in the trusted global `~/.config/opencode/permission-reviewer.jsonc`, and put the
matching key in the OpenCode server process environment before you start OpenCode. The Jev call
uses the provider's System One endpoint directly. It does not read OpenCode's `/connect`
credentials or the Command Code CLI login.

The supported routes are:

| Reviewer `model`                                       | Required environment variable | System One API                                                                                |
| ------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `opencode/jev-1.13` (or `opencode/jev-1.13-free`)      | `OPENCODE_API_KEY`            | [OpenCode Zen](https://opencode.ai/docs/en/zen/#jev)                                          |
| `typesafe-ai/jev-1.13.0` (or `typesafe-ai/jev-latest`) | `TYPESAFE_API_KEY`            | [TypeSafe AI](https://docs.typesafe.ai/sdk/javascript)                                        |
| `commandcode/typesafe/jev`                             | `CMD_API_KEY`                 | [Command Code Provider API](https://commandcode.ai/docs/provider#decision-models-typesafejev) |

Command Code requires an API-enabled plan such as GOAT, Pro, Max, Team, or Provider. The Go plan
has no Provider API access. Put a Command Code API key from Studio in `CMD_API_KEY`. Jev is a
headless decision model on Command Code, so you cannot select it as an interactive Command Code
chat model.

### Jev only

For Jev on its own, omit `escalationReviewer`:

```jsonc
// ~/.config/opencode/permission-reviewer.jsonc
{
  "model": "opencode/jev-1.13",
  "timeoutMs": 120000,
}
```

To use another provider, replace `model` with either of the other IDs in the table.

### Jev with selective reasoning escalation

To send some Jev decisions to a reasoning model, add a chat model that is already configured in
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

### How Jev decisions are handled

Jev receives typed state and fixed questions instead of a chat session, so `variant` and
`outputFormat` do not apply to the primary call. The plugin reconciles Jev's answers with
deterministic confidence and consistency checks.

- Straightforward valid decisions are enforced normally, including valid denials.
- A difficult `allow` goes to `escalationReviewer` when one is configured.
- An explicit `escalate` goes to `escalationReviewer` only when Jev assigns enough combined
  probability to `allow` or `deny` to make a second opinion useful. Clear escalations stay human
  reviews, so you do not pay for another model that is unlikely to resolve them.
- Without `escalationReviewer`, final escalations follow `escalationMode` and the failure
  settings.
- Provider failures, timeouts, and invalid responses never invoke the second model.

### System One thresholds

`systemOneConfidenceThreshold` applies to Jev's outcome confidence, not to the lowest confidence
among all descriptive fields. The plugin uses the supporting classifications as consistency
signals:

- Very weak support restricts an `allow`.
- Incomplete evidence requires stronger outcome confidence.
- Material safety signals always route away from automatic approval.

This calibration is separate from the chat-reviewer `confidenceThreshold`.

`systemOneReasoningThreshold` controls how much traffic explicit Jev escalations send to the
secondary reviewer. Raising it sends fewer cases to the reasoning reviewer. Project configuration
may raise this value but cannot lower a trusted threshold.

Audit records include Jev's own scores; see [System One scores](CONFIGURATION.md#system-one-scores).

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
