# Development

Guide for developing and maintaining the plugin: how `dist/` is built, the quality gates, the live
end-to-end tests against real OpenCode hosts, the synthetic model benchmark, and the TUI screens
in the docs. Setup, the `check` scripts, and pull request rules are in
[CONTRIBUTING](../CONTRIBUTING.md#before-opening-a-pull-request).

## Build output (`dist/`)

`bun run build` runs tsdown to bundle the server, the CLI, and the RPC protocol into
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

## Source layout

`src/` is split into layers. Put new code where this section says, and don't
add files to the `src/` root. `tests/architecture.test.ts` enforces the rules.

```text
src/
├── index.ts  tui.tsx            # plugin entries (server, TUI)
├── kernel/                      # domain types nearly every module shares, and the constant tables they derive from (PermissionRequest, ReviewerConfig, ...)
├── utils/                       # domain-free helpers and types
├── modules/
│   ├── analysis/                # pure command analysis, no I/O: shell/, walk/, capability/, brake/, git/, ssh/
│   ├── decision/                # parsing and gating the reviewer's decision, escalation
│   ├── policy/                  # rule engine
│   ├── evidence/                # providers/, files/, git/, ssh/, package-script/, local-script/
│   ├── config/                  # controllers/ (config command), models/, services/
│   ├── context/                 # what the reviewer sees: ports.ts, models/, services/
│   ├── reviewer/                # System One: services/
│   ├── audit/                   # the audit file: controllers/ (audit command), models/, repositories/, services/
│   ├── status/                  # review status and the RPC protocol the TUI uses: models/, services/
│   └── review/                  # the review use case: ports.ts, controllers/, models/, services/
├── adapters/opencode/{v1,v2}/   # host integration; implements the ports
├── ui/                          # TUI components, feed and store
└── cli/                         # explain.ts dispatcher, doctor/, init/
```

| Layer | Units                                                                 | May import        |
| ----- | --------------------------------------------------------------------- | ----------------- |
| 0     | `utils/`                                                              | nothing in `src/` |
| 1     | `kernel/`                                                             | `utils/`          |
| 2     | `analysis/`                                                           | layers 0–1        |
| 3     | `decision/`, `policy/`, `evidence/`, `config/`, `context/`            | layers 0–3        |
| 4     | `reviewer/`, `audit/`, `status/`                                      | layers 0–4        |
| 5     | `review/`                                                             | layers 0–5        |
| 6     | `adapters/`, `ui/`, `cli/`, entry points, any module's `controllers/` | anything          |

Modules in the same layer may import each other, but the module graph must
have no cycles. Below layer 6, nothing imports another module's
`controllers/` or `repositories/`. Modules have no `index.ts`: import the file
you need. Barrel files are banned because the TUI ships raw and a barrel
would pull server code into it.

Where new code goes:

- A type nearly every module needs (or a constant table it is derived from) →
  `kernel/`. A type with one owner → that module's `models/` (or next to its code in a flat module).
- A parser, lexer rule or command classifier → `modules/analysis/<area>/`.
- A new evidence source → `modules/evidence/<source>/`, plus its
  `EvidenceProvider` in `modules/evidence/providers/`.
- A CLI subcommand for one module's domain → that module's `controllers/`.
  One that inspects the host or the installation → `cli/<command>/`.
  Register both in `src/cli/explain.ts`.
- Something a module needs from the host → a port in that module's `ports.ts`,
  implemented in `adapters/opencode/` and wired in by the entry points.
- A helper or type with no domain knowledge → `utils/`.

Layer folders (`controllers/`, `services/`, `models/`, `repositories/`) are
used once a module has about 10 files. Smaller modules stay flat.

## Quality gates

`pre-commit` is the single runner. `bun run check` is the local equivalent of CI: it builds and
type-checks, runs every hook on every file and the whole-tree gitleaks scan, then runs `bun test`.
The CI `quality` job runs the same hooks once; the `check` job repeats build, typecheck and tests
on the minimum and the pinned Bun versions. The release workflow runs the same hooks in its own
read-only `quality` job, which the artifact-building job needs, so that job only runs steps pinned
by `bun.lock`. That job runs `bun-audit` too, so a new advisory blocks a release; the known ones
are ignored by ID (see "Ignored audit advisories").

| Tool | What it checks | Settings |
| --- | --- | --- |
| pre-commit-hooks | File hygiene: YAML, TOML and JSON syntax, merge markers, case conflicts, large files, shebangs, end of file, whitespace, line endings | `.pre-commit-config.yaml` |
| gitleaks | Secrets in the staged diff at commit time. CI has no staged diff, so it also runs a second, manual-stage hook (`gitleaks-tree`) that scans the whole working tree. | `.gitleaks.toml` (allows the synthetic fixtures CONTRIBUTING requires, scoped by path) |
| yamllint (`--strict`) | YAML style | `.yamllint.yaml` |
| markdownlint-cli2 | Markdown style | `.markdownlint-cli2.jsonc` |
| codespell | Typos | `[tool.codespell]` in `pyproject.toml` |
| Biome | Format, import order, and lint, including `noExcessiveCognitiveComplexity` and `noExcessiveLinesPerFile`; limits per directory are in "Test files" | `biome.jsonc` |
| `tsc --noEmit` | Types | `tsconfig.json`; the hook uses `tsconfig.hook.json`, which leaves out the live harness that imports `dist/` |
| FTA | Maintainability score per file, for everything except the test directories; cap in "Test files" | `fta.json` |
| knip | Unused files, exports and dependencies | `knip.jsonc` |
| `bun audit` | Known advisories in `bun.lock` | the `audit` script in `package.json` |
| ruff (check and format), bandit, vulture, pyrefly, pylint (module length only, 600 lines), complexipy (14) | The Python under `tests/compatibility` and `benchmarks/permission-reviewer/scripts` | `pyproject.toml` |

`tests/live-fixture` holds deliberate attack fixtures the live harness runs. Every tool excludes it
(Biome, ruff, bandit, complexipy, vulture, pyrefly, pylint, codespell, knip); keep it out of any
tool you add.

`.editorconfig` carries the editor basics. Biome formats TypeScript, JavaScript and JSON and
organizes imports, so `biome check` fails on unformatted code. The commits that reformatted the tree
are listed in `.git-blame-ignore-revs`; run `git config blame.ignoreRevsFile .git-blame-ignore-revs`
once per clone so `git blame` skips them (GitHub's blame view reads the file by itself).

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

`fta.json` sets `score_cap` to 55. `fta .` scans the whole repository, minus `.gitignore`d paths
and the `exclude_directories` in `fta.json`, and `extensions` adds `.mjs` to the TypeScript and
JavaScript files it reads by default. Two behaviors of the tool matter when you edit it:

- A file fails only when its score is strictly greater than the cap.
- An `exclude_directories` entry with one segment, like `tests`, matches a directory of that name
  at any depth. An entry with several segments, like `benchmarks/permission-reviewer/tests`,
  matches from the repository root. No `tests` directory exists under `src`, `scripts` or
  `benchmarks/permission-reviewer/lib`, and a new one would be exempt too.

An invalid or wrong-typed `score_cap` is silently ignored (the default of 1000 applies), so keep
it an integer. A syntax error in `fta.json` is caught by `check-json`.

### Test files

The two test directories, `tests` and `benchmarks/permission-reviewer/tests`, have their own limits:
one `overrides` entry in `biome.jsonc` and the `exclude_directories` in `fta.json`. Everything else
keeps the defaults.

| Rule | Test directories | Everything else |
| --- | --- | --- |
| `noExcessiveLinesPerFile` | 800 lines | 600 lines |
| `noExcessiveCognitiveComplexity` | 14 | 12 |
| `noAwaitInLoops` | off | on |
| `noSecrets` | off | on |
| FTA | not measured | cap 55 |

- Lines: test files hold long tables and fixtures, and splitting a well-set-up file costs more
  clarity than it buys.
- Complexity: a test body walks setup, a few branches and assertions, so it runs a little higher
  than production code.
- `noAwaitInLoops`: sequential awaits are the norm in tests, where each step runs against the state
  the last one left. A test that can run its steps at once should still use `Promise.all`. A loop
  with a `// Sequential:` comment giving an ordering reason stays sequential.
- `noSecrets`: synthetic credentials are deliberate fixtures. gitleaks scans them with its
  path-scoped allowlist (`.gitleaks.toml`), on the staged diff and on the whole tree in CI, so it
  stays the secret check.
- FTA: in test files the score mostly tracks a cyclomatic cliff (two or more branch constructs put
  a file at about 55-75 whatever its size), so the cap rewarded loop rewrites rather than simpler tests.

The override leaves `tests/live-fixture` excluded and changes no other rule. Source, scripts and the
benchmark library (`benchmarks/permission-reviewer/lib`) keep all four rules at the defaults.

### Suppressions

Every accepted finding carries its reason where it applies:

- Biome: a line-level `// biome-ignore lint/<group>/<rule>: <reason>`. No `biome-ignore-all` and no
  `biome-ignore-start`/`-end` ranges.
  Instead of a non-null assertion (`!`), use `invariant()` (`src/utils/invariant.ts`) in `src` and
  `defined()` (`tests/helpers.ts`) in tests.
- Python: `# noqa: <code>` with a reason, `# nosec <id> # <reason>`, or
  `# complexipy: ignore (<reason>)` on the def line. Two `pyproject.toml` per-file ruff ignores
  are permanent and say why there: `ARG` for `tests/**`, and `E501` for the dataset modules whose
  case strings are verbatim benchmark input.
- gitleaks: an allowlist entry in `.gitleaks.toml`, scoped by path and exact token.
- FTA: no per-file suppression. Only the test directories are excluded (`exclude_directories`, see
  "Test files"); fix a finding anywhere else.

Sequential `await` in a loop is flagged by `noAwaitInLoops` outside the test directories. Keep it,
with a suppression saying why order matters, where the order is the point (spawning processes in
turn, retries, ordered transport replies); otherwise use `Promise.all`. Tests need no suppression
(see "Test files").

### File length

TypeScript and JavaScript files stay under 600 lines (Biome) and under the FTA cap. Test files get
800 lines and no FTA check (see "Test files"). Python modules stay under 600 lines (pylint). When
a test file is too long, first merge near-identical tests into a table-driven one, move repeated
setup into helpers and combine tests that assert the same behavior, without dropping an assertion
or a covered case. If that is not enough, don't restructure the file; ask.

### Exemptions (the ratchet)

The ratchet is empty: no per-file exemption exists in `biome.jsonc` or `fta.json` (the test
directories are covered as a whole, see "Test files"). Don't add one to get a change through: fix
the finding, or suppress it on the line with a reason.

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
runs it, so a new advisory fails the next push. The release workflow's `quality` job runs it as
well, so an advisory that is not on the ignore list blocks a release.

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

## TUI screens

The images in `docs/images/`, shown in the README and the [TUI guide](TUI.md), are rendered from
the plugin's TUI components rather than drawn by hand. `scripts/capture-tui.ts <screen>` renders
one screen with OpenTUI's test renderer from sample statuses and OpenCode's default dark theme,
and prints it as truecolor ANSI. Charm's [freeze](https://github.com/charmbracelet/freeze) turns
that output into an SVG. freeze is a contributor tool, not a package dependency, and CI does not
run it. Install it once:

```sh
brew install charmbracelet/tap/freeze   # other package managers: see the freeze README
```

After changing a TUI component or a screen's samples, regenerate every image and commit the
result:

```sh
git fetch --tags        # long-command-before renders the v3.0.0 release (in a fork, from the upstream repository)
bun run docs:screens
```

To look at one screen in the terminal, run `bun scripts/capture-tui.ts <screen>`. The screens are
`handoff-progress`, `result-attribution`, `v1-overlay-handoff`, `result-triggers`,
`manual-toasts`, `config-warnings`, `long-command-before` and `long-command-after`.

- The sample statuses live in `scripts/capture/samples.ts` and `scripts/capture/host-samples.ts`
  (`scripts/capture/host-content.ts` holds the warning strings). The statuses the current server
  would send go through the status wire codec, so a sample the TUI would reject fails the capture;
  the v3.0.0 statuses are built by that release's own code.
- Toasts and the sidebar are drawn by OpenCode. Their screens show the text and variant the plugin
  sends, computed by the plugin's own toast and sidebar helpers, under a caption that says so.
- `long-command-before` extracts `src/` at the `v3.0.0` tag into a temporary directory with
  `git archive` and renders that release's components, the last ones that cut long actions at the
  end.
- The script pins the clock so elapsed times do not change between runs, and the freeze flags
  live in `scripts/capture-tui.ts`: no window controls, a system monospace font stack instead of
  an embedded font (an embedded font adds about 360 KB per image), OpenCode's dark background. The
  committed images were made with freeze v0.2.2; the script warns when another version is
  installed.
- `docs:screens` first checks that the `v3.0.0` tag exists and stops before writing any image if
  not. It also writes each image's `<title>` from `scripts/capture/titles.ts`. The alt text of an
  image in the docs should say the same things as its title.
- `tests/capture-tui.test.ts` renders every screen except `long-command-before`, checks the text
  the docs quote and checks that every committed image carries its title, so a component change
  that drops or rewords quoted text fails `bun test`. Nothing compares the committed images with a
  fresh render, so regenerate them after any change to a component, the theme or a sample.
- `docs/images/` is not in the package `files`, so the images never ship. The README links them by
  absolute `raw.githubusercontent.com` URLs on `main`, because npm does not resolve relative image
  paths.
