# Development

Guide for developing and maintaining the plugin: how `dist/` is built, the quality gates, the live
end-to-end tests against real OpenCode hosts, and the synthetic model benchmark. Setup, the `check` scripts, and
pull request rules are in [CONTRIBUTING](../CONTRIBUTING.md#before-opening-a-pull-request).

## Build output (`dist/`)

`bun run build` runs tsup to bundle the server, the CLI, and the RPC protocol into
`dist/index.js`, `dist/explain.js`, and `dist/rpc.js`, then runs `bun scripts/copy-tui.ts` to copy
the slim TUI source graph into `dist/tui/` as raw TSX. The package exports map onto those files:

- Server: `main` and `./server` resolve to `dist/index.js` (bundled).
- TUI overlay: `./tui` resolves to `dist/tui/tui.tsx` (raw TSX, not a JS bundle).
- RPC: `./rpc` resolves to `dist/rpc.js`, the read-only V2 protocol that the TUI and CLI use to
  read review status from the server.
- CLI: `./cli` and `bin` resolve to `dist/explain.js`.

The TUI must stay unbundled. OpenCode's host compiles plugin `.tsx` with its own Solid/OpenTUI
pipeline, and a prebundled TUI entry loads but never renders, so do not add one. When you
change the TUI, keep the file list in `scripts/copy-tui.ts` in sync with the imports of
`src/tui.tsx` and its copied modules (no server engine, no `node:` builtins).

`dist/` is gitignored and rebuilt explicitly with `bun run build`. Installs run no lifecycle
scripts (the package declares none), so never rely on `bun install` producing `dist/`, and never
commit build output. `tests/package-smoke.test.ts` builds, packs, and verifies that the tarball
ships exactly the expected set, including the raw TUI files and the absence of a prebundled TUI.
See [Supply chain](./SUPPLY-CHAIN.md) for what that test enforces on dependencies.

## Quality gates

`pre-commit` is the single runner. `bun run check` is the local equivalent of CI: it builds and
type-checks, runs every hook on every file and the whole-tree gitleaks scan, then runs `bun test`.
The CI `quality` job runs the same hooks once; the `check` job repeats build, typecheck and tests
on the minimum and the pinned Bun versions. The release workflow runs the same hooks in its own
read-only `quality` job, which the artifact-building job needs, so that job only runs steps pinned
by `bun.lock`.

| Tool | What it checks | Settings |
| --- | --- | --- |
| pre-commit-hooks | File hygiene: YAML, TOML and JSON syntax, merge markers, case conflicts, large files, shebangs, end of file, whitespace, line endings | `.pre-commit-config.yaml` |
| gitleaks | Secrets in the staged diff at commit time. CI has no staged diff, so it also runs a second, manual-stage hook (`gitleaks-tree`) that scans the whole working tree. | `.gitleaks.toml` (allows the synthetic fixtures CONTRIBUTING requires, scoped by path) |
| yamllint (`--strict`) | YAML style | `.yamllint.yaml` |
| markdownlint-cli2 | Markdown style | `.markdownlint-cli2.jsonc` |
| codespell | Typos | `[tool.codespell]` in `pyproject.toml` |
| Biome | Lint, including `noExcessiveCognitiveComplexity` (10) and `noExcessiveLinesPerFile` (600) | `biome.jsonc` |
| `tsc --noEmit` | Types | `tsconfig.json`; the hook uses `tsconfig.hook.json`, which leaves out the live harness that imports `dist/` |
| FTA | Maintainability score per file, cap 52 | `fta.json` |
| knip | Unused files, exports and dependencies | `knip.jsonc` |
| `bun audit` | Known advisories in `bun.lock` | the `audit` script in `package.json` |
| ruff (check and format), bandit, vulture, pyrefly, pylint (module length only, 600 lines), complexipy (14) | The Python under `tests/compatibility` and `benchmarks/permission-reviewer/scripts` | `pyproject.toml`, `complexipy-snapshot.json` |

`.editorconfig` carries the editor basics. Biome's formatter and import organizing are still off
(see the ratchet below), so formatting is not checked yet.

### Where the pins live

Each tool has one pin. Biome (`@biomejs/biome`), FTA (`fta-cli`), knip and TypeScript are exact
devDependencies in `package.json`, locked in `bun.lock`. pre-commit, ruff, pyrefly, pylint and
pytest are in the `dev` group of `pyproject.toml`, locked in `uv.lock`. The remaining hooks
(pre-commit-hooks, gitleaks, yamllint, markdownlint-cli2, codespell, ruff-pre-commit, bandit,
complexipy, vulture) are pinned by `rev` in `.pre-commit-config.yaml`. The ruff `rev` must match
the ruff version in `uv.lock`. The hooks that use the lockfile pins run through `bun run` and
`uv run --frozen`, never `bunx`, which could fetch an unrelated package of the same name when
`bun install` has not run. CI installs the same lockfiles with `bun install --frozen-lockfile`
and `uv sync --locked`.

### FTA

`fta.json` sets `score_cap` to 52. `fta .` scans the whole repository, minus `.gitignore`d paths
and the `exclude_directories` in `fta.json`, and `extensions` adds `.mjs` to the TypeScript and
JavaScript files it reads by default. Two behaviors of the tool matter when you edit it:

- A file fails only when its score is strictly greater than the cap (the source compares
  `fta_score > score_cap`; a cap of 50 failed a 50.99 file and a cap of 51 passed it). Scores
  are floats and the cap is an integer, so an exactly equal score has not been observed.
- `exclude_filenames` matches basenames only; a path does not exclude. A new file that reuses an
  excluded basename, for example from splitting a large file, is silently exempt. Check the list
  whenever you add or move a file.

An invalid or wrong-typed `score_cap` is silently ignored (the default of 1000 applies), so keep
it an integer. A syntax error in `fta.json` is caught by `check-json`.

### Suppressions

Every accepted finding carries its reason where it applies:

- Biome: a line-level `// biome-ignore lint/<group>/<rule>: <reason>`. No `biome-ignore-all` and no
  `biome-ignore-start`/`-end` ranges.
- Python: `# noqa: <code>` with a reason, `# nosec <id> - <reason>`, or
  `# complexipy: ignore (<reason>)` on the def line.
- gitleaks: an allowlist entry in `.gitleaks.toml`, scoped by path and exact token.
- FTA: an `exclude_filenames` entry. JSON has no comments, so the reason goes in the pull request
  description.

Sequential `await` in a loop is flagged by `noAwaitInLoops`. Keep it, with a suppression saying why
order matters, where the order is the point (spawning processes in turn, retries, ordered
transport replies); otherwise use `Promise.all`.

### File length

TypeScript and JavaScript files stay under 600 lines (Biome) and under the FTA cap, tests
included. Python modules stay under 600 lines (pylint). When a test file is too long, first merge
near-identical tests into a table-driven one, move repeated setup into helpers and combine tests
that assert the same behavior, without dropping an assertion or a covered case. If that is not
enough, don't restructure the file; ask. A deferred file keeps a narrow exemption: a Biome
`overrides` entry with `maxLines` set to its current length, so it cannot grow, plus an FTA
`exclude_filenames` entry if it is over the cap.

### Pending exemptions (the ratchet)

The tooling landed with its full end-state configuration, plus temporary exemptions for what the
code does not pass yet. Each exemption is narrow (it matches only what fails today) and names the
stacked `quality/<n>-<slug>` pull request that fixes the code and deletes it:

- `biome.jsonc`: the formatter and `organizeImports` are disabled, and `overrides` turns off one
  rule per entry for an exact list of files. Entries are ordered by the pull request that removes
  them.
- `fta.json`: `exclude_filenames` lists every file above the cap.
- `knip.jsonc`: `ignoreIssues` and `ignoreDependencies` for dead exports and files and unused
  dependencies.
- `pyproject.toml` and `complexipy-snapshot.json`: per-file ruff ignores, pyrefly sub-configs and
  the functions over the complexipy limit.

Don't add to these lists to get a new change through. Fix the finding, or suppress it on the line
with a reason. When the last stacked pull request lands, none of them remain.

### Ignored audit advisories

`bun audit` currently reports three advisories that the `audit` script ignores by ID, so the hook
still fails on anything new:

- `GHSA-p6vx-979v-rg4c` and `GHSA-jp82-f5mq-hwhp`: `seroval`, reached through `solid-js`, which is
  exact-pinned together with the `@opentui` peer set.
- `GHSA-ch52-4w7c-c8xp`: `http-cache-semantics`, reached through the dev dependency
  `@opencode/plugin`.

Resolving them is a dependency decision; remove the matching `--ignore` flag when it is made.
`bun audit` needs network access. As a hook it runs only when `bun.lock` or `package.json`
changes, but `pre-commit run --all-files` (and so `bun run check` and the CI `quality` job) always
runs it, so a new advisory fails the next push.

## Live testing

The live tests run against real OpenCode hosts and are not part of `bun test`.

### 1. Live model smoke

`tests/live-harness.ts` runs against a real OpenCode server and model. It speaks the opencode-ai
API. On a machine where `opencode` on `PATH` is the desktop runtime, which serves only the web
SPA, start a pinned opencode-ai host from the compatibility tooling instead. The installer fetches
Linux x64 host binaries only, so this recipe runs on Linux x64:

```bash
HOST_GENERATION=v1 bun tests/compatibility/install-hosts.ts
# Note the printed OPENCODE_V1_1_18_31 path, then serve with a known password:
OPENCODE_SERVER_PASSWORD=synthetic-local-host-password \
  "$OPENCODE_V1_1_18_31" serve --hostname 127.0.0.1 --port 41973 &
REVIEWER_LIVE_PASSWORD=synthetic-local-host-password \
  bun run tests/live-harness.ts http://127.0.0.1:41973 --smoke
```

The harness reads the server password from `REVIEWER_LIVE_PASSWORD` and sends it as Basic auth.
When the variable is absent, the client sends no authentication. The smoke requires completed
tool execution and matching audit decisions, and provider failures cannot count as successful
denials. Set `REVIEWER_LIVE_DIRECTORY` to run against a separate synthetic fixture directory.

### 2. Live host regressions

After building, `bun tests/live-host-regressions.ts` starts its own fresh OpenCode server, a
synthetic MCP tool, and a local deterministic provider. It checks the actual provider tool list
after host filtering, plus the regression cases, without paid inference. It complements the live
model smoke.

It resolves the server binary from `OPENCODE_V1_1_18_32` (printed by the installer above) and
falls back to `opencode` on `PATH`. It authenticates with `REVIEWER_LIVE_PASSWORD` (default
`synthetic-local-host-password`), so no manual `serve` is needed.

### 3. Compatibility matrix

The dual-host matrix is in [`tests/compatibility`](../tests/compatibility/README.md). Set the
pinned binary paths documented there, then run `uv run pytest tests/compatibility -q` (`uv sync`
installs the pinned pytest). Each host uses an isolated home, configuration, provider, and audit
file, and no personal OpenCode installation is changed. V1 and V2 have independent pytest
modules.

Pass the matrix a direct OpenCode executable, not a profile launcher or wrapper that exports its
own `HOME`, `XDG_*`, or `OPENCODE_CONFIG*` values. Such a launcher can intentionally replace the
disposable environment the harness creates, which makes an otherwise correct runtime look
incompatible. If
`opencode` on `PATH` is a wrapper, use its underlying runtime executable or the path printed by
`tests/compatibility/install-hosts.ts`.

This requirement applies only to isolated testing. Normal installations invoke the runtime
directly, and custom profile launchers remain valid deployment setups. Give a launcher setup its
own smoke test with its intended configuration.

### 4. Testing the packed artifact

To exercise the distributed artifact, build first and run
`PACKAGE_MANAGER=npm bun tests/compatibility/install-package.ts` (or `bun` as the manager). Set
`PLUGIN_PACKAGE_PATH` to the returned `packagePath` before running pytest. Both installation modes
disable lifecycle scripts.

CI runs both managers against every pinned host, including real PTY rendering. A separate weekly
host advisory only reports registry drift and does not change the supported-version contract in
[Compatibility](./COMPATIBILITY.md).

## Synthetic model benchmark

The [synthetic model benchmark](../benchmarks/permission-reviewer/README.md) evaluates 600
permission-review cases against the current reviewer prompt and core. It is a separate
development tool and is not part of the npm package or the plugin runtime. It does not collect
OpenCode conversations or execute fixture actions. See its
[evaluation protocol](../benchmarks/permission-reviewer/docs/METHODOLOGY.md) and
[results table](../benchmarks/permission-reviewer/RESULTS.md).
