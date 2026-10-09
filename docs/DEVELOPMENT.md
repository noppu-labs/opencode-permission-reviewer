# Development

Guide for developing and maintaining the plugin: how `dist/` is built, the live end-to-end tests
against real OpenCode hosts, and the synthetic model benchmark. Setup, the `check` scripts, and
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
pinned binary paths documented there, then run `python -m pytest tests/compatibility -q`. Each
host uses an isolated home, configuration, provider, and audit file, and no personal OpenCode
installation is changed. V1 and V2 have independent pytest modules.

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
