# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- After a patch upgrade of OpenCode V2, the reviewer keeps using the background service
  registered by the previous patch release instead of failing every review. A service from
  another minor release is still refused, and the error now names both versions and how to fix
  it.
- When the reviewer reaches a different OpenCode server than the one it runs in, for example
  the background service while you work in a separate `opencode serve`, the error now says
  which server it reached and which settings point it at the right one.
- Jev answers where a supporting judgement (risk, authorization, scope, evidence, or basis) is
  within 0.02 of the most probable option are no longer treated as invalid. The allow, deny,
  or escalate outcome itself must still be the most probable option.

## [3.1.0] - 2026-10-21

### Added

- `systemOneEscalation: "reasoning-first"`: with a Jev `model` and an `escalationReviewer`, every
  escalation that starts at Jev, including an invalid answer or a failed call, goes to the
  reasoning reviewer before it can reach you, unless less than 15 seconds of the review budget
  remain. The default, `"standard"`, keeps the existing routing.
- `systemOneDenialReview: true`: an uncertain Jev denial goes to the reasoning reviewer, which can
  confirm or overturn it. Denials with a strong policy or safety signal stay final.
- Under `systemOneEscalation: "reasoning-first"`, and for an uncertain denial under
  `systemOneDenialReview`, a reasoning approval after a Jev decision rated critical risk escalates
  instead of allowing.
- Audit records carry `reviewerEscalatedFrom.trigger`, a `resolution` on escalations from the
  System One backend, and `configWarnings`. `audit report` counts records by hand-off trigger and
  by resolution.
- TUI: when Jev hands a request to the reasoning reviewer, the progress strip
  and the V1 overlay switch to that reviewer and say why (for example
  `gpt-6-luna after Jev's escalation`). The elapsed time keeps counting from
  the start of the review.
- TUI: the result strip's second line names who decided ahead of the reason,
  for example `gpt-6-luna overturned Jev's denial — …`; a review Jev decided
  alone names Jev's model.
- TUI: reviewer config that cannot take effect, or a degraded config, raises
  one toast per entry per TUI session (warning or error) and keeps a line in
  the sidebar on both hosts. A healthy config shows no line. The V2 TUI reads
  the lists from the reviewer's `status` RPC.
- A TUI guide (`docs/TUI.md`) with every screen: progress and hand-offs, result strips,
  manual-review toasts, config warnings and long commands. The README shows the hand-off and result
  screens. The images are rendered from the plugin's components; `bun run docs:screens` regenerates
  them (`docs/DEVELOPMENT.md`, "TUI screens").
- A config warning when `model` is Jev, a valid `escalationReviewer` is configured and an explicit
  `reviewBudgetMs` leaves less than 15000 ms after `timeoutMs`: hand-offs to the reasoning reviewer
  would escalate to you instead. It applies in either routing mode, never degrades the config, and
  the default budget never triggers it.

### Changed

- The default `reviewBudgetMs` is now
  `timeoutMs + max(timeoutMs, escalationReviewer.timeoutMs) + 60000`. It is
  never shorter than before, and it grows when the escalation reviewer's
  timeout is longer than `timeoutMs`. An escalation reviewer without its own
  `timeoutMs` counts 120000.
- A hand-off to the reasoning reviewer now needs 15 seconds of review budget left; with less, the
  request escalates (`resolution: "budget-exhausted"`). This applies in the default mode too.
- When the hand-off runs, `escalationMode: "deny"`, `riskPolicy.onInvalidDecision`, and
  `riskPolicy.onReviewerFailure` act on the reasoning reviewer's final outcome, not on Jev's.
