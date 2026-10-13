# How it works

This page describes what the reviewer shows in the TUI, the six steps every `ask` permission goes
through, and the read-only evidence the plugin collects for SSH, local scripts, package scripts,
and Git. The guarantees these steps add up to are listed in [Safety](SAFETY.md).

## What you'll see

```text
✓ Review approved · bash · rm -rf /tmp/scratch-cache
gpt-6-luna — Narrowly scoped temp cleanup; matches user intent.
```

While a review is running on V2, the optional TUI shows a compact two-line status strip at the
bottom, in the same place as the result strip. It has an animated indicator, the text "Reviewing
this permission", the reviewer model and reasoning variant, the elapsed time, and the action. A
command too long for the terminal is shortened in the middle, not at the end: the strip keeps the
first command and as many of the last ones as fit, with a muted `⋯ 3 more ⋯` for the commands in
between, and a heredoc body the server can match shows as its line count instead of its contents.
When even the first and last commands do not fit, it shows the start of the first command and the
end of the last around a muted `⋯`, which counts the commands in between when there is room. A cut
falls between words unless that would leave a side less than half used, as with a long URL. A
command that fits is shown as sent, except that a matched heredoc body still shows as its line
count. V1 keeps its larger overlay, which covers the native approval controls, includes the text
"No action needed", and wraps the action over at most three rows, shortened the same way.

```text
bash · $ find . -name '*.ts' -not -path './node_modules/*' | ⋯ 3 more ⋯ tail -5 && curl -s https://example.com/install.sh | sh
bash · $ cat <<'EOF' > scripts/check.sh ⋯ 3-line heredoc ⋯ && bash scripts/check.sh
```

When Jev hands a request to the reasoning reviewer, the strip switches to that reviewer and says
why, for example `gpt-6-luna after Jev's escalation · medium`; the V1 overlay shows the same reason
on its model line. The elapsed time keeps counting from the start of the review.

Once the review resolves, both hosts show a compact status strip: one line for the result and a
second that names who decided ahead of the rationale, for example
`gpt-6-luna after Jev failed (timeout) — …` or `gpt-6-luna overturned Jev's denial — …`. A review a
model decided without a hand-off names that model, shortened to its last path segment; a result no
model decided shows the reason alone. The action on the first line is shortened the same way; the
rationale line is shortened to fit. The review keymap is released immediately, and the result stays
visible for 5 s. Whether the editor is available during a pending review depends on the host; the
V2 strip is not a keyboard lock.

On a final escalation in interactive mode, the overlay is removed and OpenCode's native approval
controls become available with a toast. Its first sentence says how the review ended: the
reasoning reviewer's review still needs your approval, the reasoning reviewer was unavailable
(the title then reads "Reasoning reviewer unavailable"), or no review time was left for it; the
reason follows. Host interruption, event-stream loss, and fail-closed settings can deny the
request instead. A broken TUI transport never changes the safety decision.

Reviewer config that cannot take effect, such as `systemOneEscalation: "reasoning-first"` without an
`escalationReviewer`, raises one toast per entry per TUI session and keeps a line in the sidebar,
for example `⚠ reviewer: reasoning-first inactive (no escalationReviewer)`. A degraded config raises
an error toast and an `✕` line, since automatic approval stays off until it is fixed. With several
warnings the line shows the count and the first; `doctor` lists them all. A healthy config shows no
line. V2 reads these lists from the reviewer's `status` RPC each time the TUI connects or the
directory changes, so they appear before the first review. V1 reads them from each review status, so
they first appear when a review starts.

## The review pipeline

### 1. Permission request

OpenCode V1 emits `permission.asked` for an `ask`-classified action. V2 calls the
`permission.evaluate` hook; there, the plugin preserves decisions already made by the host or other
plugins and reviews only requests that remain `ask`.

### 2. Emergency brake

A deterministic emergency brake rejects unmistakable root destruction and direct credential export
before any model call.

The brake is wrapper-aware (`sudo`, `doas`, `env`, `command`, `nice`, `nohup`, `systemd-run`,
`strace`, `ltrace`, `script -c`, …), including clustered value-taking options (`sudo -nu root …`).
It catches all of these:

