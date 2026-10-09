# Compatibility and troubleshooting

Supported host, SDK, runtime, and OS versions, how the plugin adapts to each OpenCode generation,
and fixes for common problems.

## Supported versions

| Component             | Supported          | Notes                                                   |
| --------------------- | ------------------ | ------------------------------------------------------- |
| OpenCode V1           | `>=1.18.29 <2`     | Dual object entrypoint; verified with 1.18.34           |
| OpenCode V2           | `>=2.0.3 <3`       | Compatibility layer; verified with 2.0.21               |
| `@opencode-ai/plugin` | `>=1.18.29 <2`     | Optional V1 peer dependency                             |
| Bun                   | `>=1.3.0`          | Declared in `engines.bun`; CI runs 1.3.0 and 1.3.5      |
| TUI overlay           | OpenCode V1 and V2 | Separate host adapters, shared raw TSX presentation     |
| OS                    | Linux (verified)   | Other operating systems need equivalent live validation |

Run `opencode-permission-reviewer doctor` to compare the installed versions against these
ranges.

## TUI overlay

The TUI overlay ships as raw TSX (`dist/tui/tui.tsx`). The host compiles it against its embedded
Solid/OpenTUI runtime. A prebundled TUI entry loads but never paints. The server half does not
depend on the overlay.

## V1 reply transport

On OpenCode V1, the server half replies through an isolated transport chosen once at startup. It
tries these in order and uses the first that is available:

1. The public SDK reply with a feedback `message`.
2. The public reply plus a separate feedback channel.
3. Authenticated raw HTTP (`/permission/{requestID}/reply` via `input.client._client.post`).
4. If none of the above is available, the plugin refuses to start.

On OpenCode 1.18.x the message-bearing reply is only reachable through the raw transport, so the
chain resolves at step 3. That raw field is not part of OpenCode's public plugin API and can
change without notice. If startup fails with _"authenticated SDK transport is unavailable"_, file
an issue instead of downgrading.

## V2 permission evaluation

V2 evaluates pending permissions through `permission.evaluate`. `shell` and `subagent` map to the
shared internal `bash` and `task` labels. Input that is already marked allow or deny is neither
elevated nor reviewed.

## Platform notes

Full enrichment assumes a Unix-like system (macOS or Linux). On Windows, SSH and Git enrichment
degrade gracefully toward fail-safe manual review.

Keep `retainReviewSessions` set to `false` in normal use. Set it to `true` to retain isolated
reviewer sessions for inspection in either host generation. See
[Configuration](./CONFIGURATION.md).

## Launchers and wrappers

A standard OpenCode installation invokes its runtime directly. Custom profile launchers are also
supported when they select a supported runtime and provide coherent config, data, state, and cache
locations.

The isolated compatibility matrix is stricter: point the host variables at the underlying
executable, not at a launcher that overrides the harness environment. See
[`tests/compatibility`](../tests/compatibility/README.md) and
[Development](./DEVELOPMENT.md#compatibility-matrix).

## Troubleshooting

### Every `ask` escalates after a long wait

The reviewer model is not found, or its provider is not configured. Check the model ID in the
global `permission-reviewer.jsonc`.

### The plugin does nothing

The host permission policy has no `ask` rule. Set a V1 `"bash": "ask"` rule or a V2 shell
permission with `effect: "ask"`.

### The TUI overlay never appears

The TUI config is wrong, a stale process is running, or the host has no Solid/OpenTUI pipeline.
Check the V1 `tui.json` or the V2 global `cli.json`. The overlay is raw TSX (`dist/tui/tui.tsx`);
a prebundled `dist/tui.js` does not render. Fully restart OpenCode after rebuilds.

### Startup error: "authenticated SDK transport…"

OpenCode V1 is outside `>=1.18.29 <2`, or an SDK change hides the raw transport. Upgrade OpenCode
and `@opencode-ai/plugin` into the supported range, and report the version in an issue.

### Reviewer host connection unavailable

An independent V2 server has no registered endpoint. Configure the trusted server URL and
authentication, then restart.

### Reviews always time out

`timeoutMs` is too low for the model. Raise `timeoutMs` (up to 600000).

### `GIT_STATE_ANALYSIS` shows `spawn git ENOENT`

`git` is not on `PATH`. Install `git`; Git enrichment degrades safely until then.

### Checking versions

If the host or SDK may be outside the supported range, run `opencode --version` and
`opencode-permission-reviewer doctor`.

### Turning the plugin off

Remove the plugin from the host config and, if installed, from the V1 `tui.json` or V2 global
`cli.json`.

### Logs

Enable `"debug": true` for verbose stderr logs while investigating. TUI load errors
(`[tui.plugin] …`) are printed on the TUI process console, not in
`~/.local/share/opencode/log/opencode.log`.
