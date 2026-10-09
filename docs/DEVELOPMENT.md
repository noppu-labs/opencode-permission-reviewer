# Development

Guide for developing and maintaining the plugin: the local scripts, how `dist/` is built, the live
end-to-end tests against real OpenCode hosts, and the synthetic model benchmark. For setup and
pull request rules, see [CONTRIBUTING](../CONTRIBUTING.md).

## Scripts

```bash
bun install
bun run check          # format + lint + typecheck + tests + build (must pass before any push)
bun run test:stress    # stress suite only
bun run test:package   # npm pack ship-set smoke (raw TUI + server bundle)
```

## Build output (`dist/`)

`bun run build` runs tsup to bundle the server and CLI into `dist/index.js` and `dist/explain.js`,
then runs `bun scripts/copy-tui.ts` to copy the slim TUI source graph into `dist/tui/` as raw TSX.

The TUI must stay unbundled. OpenCode's host compiles plugin `.tsx` with its own Solid/OpenTUI
pipeline, and a prebundled TUI does not render, so do not add a prebundled TUI entry. When you
change the TUI, keep the file list in `scripts/copy-tui.ts` in sync with the imports of
`src/tui.tsx` and its copied modules (no server engine, no `node:` builtins).

`dist/` is gitignored and rebuilt explicitly with `bun run build`. Installs run no lifecycle
scripts (the package declares none), so never rely on `bun install` producing `dist/`, and never
commit build output. `tests/package-smoke.test.ts` builds, packs, and verifies that the tarball
ships exactly the expected set, including the raw TUI files and the absence of a prebundled TUI.
See [Supply chain](./SUPPLY-CHAIN.md) for what that test enforces on dependencies.

## Live testing

The live tests run against real OpenCode hosts and are not part of `bun test`.

### 1. Live model smoke

`tests/live-harness.ts` runs against a real OpenCode server and model. It speaks the opencode-ai
API. On a machine where `opencode` on `PATH` is the desktop runtime, which serves only the web
SPA, start a pinned opencode-ai host from the compatibility tooling instead:

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
pinned binary paths documented there, then run `python -m pytest tests/compatibility -q`. Each
host uses an isolated home, configuration, provider, and audit file, and no personal OpenCode
installation is changed. V1 and V2 have independent pytest modules.

Pass the matrix a direct OpenCode executable, not a profile launcher or wrapper that exports its
own `HOME`, `XDG_*`, or `OPENCODE_CONFIG*` values. Such a launcher can replace the disposable
environment the harness creates, which makes an otherwise correct runtime look incompatible. If
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