- TUI: a manual-review toast's first sentence now says how the review ended:
  the reasoning reviewer's review still needs your approval, the reasoning
  reviewer was unavailable (an error toast titled "Reasoning reviewer
  unavailable"), or no review time was left for it. The reason still follows.
- TUI: the progress strip and the V1 overlay name the reviewer by the last segment of its model
  ID (`jev-1.13.0`), like the rest of the TUI. On V2, the toast for a review with no time left for
  the hand-off now names the reasoning reviewer's model, as on V1; the V2 TUI reads it from the
  reviewer's `status` RPC (`escalationReviewerModel`).
- The TUI no longer hides the end of a long command. The progress strip, the result strip and the
  V1 overlay show the first command, a muted `⋯ N more ⋯` and as many of the last commands as fit,
  and a heredoc body the server can match shows as `⋯ N-line heredoc ⋯` instead of its contents. A
  command too wide for even that shows the start of its first command and the end of its last. The
  status's plain `action` (and the exported `permissionAction`) now keeps the start and end of a
  long action around one `⋯` instead of cutting the end.
- Development: TypeScript 7 replaces TypeScript 6, and tsdown replaces tsup
  for the build. tsup's declaration step needs the JavaScript compiler API,
  which TypeScript 7 no longer ships, while tsdown emits declarations with
  TypeScript 7's native compiler. The shipped files keep their names and
  stay unsplit, and Node built-in imports in the bundles now keep their
  `node:` prefix. The root `esbuild` override is gone, because nothing
  installs esbuild any more.

### Fixed

- V2: a block from a fail-closed escalation now shows "Review blocked
  (fail-closed)" instead of "Review blocked", as V1 already did.
- TUI: a status whose reason, decision rationale or script analysis is too long for the status
  message is no longer dropped. Config warning and degraded-config entries still go first; then the
  rationale, the script analysis and, last, the reason are shortened as needed, down to `…` alone
  when the overflow calls for it, so the status shows on both hosts.
- TUI: a command's shown text now renders control, directional, zero-width and non-ASCII space
  characters as hex escapes (`\xHH`, `\uHHHH`, `\u{H...}`), shows a line continuation as `\⏎` and a
  line break inside the shown text as a muted `⏎`, and shows a literal `⏎` or `⋯` typed in the
  command as `\u23ce` or `\u22ef`, so every marker you see comes from the display itself.
- Shell analysis: an input-duplication redirection (`<&`, `3<&0`, `0<&-`) now
  stays inside its token, `|&` and `;&` read as single separators, and a bare
  carriage return is part of a word, so command structure is read the way the
  shell runs it. In the TUI, a command with `|&`, `;&` or a carriage return
  still shows as one line.
- Shell analysis: a token's recorded source text now matches the command it
  was read from: inside double quotes, the character after a backslash is
  no longer recorded twice, and a lone line continuation no longer carries
  into the next token, so quoted and literal reads see the command as
  written.
- Shell analysis: a heredoc is read where the shell reads one: inside an open command substitution
  or backtick, and after a bare `((` that the shell re-reads as groups. A heredoc body opened inside
  backticks or a `$((` substitution ends at that construct's close, and a closing backtick ends
  every construct still open inside it, and a `$((` span is arithmetic only when the `)` matching
  its second `(` is followed by `)`. A `<<` inside a parameter expansion or a valid arithmetic
  expression stays text. A delimiter word keeps a carriage return as part of the word, and ends at a
  closing backtick. The emergency brake also checks the reading that collapses every heredoc
  operator, the reading the previous release used, and the command as written when a heredoc body
  never ends or a heredoc sits inside a substitution or backticks. In that last case each line is
  also checked on its own, with a backslash continuation joined to the line after it.
- Shell analysis: a command string the shell runs (`bash -c`, `sh -c`, `watch`, `ssh`, `find -exec
  sh -c`, and the wrappers around them) gets the same brake readings as the top-level command. A
  heredoc written before the command no longer hides the command: its placeholder is not a command
  word.
- Shell analysis: a `$'…'` string ends where the shell ends it, so a backslash-escaped quote inside it no longer ends it early and the text after it is read as the shell reads it.
- Shell analysis: a `$'…'` word is read with its escapes decoded and a `$"…"` word as a
  double-quoted string, the way the shell reads them, so a command or argument written that way
  is judged like its plain spelling. Text an escape produces, such as `$` or `*`, is read as
  quoted text.
- Shell analysis: a `|` or `&` right after an empty quoted redirection target such as `>''` is
  read as its own operator, and a word after an empty here-string such as `<<<''` stays a separate
  word.
- Shell analysis: a command substitution in double quotes, or in backticks anywhere, is read as part
  of its word up to where the shell ends it, so quotes, separators and redirection operators inside
  it no longer change how the rest of the command is read.
- Shell analysis: a parameter expansion inside double quotes, such as `"${name:-default}"`, is read
  as part of its word up to where the shell ends it, including any quotes inside it.
- Shell analysis: when a heredoc's delimiter is unquoted, the commands its body's substitutions run
  are checked like any other command.
- Shell analysis: a heredoc or here-string that a shell reads as its script, such as `sh <<'EOF'`
  or `cat <<EOF | bash`, is checked line by line like any other command.
- Shell analysis: ssh, mosh and autossh arguments are read as those programs read them, including
  every ssh option that takes a value, `--`, `ssh://` destinations and the login user.
- Shell analysis: wrapper and remote facts such as privilege escalation now also come from
  commands inside command strings, `env -S`, `watch` and ssh remote commands, and from commands
  after a leading redirection.
- Shell analysis: `env -S` strings, env's value options and abbreviated long options are read
  as GNU env reads them, and input redirections on any command count toward credential reads.

## [3.0.0] - 2026-10-12

### Changed

- Development: Biome replaces ESLint and Prettier for linting and formatting.
  FTA, knip, gitleaks, the pre-commit hooks and the Python tooling now run
  locally and in CI. The limits are cognitive complexity 12 (tests 14), 600
  lines per file (tests 800) and an FTA cap of 55 (tests not measured); see
  `docs/DEVELOPMENT.md`.
- Changes made in this fork are now licensed under the MIT License. Code from
  the upstream project remains under the Apache License 2.0, which now ships as
  `LICENSE-APACHE` alongside `NOTICE`. The package `license` field is
  `MIT AND Apache-2.0`.
- The real-host compatibility matrix now pins OpenCode 1.18.35 and 2.0.26 as
  the verified V1 and V2 references. 2.0.20 moves to the optional V2 window.
  Hosts from 2.0.22 expose `session.remove` to plugins; the reviewer does not
  use it, and the contract test accepts either shape.
- `NOTICE` now says the reviewer policy is adapted from OpenAI Codex Guardian,
  matching the attribution in `src/policy.ts`, and links the Codex commit it
  was adapted from.
- Split the README into a short overview and reference pages under `docs/`
  (configuration, reviewer models, how it works, safety, supply chain,
  compatibility, development).

### Removed

- **Breaking:** The `./tui` entry no longer re-exports `DEFAULT_CONFIG`,
  `decodeUiStatus` and `ReviewUiState`; it exports only the TUI plugin.
  Import `decodeUiStatus` and `ReviewUiState` from the main entry, and use
  `resolveConfig({})` for the default configuration. This needs the next
  major version.

### Security

- The emergency brake recognises more forms of unmistakably destructive
  commands, and the capability analyzer classifies more wrapped commands.
  Tracked privately per SECURITY.md.
- The command analysis that feeds the reviewer and the emergency brake reads
  more command shapes correctly, and script evidence that follows package
  scripts stays inside the session's approved roots. Host events,
  configuration lookups and audit tallies are handled more strictly. Tracked
  privately per SECURITY.md.

## [2.4.2] - 2026-10-09

### Added

- Record Jev's own scores in an additive `systemOne` audit field whenever it
  returns a valid decision, on V1 and V2 hosts, including after a hand-off to
  the reasoning reviewer, which previously kept only the System One model and
  reason. The README's audit section lists the fields and when the field is
  absent. Outcomes and routing are unchanged. Audit `schemaVersion` stays 3.

### Changed

- Update the `@opencode/client` dependency to 2.0.26, from upstream.

### Fixed

- Audit records credit the reasoning reviewer, not Jev, when a configuration
  or evidence gate downgrades its allow, and when it fails after a hand-off
  (the failure reason now names the reasoning reviewer).

## [2.4.1] - 2026-10-09

### Changed

- Publish this fork to npm as `@noppu-labs/opencode-permission-reviewer`. The
  CLI command stays `opencode-permission-reviewer`.

## [2.4.1-noppu] - 2026-10-09

### Fixed

- Keep MCP servers that other plugins add from code, such as
  `@upstash/context7-opencode`, out of the OpenCode V2 reviewer Location. They
  previously made every review fail closed.

## [2.4.0] - 2026-10-02

### Added

- Git remote evidence for network subcommands: `git push`, `fetch`, `pull`,
  `ls-remote`, and `git remote` now report each remote operand as a configured
  remote (with the push/fetch URLs it resolves to, credential userinfo
  redacted), a literal URL, or unmatched, plus the default remote an
  operand-less command would contact. The reviewer judges the destination
  from this evidence instead of treating an unresolved alias as unknown.

- Recognize `deno` and `tsx` as local script interpreters, attaching the
  executed file as evidence for direct invocations (`deno <file>`,
  `tsx <file>`), `deno run/serve/watch`, and `tsx watch` file targets. Deno
  tasks, package specifiers (`jsr:`/`npm:`/URLs), manifest scripts, and
  ambiguous option forms gather no evidence rather than risk attaching the
  wrong file. Node-family value flags (`--test-reporter-destination` and
  siblings) are skipped for `node` and `tsx` for the same reason.
- Inspect manifest definitions and bounded local script chains for Bun, npm,
  pnpm, and Yarn script invocations. Referenced local code and conditional
  lifecycle hooks are included as evidence without executing package code or
  assuming the invocation needs network access.

### Changed

- Verify compatibility with OpenCode V1 1.18.34 and V2 2.0.21.
- No lifecycle scripts ship with the package: the `prepare` build hook is
  gone, so installs execute nothing from this repository. The npm registry is
  the supported install source (Git/local installs yield a package without
  `dist/`); build from source explicitly with `bun install && bun run build`.

### Fixed

- Attach local script evidence only for the executed interpreter, preserve
  leading-dash file names after `--`, and inspect equally named scripts in
  different working directories separately. Remote commands and interpreter
  mentions no longer attach unrelated local code.
- Resolve Git repository evidence only for a local Git executable; remote
  commands and command mentions no longer inherit the local repository's state
  or configured destinations.
- Prevent OpenCode V1's isolated reviewer location from starting another copy
  of globally configured MCP servers. Its local bootstrap excludes MCP, and
  reviews fail closed if the host reports servers or an invalid inventory.
  Isolation files are replaced atomically and reject links and special files.
  Thanks @jg33 for the fix ([#62](https://github.com/warc0s/opencode-permission-reviewer/pull/62)).
- Preserve reviewer cancellation and timeout errors across garbage collection,
  including waits admitted after a review has already ended.
- Normalize shell redirections before resolving executables, including glued,
  leading, file-descriptor, clobber, and command-string forms. Redirections can
  no longer hide root destruction, credential reads, network clients, or
  external write targets; heredoc payload text is no longer treated as an
  executed command.
- Classify `git add`, remote/config/ref mutations, fetch/pull, `dd of=...`,
  attached `sort -o...`, and writes inside worktrees under temporary roots with
  their actual mutation, network, and path effects.
- Treat V1 inline plugin options as unknown-origin input, matching V2, and keep
  reviewer selection, policy, resource limits, and debug logging under trusted
  global configuration.
- Redact URL userinfo even when a credential occupies only the username slot,
  and block GitHub config and token-shaped content from file enrichment.
- Refuse symlinked config files in `init`; planning, backups, and updates now
  hold a no-follow regular-file descriptor through their operation. Config
  parsing and change detection use the same file snapshot.
- Recognize shell `-c` flag clusters, options after `-c`, `exec`, clustered SSH
  flags, and value-taking wrapper options so they cannot hide destructive
  commands from the emergency brake. Direct `cp` and `install` overwrites of
  block devices are also rejected.
- Preserve file mutation effects for target-directory options, optional
  option values, rename operands, implicit link destinations, and rsync
  source removal.
- Keep relative `cd` targets unresolved when the preceding working directory
  is ambiguous, instead of throwing or assuming the initial directory.
- Resolve attached and trailing Git push `--repo` overrides, and redact URL
  passwords before bounding evidence, including unavailable Git snapshots.
- Withhold Git snapshots when a successful status process returns incomplete
  output, preserving the planned action without inventing repository state.
- Include the executed file as local script evidence for `bun run <file>`
  commands; package manifest scripts (`bun run check`) and bun option values
  are not mistaken for the run target.
- Emergency brake: peel `systemd-run`, `strace`, `ltrace`, and `script -c`
  wrappers (including clustered value-taking options such as `sudo -nu root`
  and `env -iS`), treat a live root glob (`rm -rf /*`) as root destruction,
  and reject shell redirections onto real block devices (`> /dev/sda`,
  glued `2>/dev/sda`, `tee /dev/sda`) in direct and command-string forms.
- Audit records always land in a mode `0600` file: a pre-existing audit path
  with looser permissions is tightened before receiving new records instead of
  being extended as-is.
- Recover literal user intent after long operational histories, compaction,
  and host restarts, while keeping synthetic control messages and inherited
  fork messages out of direct authorization evidence.

## [2.3.1] - 2026-09-28

### Fixed

- Prevent OpenCode V2 permission reviews from starting additional configured
  MCP processes for each review. Reviews now share an isolated Location without
  MCP servers while keeping their sessions independent.
- Retry reviewer Location setup after a transient failure and clean up reviewer
  hooks registered after a Location reload.

## [2.3.0] - 2026-09-24

### Added

- Add Jev as a reviewer model choice through OpenCode Zen, TypeSafe AI, or the
  Command Code Provider API. Use Jev alone, or configure a second LLM such as
  Luna for difficult decisions. See the [Jev setup
  guide](./docs/REVIEWER-MODELS.md#jev-system-one-reviewer).

### Changed

- Default to GPT-6 Luna at medium effort and share trusted V1 reviewer settings
  between the server and TUI.
- Verify compatibility with OpenCode V2 2.0.15.

## [2.2.1] - 2026-09-22

### Changed

- Verify compatibility with OpenCode V1 1.18.32 and V2 2.0.14, update the
  matching SDK and client packages, update Zod, and refresh the documented
  support matrix.

## [2.2.0] - 2026-09-20

### Changed

- Add a compatibility layer for every stable OpenCode V2 release from 2.0.3
  through 2.0.11. Service connection no longer depends on changing discovery
  endpoints, and the supported host range now covers `>=2.0.3 <3`. Bumped
  `@opencode/client` to 2.0.11; newer V2 releases remain best-effort until
  exercised by the compatibility suite.
- Negotiate the V2 session wait route by response, use a unique ID for each
  isolated reviewer plugin, dispose host registrations on unload, and load TUI
  snapshots without waiting for an unrelated host event.

### Added

- Add a deterministic `credentialRead` capability signal: known file readers
  (`cat`, `head`, `tail`, `less`, `more`, `grep`, `rg`, `sed`, `awk`,
  `base64`, `xxd`, `od`, `strings`, `source`, `.`) with a literal credential
  path operand, or any command with a literal credential path as an input
  (`<`) redirect target, report `credentialRead: true` (otherwise
  `"unknown"`, never `false`). Example and public-key suffixes (`.example`,
  `.sample`, `.template`, `.dist`, `.pub`) never match.
- Add a `credentialRead` policy condition key (positive-only, AND-composable
  with `networkObserved` and the other keys). No built-in rule uses it; the
  default rule set is unchanged.
- Record a flattened `credentialRead: true` field in the audit capability
  snapshot (present only when true). Audit `schemaVersion` stays 3.

Note: configs using `credentialRead` degrade fail-closed on older plugin
versions that reject unknown condition keys (the rule is dropped and trusted
configs block automatic approval until fixed).

### Fixed

- Failure-safe denial reasons now include the failure phase and the underlying
  error cause instead of a bare SDK reason word.

## [2.1.0] - 2026-09-17

### Added

- Inspect verified remote SSH scripts from bounded local evidence, with a
  SHA-256 check of the staged script before remote execution.
- Add `script command` to generate the guarded SSH invocation from a local file.
- Add the repository-only PRB-600 synthetic reviewer benchmark and publish
  results for nine complete model evaluations.
- Test V2 host connection rejection for unsafe URLs, missing authentication,
  and instance identity mismatch.

### Changed

- Clarify V1 and V2 configuration paths and document the limits of automatic
  approval and failure handling.

## [2.0.0] - 2026-09-16

### Added

- Separate OpenCode V1 and V2 server adapters with a shared evaluation engine.
- Isolated V2 reviewer sessions, validated structured output, authenticated
  cleanup, total review deadlines, and generation-aware status RPC.
- Dual raw TSX interface, host-aware installation, and separate pytest host harnesses.
- Compact V2 review progress strip with model, action, and elapsed time.

### Changed

- Require OpenCode V1 1.18.29 or newer, or the pinned V2 2.0.3 release.
- Preserve JSONC comments during installation and distinguish planned writes.
- Record independent review identity and application state for both hosts with audit schema 3.
- Verify compatibility with OpenCode V1 1.18.31 and reject missing TUI runtime
  dependencies during the build.

### Fixed

- Preserve valid denials below the automatic approval confidence threshold.
- Show unknown UI status after a watchdog timeout instead of inventing a manual request.
- Preserve reply acknowledgement ordering and bounded failure handling during shutdown or overload.
- Reject misspelled trusted policy condition values without allowing an unsafe
  fallback, and align UI review deadlines with the server budget.

## [1.3.3] - 2026-09-13

### Changed

- Bumped `@opencode-ai/plugin` to 1.18.30 and `@opentui/core`/`@opentui/solid`
  to 0.5.11, with `bun.lock` synchronized (dependency bumps only; no behavior
  change). `solid-js` stays pinned at 1.9.12, matching the exact peer
  requirement of `@opentui/solid`.

### Fixed

- The audit report reader no longer drops a complete line at the start of its
  bounded tail window: when the file exceeds the 64 MiB read cap, the reader
  peeks at the byte before the window and only strips the first line when it
  may be partial (no preceding newline). A window that starts at a line
  boundary now summarizes every line it read.
- A failed audit directory creation degrades the same way an append failure
  does: the record is lost, the failure is logged, and the writer never
  throws. Previously the mkdir rejection propagated to the caller and stuck
  to the cached promise; the writer now logs, drops the record, and retries
  the mkdir on the next record.

## [1.3.2] - 2026-09-12

### Added

- The TUI overlay now covers pending reviews: an in-flight review renders in
  the overlay panel while it runs, with resolved results kept below, so the
  user sees what is being decided instead of only learning the outcome.
- A live host-regression harness exercises provider tools and end-to-end
  review decisions against a real server, guarding the reviewer transport and
  the deterministic brake paths outside unit tests.

### Changed

- Bumped `@opencode-ai/plugin` to 1.18.28 and `@opentui/core`/`@opentui/solid`
  to 0.5.10, with `bun.lock` synchronized (dependency bumps only; no behavior
  change).
- The exact pending action now leads the reviewer evidence and reserves the
  head of the context budget, with actor, lineage, and intent sections
  following it — previously the action could be truncated away while context
  survived. Session lineage additionally records its origin (human root vs
  delegated), and whether the action evidence survived truncation is tracked
  explicitly so the reviewer judges a complete view of the action or the
  decision escalates.

### Fixed

- The redaction rule for auth-scheme tokens (`Bearer`/`Basic`/`Token`)
  treated the `-` in its character class as a range, so tokens containing
  dashes were never matched as a whole and could reach the reviewer
  unredacted; the dash is now a literal member of the class.
- Reviewer sessions now run in a scratch directory outside the project, so
  repository instructions (`AGENTS.md`, project config instructions, project
  MCP context) never enter the reviewer's system prompt; every tool is denied
  by a wildcard session permission rule that also covers MCP tools. If the
  isolated directory cannot be established, the review escalates to the human
  as a reviewer failure instead of running inside the project with degraded
  isolation.
- Automatic approval is now blocked while the trusted configuration is
  degraded or a material part of the pending action was elided from the
  evidence: invalid policy rules in trusted (global/inline) layers are
  rejected at load and keep auto-approval disabled until fixed, instead of a
  narrowed config silently permitting more.
- The shared per-directory git conversion-filter scan now parses
  NUL-delimited (`-z`) output, so a legal filter subsection containing a
  space (e.g. `[filter "a b"]`) is neutralized like any other instead of
  being mis-parsed and silently left active. A name containing `=` cannot be
  expressed through `-c` overrides, so it withholds the snapshot (fail
  closed) rather than arming the wrong key — same as the existing over-limit
  refusals.
- The deterministic emergency brake now peels `timeout`, `xargs`, and `watch`
  wrappers before judging the executable, so `timeout 5 curl …`, `watch -n 5
curl …`, and piped `xargs curl …` trip the secret-export brake and
  `timeout --signal=KILL 10s rm -rf /` trips root destruction. `timeout`
  skips its mandatory duration operand explicitly; benign commands under
  these wrappers (`watch ls`, `timeout 5 make`) stay quiet.
- Project config can no longer weaken trusted layers: null and wrong-type
  overrides are dropped instead of resetting defaults, the reviewer model
  and policy text are not project-settable, and malformed config files warn
  instead of silently degrading. User intent is attributed by session origin,
  so no child-session message counts as human authorization.
- Filesystem reads and writes in the decision path go through explicitly
  opened, verified descriptors: config layers are rejected when symlinked,
  non-regular, or oversized (a committed link to a FIFO or an endless source
  can no longer hang or exhaust startup); audit records are appended through
  a descriptor that refuses symlinked and non-regular targets and applies
  `0600` on creation; evidence file reads loop to completion so a short read
  is reported as truncated instead of partially included; and the audit
  report reader takes its size and bytes from the open descriptor instead of
  a racy stat-then-open pair.
- `opencode-permission-reviewer init` re-verifies each planned write against
  the current file before touching it: a file that drifted since planning
  (created, deleted, or turned malformed) aborts with a refusal instead of
  being merged or clobbered, new files are created exclusively, and backups
  claim their destination atomically instead of overwriting a collision.

## [1.3.1] - 2026-09-03

### Fixed

- The elapsed-time counter in the TUI review panel froze at its mount value:
  the elapsed text read no signal while evaluating, so the renderer evaluated
  it once and never again (the spinner kept animating, masking it). The text
  now reads the 250ms tick signal and advances for the lifetime of the panel,
  and negative clock skew is clamped. Regression-guarded by a headless render
  test that compiles the TUI with the same solid transform the host uses.

## [1.3.0] - 2026-09-01

### Added

- The reviewer now sees what the user answered in agent ask dialogs as scoped
  authorization evidence (`USER_ASK_DECISIONS` prompt section plus an additive
  `askDecisions` audit field; only the question and the selected option are
  captured). Configure with `askDecisions` (default `true`).

### Fixed

- The TUI overlay never rendered for npm-installed plugins: the app-slot
  factory rendered once at boot and never re-rendered, because it read no
  signal directly in its own scope. The factory now renders from direct signal
  reads, and `solid-js` is pinned to `@opentui/solid`'s exact peer so npm
  installs keep a single Solid runtime. Regression-guarded by headless slot
  contract tests and tarball-install checks.

## [1.2.4] - 2026-09-01

### Changed

- Bumped `@opencode-ai/plugin` to 1.18.25 and `@opentui/core`/`@opentui/solid`
  to 0.5.9, with `bun.lock` synchronized (dependency bumps only; no behavior
  change).

## [1.2.3] - 2026-08-25

### Changed

- Bumped `@opencode-ai/plugin` to 1.18.21, `@opentui/core`/`@opentui/solid`
  to 0.5.6, and `solid-js` to 1.9.15, with `bun.lock` synchronized
  (dependency bumps only; no behavior change). The OpenTUI updates pull in
  renderer fixes (stale mouse input, GNU Screen OSC 52 passthrough, Sixel
  fallback on Kitty).
- The live smoke harness now uses `opencode/mimo-v2.5-free` as its driver
  model after `opencode/deepseek-v4-flash-free` was retired from the gateway.

## [1.2.2] - 2026-08-20

### Fixed

- Text-mode reviews now re-prompt the reviewer once when the first response is
  missing, invalid, or unparseable, mirroring the auto-retry that `json_schema`
  mode already gets from OpenCode's `retryCount`. This absorbs the occasional
  flaky response from weaker models (e.g. `opencode-go/deepseek-v4-flash`) that
  previously escalated straight to "Manual review required". The retry is
  parsed with the same strict, fail-closed extractor, so it can never approve
  anything the first parse would not; a response that is still invalid after
  the retry escalates as before.
- Text-mode prompt now explicitly tells the reviewer not to echo the schema as
  an example (a schema copy plus a decision object in one response is
  ambiguous and escalates).

## [1.2.1] - 2026-08-18

### Changed

- Bumped `@opencode-ai/plugin` to 1.18.18 and `@opentui/core`/`@opentui/solid`
  to 0.5.3, with `bun.lock` synchronized (dependency bumps only; no behavior
  change).

## [1.2.0] - 2026-08-18

### Added

- New `outputFormat` config option (`json_schema` | `text`, default
  `json_schema`). `text` lets reviewer models that do not support OpenCode's
  `json_schema` structured-output format (e.g. `opencode-go/deepseek-v4-flash`)
  be used: the model emits its decision as plain JSON, which the plugin parses
  locally through the same strict `parseDecision` validation and
  `enforceDecision` invariants. Text-mode parsing is fail-closed: the response
  must be exactly one JSON object (optionally in a single code fence); any
  ambiguity escalates to a human. Text mode is safe but produces more
  escalations than structured output.

## [1.1.1] - 2026-08-08

### Fixed

- Fail-closed escalate→deny no longer invents a synthetic `ReviewDecision`
  (`risk_level: high`, `confidence: 1`) or a `reviewerOutcome` when no valid
  structured decision existed (timeout, invalid output, policy-manual, etc.).
  Real LLM `escalate` decisions keep `decision.outcome: "escalate"` under
  fail-closed deny.
- `ACTION_PURPOSE` now recovers prose from the exact assistant message that
  issued the tool call (`request.tool.messageID` / `callID`) before falling
  back to intent-derived evidence.
- Plugin no longer registers a no-op `tool.execute.after` hook; deprecated
  `annotateToolResult` remains exported for API compatibility.

## [1.1.0] - 2026-08-08

Non-interactive fail-closed mode and asymmetric agent feedback, without changing
the default interactive behavior.

### Added

- `escalationMode: "manual" | "deny"` (default `manual`). In `deny` mode every
  final internal escalation is converted to a reject with the original reason,
  so autonomous agents can run without human prompts while remaining fail-closed.
- Wired `riskPolicy.onInvalidDecision` and `riskPolicy.onReviewerFailure` so
  they harden invalid structured output and reviewer transport/timeout failures
  respectively (under `escalationMode: "manual"`). `escalationMode: "deny"`
  hardens every escalate path globally. Restrictive settings only block more.
- Central escalation disposition boundary (`applyEscalationDisposition`) applied
  after reviewer/policy/fail-safe produce `allow | deny | escalate`.
  `manual-superseded` is never converted.
- `ACTION_PURPOSE` evidence section in the reviewer prompt (agent-context →
  intent-derived → unavailable). Never invented; does not prove authorization.
- Additive audit/UI fields `reviewerOutcome` and `escalationDisposition` so
  reports and the TUI can distinguish an explicit deny from fail-closed
  escalate→deny (`schemaVersion` stays `2`).
- Trust-boundary clamps for `escalationMode` and risk-policy failure knobs
  (project config can only harden, never relax a trusted deny).

### Changed

- Approvals no longer annotate tool results. Allow is silent to the primary
  agent; deny still returns actionable feedback. `annotateToolResult` remains
  as a deprecated no-op for 1.x API compatibility.
- Reviewer system prompt version bumped to `2.1.0` (ACTION_PURPOSE guidance).
  Structured decision schema stays at version `2`.

### Fixed

- Partial project `riskPolicy` objects no longer wipe trusted
  `onInvalidDecision` / `onReviewerFailure` values back to defaults.

## [1.0.0] - 2026-08-07

The first stable release. The public configuration schema, the audit schema
(v2), and the OpenCode 1.x adapter contract are frozen for the 1.x line.

### Added

- Reference documentation: migration guide, threat model, policy reference,
  capability model, actor resolution, compatibility policy, and architecture
  decision records (`docs/`).
- Community health files: code of conduct, issue templates (bug report with
  adapter-diagnostics requirement, feature request with a safety checklist),
  pull-request template, and code owners.
- Release pipeline: tag-driven workflow that builds, publishes to npm with
  build provenance, generates SHA-256 checksums and a CycloneDX SBOM, and
  creates a GitHub Release with all artifacts attached (`.github/workflows/release.yml`).
- Security automation: CodeQL scan and Dependabot configuration.
- Coverage gate: `bun run test:coverage` enforces ≥ 90% global line coverage
  and 100% on safety-critical modules (decision, policy, emergency brake,
  event normalization, reply transport, redaction).

### Fixed

- TUI overlay renders again: the `./tui` export points at raw
  `dist/tui/tui.tsx` (copied by `scripts/copy-tui.ts`) instead of a prebundled
  JS file, so the OpenCode host compiles it with its own Solid/OpenTUI
  pipeline. The shipped TUI graph no longer pulls the server engine into the
  TUI process.
- Overlay selection no longer hides later reviews behind a stale manual toast:
  manual entries are excluded from the panel slot, in-flight reviews win over
  terminal results, and the start grace before "manual" is 15s (was 3s).
- UI status publishing treats the typed SDK `{ data, error }` resolve shape as
  a failure when `error` is set, and the declarative manual policy route emits
  a UI status. A failed `mode.push` no longer leaves the overlay half-registered.

### Changed

- Dropped the unused `@opentui/keymap` dependency.

## [0.9.0] - 2026-08-07

### Added

- Layered configuration: merges builtin defaults, global
  (`~/.config/opencode/permission-reviewer.jsonc`), project
  (`.opencode/permission-reviewer.jsonc`), and inline plugin options, with JSONC
  parsing support.
- Reviewer decision schema v2: `version: 2` is now required, and decisions must
  declare `scope_alignment` and `evidence_completeness`. In enforce mode, new
  deterministic gates escalate allows with misaligned scope or insufficient
  evidence. A model output that omits `version: 2` is rejected and routed to
  manual review, so a model that does not follow the v2 schema never produces an
  automatic decision.
- Audit schema v2: every record now carries `schemaVersion: 2`, `decisionSource`,
  an `actionHash` for cross-record correlation, per-phase timings, the reviewer
  model, evidence completeness, scope alignment, and actor
  `identitySource`/`confidence`. Capability and policy-trace objects remain
  additive, so v1 readers keep working.
- Isolated reply transport: permission replies flow through a dedicated module
  with a documented priority chain (public SDK reply with message, then public
  reply plus a feedback channel, then the authenticated raw transport, then
  refuse startup). Host capabilities are probed once at startup.
- Version gate: refuses to start against OpenCode v2-generation clients until
  their reply contract is verified.
- CLI subcommands via the `opencode-permission-reviewer` binary (no subcommand
  still runs `explain` for backward compatibility):
  - `doctor` — package/runtime versions, config sources with hashes, resolved
    model, policy mode and rule count, effective policy hash, audit-path
    writability.
  - `config print-effective` — resolved config and engine-equivalent policy hash.
  - `audit report` — summarizes the JSONL audit trail and flags unknown actors
    and records missing required fields.
- Public npm package: drops the private flag, points `main`/`types`/`exports` at
  the built `dist/` bundle, generates d.ts, rebuilds on install, and ships only
  `dist` plus docs (verified by a pack smoke test).
- TUI status publishing migrated to the typed v1 `client.tui.publish` API.
- Reviewer prompt v2.0.0 with new `EFFECTIVE_POLICY_SUMMARY`,
  `LOCAL_SESSION_CONTEXT`, and `REPOSITORY_CONTEXT` sections.

### Security

- Trust boundary: project config can no longer redirect or silence the audit
  trail (`auditPath`) or grant its own agent a higher-privilege profile
  (`actorProfiles`) — both are restricted to global/inline config.
- Project config can no longer downgrade a global `enforcementMode: "enforce"`
  to `observe`.
- Project policy rules are now combined with trusted (global/inline) rules
  instead of replacing them, so a repository can no longer erase a user's deny
  or manual rules by declaring an empty or narrower set.

### Changed

- Model decisions missing `version: 2` are rejected instead of defaulting
  missing v2 fields to unknown.

### Fixed

- Bare backtick command substitution (e.g. `echo \`whoami\``) is now correctly
  detected as dynamic instead of being treated as complete.
- Single-quoted literal strings (e.g. `echo 'literal $VAR'`) are no longer
  misdetected as dynamic.
- Malformed policy rule conditions no longer crash the engine — the rule is
  dropped defensively.
- JSONC trailing-comma stripping is now string-aware; `,}` or `,]` inside a
  string value is no longer corrupted.
- `audit report` expands `~` in `--path`, and `actionHash` excludes
  per-invocation tool IDs so identical commands correlate across runs.
- Importing the CLI module no longer runs the dispatcher, and the audit
  writability probe creates files with mode `0600`.

## [0.8.0] - 2026-08-06

### Added

- Static capability analysis for bash commands: structured facts for code
  execution, write effects, network, process side-effects, remote/git mutation,
  and privilege escalation, with heredoc bodies extracted before lexing and an
  honest completeness marker (complete / partial / opaque).
- Capability assessment threaded into the reviewer prompt as a new
  `CAPABILITY_ASSESSMENT` section and into the audit record as an additive
  capability snapshot.
- Declarative policy engine: evaluates capability and actor facts against
  declarative rules with most-restrictive resolution. Default rules ship empty,
  so observe mode produces zero behavior change.
- Enforce mode: manual/deny policy routes skip the LLM entirely; the emergency
  brake always runs first and is never weakened.
- `explain` CLI: dry-runs a bash command through the capability analyzer and
  policy engine without a running opencode, reading a permission request from a
  JSON fixture or stdin and printing the capability assessment and policy trace
  as JSON.
- Configurable risk × authorization matrix via `RiskPolicy` with conservative
  defaults that reproduce the previous behavior exactly, plus a
  `RepositoryTrust` type.
- Policy traces (effective policy hash, matched rules, final route, mode) in the
  audit record, with a counterfactual trace in observe mode.

## [0.7.0] - 2026-08-06

### Added

- Agent-aware context: the requesting tool's `agent`/`mode` is resolved from the
  session, walking parent sessions via the SDK with cycle/depth guards, and
  degrading honestly to "unknown" on any failure — a review always proceeds.
- Reviewer prompt sections `ACTOR_CONTEXT`, `SESSION_LINEAGE`,
  `DIRECT_USER_INTENT`, `DELEGATED_TASK`, and `EVIDENCE_COMPLETENESS` before
  `PENDING_PERMISSION`.
- Audit records gain an additive actor snapshot (identity completeness) and
  `rootSessionID`; the TUI shows the actor name.
- New config knobs: `enforcementMode` (default `observe`), `maxSessionDepth`,
  `maxParentSessions`, and `actorProfiles`.

### Changed

- Observe-only release: the decision schema and enforcement gates are
  untouched, so reviewer decisions do not change.

## [0.6.0] - 2026-08-06

### Changed

- Internal architecture boundary: the approval pipeline is extracted into a
  dedicated adapter, review coordinator, and evidence providers with
  byte-identical behavior — no user-facing behavior change versus 0.5.2.
- Audit records now carry an additive `schemaVersion: 1` (readers default
  missing values to 1).
- Tooling: ESLint 9, tsup ESM build, and Prettier are added; `bun run check`
  now runs format, lint, typecheck, tests, and build as a single gate.