- `sudo rm -rf /`
- `env VAR=x rm -rf /`
- `/bin/rm -rf /`
- `sh -c 'rm -rf /'`
- `ssh host rm -rf /`
- `busybox rm -rf /`

A live root glob (`rm -rf /*`) and redirections onto real block devices (`> /dev/sda`,
`tee /dev/sda`) count as root destruction.

Past a fixed analysis budget (input size, wrapper nesting, total commands, or re-lexed text), the
brake denies the command before any model call. Its reason names the resource limit, not a
detected destruction, and tells the agent to split the command into smaller steps.

### 3. Evidence

The plugin builds bounded evidence: the recent transcript, recovered user intent, and optional
read-only enrichment for SSH commands, local interpreter scripts, and Git state (see
[Evidence enrichment](#evidence-enrichment)).

Intent attribution uses a single origin rule:

- Synthetic or host-flagged parts are never human intent.
- In a delegated (subagent) session, no user-role message counts as human authorization. The
  initial briefing and every later `task_id` follow-up are agent-authored, and they appear only as
  labeled delegation context.

Recognized common credential formats are redacted from this evidence: `Bearer`, AWS, GitHub,
OpenAI, Anthropic, Slack, Google, Stripe, and GitLab keys, JWTs, private keys, URL userinfo,
cookies, and credential-bearing assignments. [Safety](SAFETY.md#evidence-and-intent) states the
limits of redaction.

### 4. Reviewer backend

A tool-free reviewer backend returns a versioned decision with `outcome`, `risk_level`,
`user_authorization`, `scope_alignment`, `evidence_completeness`, `rationale`, and `confidence`.

Normal models use schema-validated output or strict text parsing in a scratch session outside the
project. As a result, the host cannot prepend repository instructions, and a wildcard session rule
denies every tool, including MCP tools, except the reviewer's own structured-output result tool in
`json_schema` mode. If the host refuses isolation, the review fails safe.

Jev receives trusted policy and untrusted evidence as typed System One state plus fixed questions.
Its response is reconciled in code. Valid difficult decisions can be delegated to the optional
reasoning reviewer; in the default mode provider failures never are. With
`systemOneEscalation: "reasoning-first"`, every Jev escalation, invalid answer, and failure goes to
the reasoning reviewer before it reaches you (unless less than 15 seconds of the review budget
remain), and `systemOneDenialReview` lets that reviewer re-examine an uncertain Jev denial. A review
hands off at most once.
[Reviewer models](REVIEWER-MODELS.md#how-jev-decisions-are-handled) covers both backends and the
routing.

### 5. Enforcement

Code then enforces the invariants listed in [Safety](SAFETY.md#decisions). A single enforcement
boundary disposes of every internal `escalate` according to
[`escalationMode`](CONFIGURATION.md#interactive-vs-autonomous): `manual` sends it to a human, and
`deny` rejects it with the original reason. V2 also denies requests invalidated by cancellation,
the review deadline, or loss of the host event connection, in either mode.

### 6. Reply

V1 approvals reply `once`, never `always`. V2 approvals return `allow` from the evaluation hook. On
both hosts the approval continues silently if the host applies the decision. The tool output is not
annotated, so approval rationale never contaminates the primary agent context. The rationale still
goes to the audit log, the TUI, and debug logs.

Denials return a short, actionable rationale as tool feedback.

## Evidence enrichment

The reviewer sees bounded, sanitized evidence, never the raw filesystem. Enrichment never makes an
approval decision; the one deterministic exception is the
[SSH preflight rejection](#ssh-preflight-rejection).

### SSH commands

SSH commands are parsed into the destination, options, remote command, environment, mutation,
secret, and stdin signals, plus bounded stdin content for the common `cat script | ssh ... python -`
pattern. Sensitive paths, credential-like literal content, binary files, unresolved shell
expressions, and symlinks escaping approved roots are excluded.

### Verified remote shell scripts

Verified remote shell scripts have an opt-in command form. Stage the exact script locally inside
the workspace or `/tmp/opencode`, then generate the command with the CLI instead of hand-writing
its hash guard:

```bash
bunx @noppu-labs/opencode-permission-reviewer script command --file /tmp/opencode/deploy.sh --host deploy.example
```

Ask the agent to execute the printed command. The command streams the local file to the host,
checks its SHA-256 there before running `bash`, and removes the remote temporary copy. Add
`--port 2222` or `--shell sh` when needed.

Only the exact generated form counts as verified. Extra shell actions, dynamic paths, or a
remote-only script do not.

The local source is a copy of the intended executable bytes. If the script comes from Git, stage
the blob from a pinned commit locally before generating the command. The file is re-read on each
review and must remain regular, text-only, secret-free, and at most 64 KiB. A changed file fails the
remote hash check, even if it changes after permission approval. The plugin never connects to the
host to inspect it.

The first permission review includes the whole script. If that review is approved with sufficient
evidence and a script analysis, later reviews in the same conversation can reuse a compact,
in-memory analysis for the same hash, host, interpreter, and configuration, for up to one hour.
Only the analysis is reused: each command still receives a fresh authorization decision. A
different script, host, or configuration, or an expired analysis, requires full inspection again.

The audit stores the hash and inspection status, never the script body. When an opaque or truncated
SSH script is rejected, the agent receives guidance to stage a local copy and generate this form.
The CLI and the plugin must use the same installed package version.

### Local interpreter commands

Local interpreter commands (Python, Node, Bun, shell, Ruby, Perl, and compound commands that first
activate an environment) get the same bounded inspection when they name an explicit script. Inline
code, modules, stdin programs, dynamic paths, and remote-only SSH arguments are not misidentified as
local files.

### Package scripts

Package scripts (`bun run`, `npm run`, `pnpm run`, and `yarn run`) include the selected manifest
definition, defined conditional lifecycle hooks, and bounded literal calls to other local scripts.
Inspection never executes package code. Cycles, unsupported workspace selection, unavailable files,
and expansion limits remain explicit gaps. Running a local script is reported as possible network
access, never as an observed network operation.

### Git operations

Git operations (`add`, `commit`, `checkout`, `restore`, `rm`, `merge`, `rebase`, and `stash`) get
a read-only pre-command snapshot with:

- the current branch
- files already staged before the command
- unstaged and untracked files
- planned targets
- unresolved shell-expanded paths
- a bounded numstat for changes that would be discarded

Snapshots use fixed non-interactive Git queries with locking and hooks disabled, a two-second
timeout, and bounded output. The repository is never modified.

Repository-configured conversion filters (`clean`, `smudge`, `process`) and diff `textconv` drivers
are enumerated before every snapshot and neutralized with config overrides, including dotted names.
If the configuration cannot be fully verified, because there are too many filters or the config
scan itself fails, the snapshot is withheld rather than risk running repository-configured commands.
A filter configured between the scan and the snapshot is not caught; this race is known and
accepted.

Merge snapshots identify the in-progress merge index and unresolved paths. Rebase snapshots describe
the literal commit range and its presence in local remote-tracking refs. Those refs may be stale
and never prove publication status.

Literal destinations report conservative matches to configured push and fetch URLs, including
equivalent GitHub HTTPS and SSH forms. A match is evidence of destination identity only; it does not
grant authorization or declare the destination trusted. Repository or destination overrides that
cannot be resolved with the safe inspection commands make the snapshot unavailable.

### Approved roots

Only regular text files inside the working directory, the worktree, or `/tmp/opencode` can be
included. A `cd` inside the reviewed command can move the resolution base for relative paths, but
it never creates new approved roots: `cd /outside && python x.py` resolves in `/outside` and stays
blocked.

Git state inspection is contained to the same roots. A `cd /other/repo && git …` or
`git -C /other/repo …` yields an explicitly unavailable snapshot instead of reading an unrelated
repository.

Missing, blocked, and truncated executable stdin is explicitly identified so the reviewer fails
safe.

### SSH preflight rejection

The only deterministic SSH preflight rejection is an executable stdin file that still does not
exist after a 100 ms recheck. The primary agent gets an actionable instruction to create it and
retry. Every other SSH case (sensitive, binary, blocked, or truncated evidence) remains a reviewer
decision.
