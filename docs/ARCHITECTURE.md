# Architecture

Who and what the plugin deals with, what each of them can do, and every interface the released
package exposes. For the review pipeline step by step, see [How it works](HOW-IT-WORKS.md); for
every option and the audit record, [Configuration](CONFIGURATION.md); for the threat model and
the invariants, [Safety](SAFETY.md).

## Actors

| Actor | What it is | How the plugin deals with it |
| --- | --- | --- |
| User | The person running OpenCode | Writes the OpenCode permission policy and the reviewer configuration, answers the reviews that escalate, and runs the CLI |
| OpenCode V1 host | OpenCode `>=1.18.29 <2` | Loads the `server` plugin function, emits `permission.asked` events, and takes the plugin's reply (`once` or `reject`) through its SDK transport ([V1 reply transport](COMPATIBILITY.md#v1-reply-transport)) |
| OpenCode V2 host | OpenCode `>=2.0.22 <3` | Calls the plugin's `setup`, then its `permission.evaluate` hook for each request still at `ask`, and serves the plugin's read-only [RPC protocol](#rpc-protocol) |
| Primary agent | The agent whose tool call needs permission | Never talks to the plugin. It gets the host's normal tool result on approval and a short reason on denial ([Reply](HOW-IT-WORKS.md#6-reply)) |
| Plugin server part | `dist/index.js`, loaded into the OpenCode server process | Runs the brake, gathers evidence, calls the reviewer, enforces the invariants, replies, writes the audit log |
| Reviewer: OpenCode model | A model configured in OpenCode, in an auxiliary session | Runs in an isolated location with every operational tool denied ([Reviewer backend](HOW-IT-WORKS.md#4-reviewer-backend)). Provider credentials stay inside OpenCode. |
| Reviewer: System One provider | A decision model served over HTTPS (OpenCode Zen, TypeSafe, Command Code, Liquid AI, Baseten, OpenRouter); `TYPESAFE_BASE_URL` can point the TypeSafe one elsewhere | One typed request per review, with the provider's API key from the server's environment ([Network endpoints](#network-endpoints)) |
| TUI part | `dist/tui/tui.tsx`, loaded into the OpenCode TUI process | Shows review progress and results. On V2 it reads them over the RPC protocol; on V1 the server publishes them through the host's `/tui/publish` route. It has no way to approve anything ([TUI guide](TUI.md)) |
| CLI | The `opencode-permission-reviewer` command | Run by the user; see [CLI](#cli) |
| Audit log | A JSONL file | The server part appends one record per review ([Audit log](CONFIGURATION.md#audit-log)) |
| Configuration files | The reviewer's own JSONC files and OpenCode's config files | Read at startup; `init` writes OpenCode's ([Configuration files](#configuration-files)) |
| `git` | The `git` executable on `PATH` | Run read-only for Git evidence ([Git operations](HOW-IT-WORKS.md#git-operations)) |
| Other plugins | Anything else loaded into the same host | Can override the plugin's decision; out of the plugin's control ([SECURITY.md](SECURITY.md#scope)) |

## Actions

### At runtime

| Action | Actor | Where it is described |
| --- | --- | --- |
| Review a permission request: brake, evidence, reviewer, enforcement | Server part | [The review pipeline](HOW-IT-WORKS.md#the-review-pipeline) |
| Approve, deny, or escalate to the user (or deny in `escalationMode: "deny"`) | Server part | [Enforcement](HOW-IT-WORKS.md#5-enforcement), [Interactive vs autonomous](CONFIGURATION.md#interactive-vs-autonomous) |
| Answer an escalated request | User, in OpenCode's own approval controls | [When you need to decide](TUI.md#when-you-need-to-decide) |
| Run `git` and read local files for evidence | Server part | [Evidence enrichment](HOW-IT-WORKS.md#evidence-enrichment) |
| Create the isolated reviewer location | Server part | [Files the plugin writes](#files-the-plugin-writes) |
| Call a System One provider | Server part | [Network endpoints](#network-endpoints) |
| Append an audit record | Server part | [Audit log](CONFIGURATION.md#audit-log) |
| Publish review status | Server part (V2 RPC, V1 `/tui/publish`), read by the TUI part | [RPC protocol](#rpc-protocol), [Network endpoints](#network-endpoints) |

### From the command line

The six subcommands of `opencode-permission-reviewer`: `init`, `explain`, `doctor`,
`config print-effective`, `audit report` and `script command`. [CLI](#cli) describes each.

### In this repository (not shipped)

These run on GitHub and change nothing a user installs until a pull request merges and a release
is cut. [Development](DEVELOPMENT.md) covers CI and the release workflow. The scheduled workflows
are:

| Workflow | When (UTC) | What it does |
| --- | --- | --- |
| `codeql` | Mondays 04:16, and on every push to `main` or `develop` and every pull request | CodeQL `security-extended` analysis of the TypeScript |
| `host-advisory` | Mondays 08:19, or by hand | Reads the npm registry and warns when a newer OpenCode release is outside the verified matrix. It changes no support range. |
| `dependency-advisory` | Mondays 08:37, or by hand | Fails when the latest `@opentui/solid` declares a `solid-js` peer range that this package's `solid-js` pin does not satisfy |
| `openrouter-models` | Mondays 08:53, or by hand | Reads `https://openrouter.ai/api/v1/models`, rewrites the OpenRouter decision model list, and opens or updates a pull request against `develop` ([OpenRouter decision models](DEVELOPMENT.md#openrouter-decision-models)) |

GitHub runs a scheduled workflow only from the default branch. Dependabot also opens update pull
requests on its own schedule ([Dependency updates](DEVELOPMENT.md#dependency-updates)).

## External interfaces

### Package entry points

From `exports` and `bin` in `package.json`:

| Specifier | File | What it provides |
| --- | --- | --- |
| `.` and `./server` | `dist/index.js` | Default export `{ id, server, setup }`: `server` is the V1 plugin function and `setup` the V2 one. The named exports (configuration loader, decision parser and gates, brake reason, evidence helpers, audit writer, redaction, the UI status codec, and the types) are a library API for other tools. |
| `./tui` | `dist/tui/tui.tsx` | Raw TSX, compiled by the host. Default export `{ id, tui, setup }`: `tui` for V1, `setup` for V2. |
| `./rpc` | `dist/rpc.js` | `ReviewerRpc`, the [RPC protocol](#rpc-protocol) descriptor, as a named and a default export |
| `./cli` | `dist/explain.js` | `runCli(argv)`, which returns the exit code. Importing the module does not run the CLI. |
| `./package.json` | `package.json` | The manifest |
| `bin` `opencode-permission-reviewer` | `dist/explain.js` | The [CLI](#cli) |

The tarball also ships `server.js`, `rpc.js` and `tui.tsx` at its root. Each re-exports the
matching file under `dist/`, for hosts that resolve a plugin by file name.

### CLI

`opencode-permission-reviewer <subcommand> [options]`. With no subcommand, or with an option
first, it runs `explain`. An unknown subcommand, an unknown option or any error prints a message
on stderr and exits 2. `--project <dir>` defaults to the current directory. `explain`, `doctor`,
`config` and `audit` load the reviewer configuration for that directory, which can print config
warnings on stderr.

#### `init`

Registers the plugin in an OpenCode config file.

- Options: `--project <dir>`, `--global`, `--tui`, `--host auto|v1|v2` (default `auto`),
  `--binary <path>` (default `opencode`), `--npm`, `--dry-run`, `--print`, `--yes`, `--json`,
  `-h`/`--help`.
- Host: runs `<binary> --version` (2-second limit). With `--host auto`, it refuses and exits 2 when
  the binary is missing or its version is outside the supported ranges, and when the existing
  config file already uses the other generation's key (`plugin` for V1, `plugins` for V2).
- Target: the project's `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json` or
  `.opencode/opencode.jsonc`, whichever exists first; else the global `opencode.json` or
  `opencode.jsonc` in `$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`); else a new
  `<project>/opencode.json`. `--global` picks the global file. `--tui` adds `tui.json` (or
  `tui.jsonc`) next to that file on V1, and the global `cli.json` on V2.
- Entry: the package's absolute path, or `<name>@^<version>` with `--npm` or when the package runs
  from a `node_modules` directory. On V2 the entry is `{ "package": …, "options": {} }`.
- Output: the plan on stderr. `--print` prints only the entry JSON on stdout, `--json` prints the
  plan as JSON on stdout, and `--dry-run` prints the plan; none of the three writes anything.
  Otherwise it asks for confirmation on a terminal; without a terminal it needs `--yes`, or exits 2.
- Writes: see [Files the plugin writes](#files-the-plugin-writes). Exit 1 when the project
  directory does not exist or a write is refused.

#### `explain`

Runs one permission request through the command analyzer and the policy engine, without calling
a reviewer.

- Options: `--event <file>` (default: read stdin), `--project <dir>`, `--defaults` (built-in
  defaults instead of the config files), `-h`/`--help`.
- Input: a JSON object, either a V2 native request (`action` and a `resources` array of strings)
  or a V1-style request with a `permission` string (plus `metadata.command`, `patterns` and the
  other permission fields).
- Output: JSON on stdout with `permission`, `command`, `configuration` (`defaults` or
  `effective`), `model`, `capability` (the command analysis for `bash`, otherwise `null`) and
  `policyTrace`; a native request adds `resources`, `actionEvidenceComplete` and `nativeAction`.
  Exit 2 when the input is not JSON or has neither shape. It writes nothing.

#### `doctor`

Reports versions, configuration sources, the policy hash and whether the audit path is writable.

- Options: `--project <dir>`, `--binary <path>` (reports `<path> --version`; without it the
  binary version is `null`), `--endpoint <url>`, `--json`, `-h`/`--help`.
- `--endpoint` switches to connected mode: it calls the `status` method of the
  [RPC protocol](#rpc-protocol) on that server (5-second limit), authenticated as described under
  [Environment variables](#environment-variables). It needs `OPENCODE_PASSWORD` or
  `OPENCODE_SERVER_PASSWORD` and exits 2 without one.
- Output: a report with `mode` (`local-only` or `connected`), `host`, `version`, `config` (each
  config file's path, whether it exists and the first 16 hex digits of its SHA-256, then `model`,
  `enforcementMode`, `repositoryTrust`, the policy rule count, the effective policy hash, config
  warnings and degradations) and `audit` (path, writable, error). JSON with `--json`, text
  otherwise. Exit 0.
- Writes: the writability probe creates the audit directory and opens the audit file for
  appending with mode 0600, so it creates an empty audit file when there is none.

#### `config print-effective`

- Options: `--project <dir>`, `-h`/`--help`.
- Output: JSON on stdout with `command`, `directory`, `sources` (as in `doctor`), `config` (the
  whole resolved configuration) and `policy` (rule count and effective policy hash). The
  configuration has no credential fields and is printed unredacted, so free text such as `policy`
  appears as written.
- Exit 2 with a usage line when `print-effective` is missing or with `--help`. It writes nothing.

#### `audit report`

- Options: `--path <file>` (`~` is expanded; default: the configured audit path),
  `--project <dir>`, `--json`, `-h`/`--help`.
- Output: counts over the audit file: valid records and invalid lines, schema versions, host
  generations, application states, the time range, outcomes, risk levels, decision sources,
  permissions, hand-off triggers, resolutions, unknown actors and records missing required fields.
  JSON with `--json`, text otherwise.
- Limit: it reads at most the last 64 MiB of the file and says so when it did.
- Exit 1 when the file does not exist, 2 when `report` is missing. It writes nothing.

#### `script command`

Prints an SSH command that runs a local script on a remote host only if the remote copy matches
what was inspected ([Verified remote shell scripts](HOW-IT-WORKS.md#verified-remote-shell-scripts)).

- Options: `--file <path>` (letters, digits, `_`, `.`, `/` and `-` only), `--host <host>`
  (letters, digits, `_`, `.`, `@` and `-`, not starting with `-`), `--port <1-65535>`,
  `--shell bash|sh` (default `bash`).
- Checks: the file must be readable as evidence from the current directory, inside it or
  `/tmp/opencode` ([Approved roots](HOW-IT-WORKS.md#approved-roots)), text, at most 64 KiB, and
  free of anything the credential redactor would change.
- Output: one line on stdout:
  `cat -- <file> | ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 [-p <port>] <host> '<remote>'`.
  The remote part writes stdin to a `mktemp` file, compares its SHA-256 with the inspected file's,
  runs it with the chosen shell only on a match, and deletes it on exit.
- It does not run `ssh` itself. Exit 1 when the file cannot be fully inspected, 2 on bad options.

### Configuration files

| File | Read by | Trust |
| --- | --- | --- |
| `~/.config/opencode/permission-reviewer.jsonc` | Server, V1 TUI and CLI | Trusted global settings |
| `<project>/.opencode/permission-reviewer.jsonc` | Server and CLI | Untrusted: it can only tighten the trusted settings |
| Inline plugin options in OpenCode's config | Server and V1 TUI | Unknown provenance: they can only tighten security restrictions |
| OpenCode's `opencode.json`/`opencode.jsonc`, `tui.json`/`tui.jsonc`, `cli.json` | `init` | Read to plan the change, then written |

[Config layers and the trust boundary](CONFIGURATION.md#config-layers-and-the-trust-boundary)
defines what each layer may change. Each reviewer config file is opened without following
symlinks, must be a regular file, and is read up to 1 MiB. A file that is unreadable, too large
or malformed is ignored with a warning; an unusable trusted layer also counts as degraded
([Degraded config](CONFIGURATION.md#degraded-config)).

`XDG_CONFIG_HOME` is honored only by `init`, for OpenCode's config files. The reviewer's own
global file is always under `~/.config/opencode`, and the audit log and the V1 isolated directory
are under `~/.local/share/opencode`, whatever `XDG_CONFIG_HOME` or `XDG_DATA_HOME` say.

### Environment variables

The server part reads these from the OpenCode server's environment.

| Variable | Used for | Limits |
| --- | --- | --- |
| `OPENCODE_PERMISSION_REVIEWER_HOST_URL` | V2: review through this OpenCode server instead of the one running the plugin ([Reviewer sessions and host connection](CONFIGURATION.md#reviewer-sessions-and-host-connection)) | Must be `http` or `https` with no credentials in it, and `http` only for `localhost`, `127.0.0.1` or `[::1]`. The server must answer the RPC `identity` call with this plugin instance's identity, or the plugin refuses the connection. |
| `OPENCODE_PASSWORD`, else `OPENCODE_SERVER_PASSWORD` | Basic authentication (`opencode:<password>`) to that server, and for `doctor --endpoint` | Required in both cases |
| `OPENCODE_API_KEY`, `TYPESAFE_API_KEY`, `CMD_API_KEY`, `LIQUID_API_KEY`, `BASETEN_API_KEY`, `OPENROUTER_API_KEY` | The API key of the selected System One provider ([System One reviewers](REVIEWER-MODELS.md#system-one-reviewers)) | Read only for the provider of the configured model. The Liquid AI key must start with `liquid_` and the OpenRouter key with `sk-or-v1-`, or the request is not sent; the other keys are not shape-checked. |
| `TYPESAFE_BASE_URL` | Read by the TypeSafe SDK as the endpoint for the `typesafe-ai` provider only, the one provider the plugin gives no fixed URL | Default `https://api.typesafe.ai`. The plugin does not check this value, so whoever sets it decides where that provider's key and request go, over HTTP or HTTPS. |
| `XDG_CONFIG_HOME` | `init`'s OpenCode config directory | See [Configuration files](#configuration-files) |
| `HOME`, `TMPDIR` | Where `~` paths and the V2 isolated location land | |

`git` runs with the server's whole environment plus `GIT_OPTIONAL_LOCKS=0`,
`GIT_TERMINAL_PROMPT=0` and `GIT_CONFIG_NOSYSTEM=1`, and with fsmonitor and hooks turned off on
its command line.

### Files the plugin writes

| File | Written by | Details |
| --- | --- | --- |
| Audit log, default `~/.local/share/opencode/permission-reviewer-audit.jsonl` (`auditPath`, off with `audit: false`) | Server part | Created with its directory on the first record and appended one JSON line per review. Opened without following symlinks; it must be a regular file and is kept at mode 0600. A failed write is logged and the review goes on, so a record can be lost. |
| `~/.local/share/opencode/permission-reviewer-isolated/` with `reviewer-isolation.js` and `opencode.json` | V1 server part, OpenCode-model reviewer | Directory mode 0700, files 0600, replaced atomically; a symlink, a hard link or a special file in their place is refused. It persists between runs. If it cannot be set up, the review fails as a reviewer error, and no reviewer session opens outside it. |
| `$TMPDIR/opencode-reviewer-<random>/` with `index.js`, `package.json` and `opencode.json` | V2 server part, OpenCode-model reviewer | Created fresh with exclusive writes, mode 0600. The bootstrap removes every MCP server from that location. Removed when the process exits; a crash leaves it to the operating system. |
| OpenCode's config files and a backup `<file>.bak-<YYYYMMDD-HHMMSS>` | `init` | Without `--dry-run`, `--print` or `--json`. A new file is created exclusively. An existing one is backed up (mode 0600), then the entry is appended in place through a descriptor that does not follow symlinks. It never replaces an existing entry, and refuses a malformed file, a `plugin` key that is not an array, or a file that changed since the plan. |
| The audit file, empty | `doctor` | See [`doctor`](#doctor) |

Reviewer sessions themselves are stored by OpenCode; `retainReviewSessions` decides whether the
plugin removes them after the review ([Structured output, retention, and budget](CONFIGURATION.md#structured-output-retention-and-budget)).

### Network endpoints

The plugin's code names these endpoints and no others:

| Endpoint | When | What goes in and out |
| --- | --- | --- |
| The OpenCode V1 server the plugin runs in, through the SDK client the host passes it | Every review on V1 | The reply (`POST /permission/{requestID}/reply` with `once` or `reject` and an optional message), each review status as a `tui.command.execute` event on `/tui/publish`, and the reviewer session calls |
| The System One provider of the configured model: `https://opencode.ai/zen` (`opencode/…`), `TYPESAFE_BASE_URL` or `https://api.typesafe.ai` (`typesafe-ai/…`), `https://api.commandcode.ai/provider` (`commandcode/…`), `https://api.liquid.ai/decisions` (`liquid-ai/…`), `https://inference.baseten.co` (`baseten/…`), `https://openrouter.ai/api` (`openrouter/…`) | Each review with a System One model | A `POST /v1/systemone` through the TypeSafe SDK with the API key, the reviewer policy and the tenant `policy` (redacted), the rendered evidence (redacted as described in [Evidence](HOW-IT-WORKS.md#3-evidence)) and fixed questions; a decision comes back. Bounded by `timeoutMs`, retried at most twice on HTTP 503. |
| The OpenCode server named by `OPENCODE_PERMISSION_REVIEWER_HOST_URL` | V2, when the variable is set | The `identity` RPC call, then the reviewer sessions |
| The OpenCode server given to `doctor --endpoint` | That command | One `status` RPC call |

An OpenCode-model reviewer makes no request of its own: its model calls go through the host,
with the host's provider settings.

### RPC protocol

`./rpc` exports the descriptor of a read-only protocol. Only the V2 server registers it; the V2
TUI and `doctor --endpoint` call it, and so does the server itself to check a server named by
`OPENCODE_PERMISSION_REVIEWER_HOST_URL`. Every method takes an empty object, and no method or
event can approve, deny or change a review.

| Name | Kind | Returns |
| --- | --- | --- |
| `identity` | method | The server instance's identity string |
| `status` | method | `host`, `hostVersion`, `generation`, `directory`, `adapter`, `backend` (`system-one` or `v2-isolated-session`), `active`, `pending`, `revision`, `outputFormat`, `model`, `escalationReviewerModel`, `variant`, `configDegraded`, `configWarnings`, `effectiveConfigHash`, `connection`, `eventConnection` and `capabilities` |
| `snapshot` | method | `generation`, `revision`, `directory` and `reviews`, the statuses the server holds |
| `review.updated` | event | `generation`, `revision`, `directory` and one review `status` |

Review statuses are encoded by `src/modules/status/models/ui-protocol.ts`. The server keeps at
most 256 of them and drops the oldest finished one past that. Publishing an event is not awaited
past one second and a failed publication is ignored, so the TUI can miss an update until it
reconnects and reads a new snapshot.
