# OpenCode Permission Reviewer

[![checks](https://img.shields.io/github/actions/workflow/status/noppu-labs/opencode-permission-reviewer/ci.yml?branch=main&label=checks)](https://github.com/noppu-labs/opencode-permission-reviewer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@noppu-labs/opencode-permission-reviewer?color=CB3837)](https://www.npmjs.com/package/@noppu-labs/opencode-permission-reviewer)
[![downloads](https://img.shields.io/npm/dw/@noppu-labs/opencode-permission-reviewer)](https://www.npmjs.com/package/@noppu-labs/opencode-permission-reviewer)
[![OpenCode](https://img.shields.io/badge/OpenCode-%E2%89%A51.18.29-6E56CF)](https://opencode.ai)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.3.0-000000)](https://bun.sh)
[![license](https://img.shields.io/badge/license-MIT%20%2B%20Apache--2.0-blue)](#license)

An OpenCode plugin that sends every `ask` permission to a tool-free AI reviewer. The reviewer
reads the pending request, recent transcript evidence, what you asked for, and a policy you
control. It then allows the action, denies it with a reason the agent can act on, or escalates
it to you. Routine actions stop waiting for a keystroke, and risky ones are still blocked or
brought to you.

This is a fork of [warc0s/opencode-permission-reviewer](https://github.com/warc0s/opencode-permission-reviewer),
published to npm as `@noppu-labs/opencode-permission-reviewer`, and carries fixes that are
waiting upstream. It is an unofficial community plugin, not affiliated with or endorsed by
[Anomaly](https://anoma.ly).

## What it does

- Leaves your existing policy alone: `allow` rules continue and `deny` rules stay blocked
  without reaching the reviewer.
- Reviews in isolation. Normal models run in a scratch session with every tool denied. Jev
  models use their typed System One API, which exposes no tools or project runtime.
- Gives the reviewer bounded, sanitized, read-only evidence about SSH commands, local scripts,
  and Git state. It never modifies the filesystem.
- Never auto-approves an action the reviewer classifies as critical. Reviewer failures lead to
  manual review or denial, never to an approval.
- Writes one JSONL audit record per review, with remote commands stored as SHA-256 hashes.
- Shows review progress in an optional TUI overlay that steps aside for OpenCode's own approval
  controls.

## Requirements

- [Bun](https://bun.sh) >= 1.3.0
- [OpenCode](https://opencode.ai) V1 `>=1.18.29 <2` (tested with 1.18.34) or V2 `>=2.0.3 <3`
  (tested with 2.0.21)
- `git` on `PATH`, used only for read-only Git enrichment. Without it, Git enrichment degrades
  gracefully.
- A reviewer model: either a model configured in OpenCode that follows JSON schemas reliably, or
  a Jev API key in the OpenCode server's environment. See
  [Reviewer models](docs/REVIEWER-MODELS.md).
- At least one `ask` rule in your OpenCode permission policy. If everything is already `allow`
  or `deny`, the plugin never runs.

[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) has the full support matrix.

## Install

```bash
bun add @noppu-labs/opencode-permission-reviewer   # or: npm install @noppu-labs/opencode-permission-reviewer
```

The CLI can register the plugin for you. `--host auto` detects V1 or V2, `--tui` also registers
the overlay (V1 `tui.json` or V2 global `cli.json`), and `--npm` writes the package name instead
of a path. It never overwrites an existing entry.

```bash
bunx @noppu-labs/opencode-permission-reviewer init --host auto --npm --tui --yes
```

To run from a checkout instead, clone the repository, run `bun install && bun run build`, and
register the checkout's absolute path.

## Configure

Register the plugin and make sure at least one permission is `ask`.

OpenCode V1 (`opencode.json` in the project, or `~/.config/opencode/opencode.json`):

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@noppu-labs/opencode-permission-reviewer"],
  "permission": {
    "bash": "ask", // at least one ask rule, or the plugin is a no-op
  },
}
```

OpenCode V2:

```jsonc
// opencode.json
{
  "plugins": [{ "package": "@noppu-labs/opencode-permission-reviewer", "options": {} }],
  "permissions": [{ "action": "shell", "resource": "*", "effect": "ask" }],
}
```

Reviewer settings go in the trusted global `~/.config/opencode/permission-reviewer.jsonc`. The
default reviewer is `openai/gpt-6-luna` at `medium` reasoning. To change it:

```jsonc
// ~/.config/opencode/permission-reviewer.jsonc
{ "model": "provider/model", "variant": "medium", "timeoutMs": 120000 }
```

Restart OpenCode fully after installing or rebuilding, because the host loads plugins once at
startup. Then ask the agent to run something safe, such as `printf hello`. An approved action
runs normally, with no rationale added to the agent's context. A denied one returns a short
reason the agent can act on.

Every `ask` costs one reviewer call, so model spend grows with how much your policy asks. A
lower reasoning `variant` or a higher `confidenceThreshold` reduces it.

[docs/CONFIGURATION.md](docs/CONFIGURATION.md) covers TUI registration, V2 server connections,
every option, the trust rules between global and project config, unattended (fail-closed) mode,
and the audit log.

## How it works

A deterministic emergency brake first rejects unmistakable root destruction and direct
credential export without calling a model. For everything else, the plugin builds bounded
evidence from the recent transcript, recovered user intent, and read-only enrichment, with
common credential formats redacted. A tool-free reviewer returns an outcome, risk level,
authorization level, rationale, and confidence. Invariants in code then decide whether that
decision can stand: invalid output, low confidence, and risky actions without matching
authorization escalate instead of being approved.

```text
✓ Review approved · bash · rm -rf /tmp/scratch-cache
Narrowly scoped temp cleanup; matches user intent.
```

## Documentation

| Page                                       | Contents                                                          |
| ------------------------------------------ | ----------------------------------------------------------------- |
| [Configuration](docs/CONFIGURATION.md)     | Setup details, all options, config trust layers, audit log        |
| [Reviewer models](docs/REVIEWER-MODELS.md) | Picking a model, Jev System One, models without structured output |
| [How it works](docs/HOW-IT-WORKS.md)       | The review pipeline, TUI states, evidence enrichment              |
| [Safety](docs/SAFETY.md)                   | Safety properties and threat model                                |
| [Supply chain](docs/SUPPLY-CHAIN.md)       | What the package ships, dependency policy, known advisories       |
| [Compatibility](docs/COMPATIBILITY.md)     | Supported versions and troubleshooting                            |
| [Migration](MIGRATION.md)                  | Moving between OpenCode V1 and V2, rollback                       |
| [Development](docs/DEVELOPMENT.md)         | Build output, live testing, compatibility matrix, benchmark       |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in
[SECURITY.md](SECURITY.md).

## License

Changes made in this fork are released under the [MIT License](LICENSE). Code from the upstream
project, © 2026 Warc0s, remains under the [Apache License 2.0](LICENSE-APACHE). The reviewer
policy design is inspired by
[OpenAI Codex Guardian](https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian);
[NOTICE](NOTICE) has the full attribution.
