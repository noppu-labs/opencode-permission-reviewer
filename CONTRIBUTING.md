# Contributing

This plugin approves and denies AI-agent actions automatically, so changes need to be deliberate
and tested. The safety-critical code is the decision, policy, and emergency-brake logic in `src/`;
most of the rest supports OpenCode V1 and V2 hosts, the TUI overlay, and the CLI.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- [uv](https://docs.astral.sh/uv/). It installs the Python tooling that runs the pre-commit hooks
  and `pytest` for the real-host compatibility matrix in `tests/compatibility`.
- `git`

```sh
git clone https://github.com/noppu-labs/opencode-permission-reviewer.git
cd opencode-permission-reviewer
git switch develop
bun install
uv sync
uv run pre-commit install
bun run check
```

`uv run pre-commit install` makes the same hooks run on every commit.

## Branches

Branch from `develop` and open your pull request against `develop`. GitHub defaults to `main`, so
pick `develop` as the base explicitly. Maintainers promote validated changes from `develop` to
`main` in a separate pull request, and releases are cut from `main`.

## Before opening a pull request

Run the checks that CI (`.github/workflows/ci.yml`) runs. CI also runs the real-host matrix and
the benchmark, which the [development guide](docs/DEVELOPMENT.md) covers.

```sh
bun run check           # build, typecheck, every hook on every file, gitleaks-tree, bun test
bun run test:coverage   # test suite with the coverage threshold check
```

The Biome hook runs with `--write`, so `check` can rewrite files; look at `git diff` afterwards,
because CI fails when a hook changes the tree. `bun run lint:fix` applies Biome's fixes on its
own, and `bun run format` runs only the formatter. `bun run test:stress` and
`bun run test:package` rerun only the stress suite or the npm pack ship-set test. Don't disable
or skip tests to get `check` passing.

Every accepted lint finding carries its reason on the line, as a line-level
`// biome-ignore lint/<group>/<rule>: <reason>` comment. Don't add file-wide or ranged ignores
(`biome-ignore-all`, `biome-ignore-start`). The [development guide](docs/DEVELOPMENT.md#quality-gates)
covers the other tools' conventions.

Your pull request should also meet these rules:

- No secrets or personal data in code or tests. Use obviously synthetic fixtures: tokens like
  `sk-syntheticcredential...`, documentation IP ranges (`192.0.2.x`, `198.51.100.x`,
  `203.0.113.x`), and `*.invalid` hostnames. Never commit real tokens, keys, personal filesystem
  paths, or internal codenames. Put new secret-shaped test values in
  `tests/fixtures/synthetic-secrets.ts`: it carries the `noSecrets` line ignores, and
  `.gitleaks.toml` allowlists that path with the exact values.
- Behavior stays backward compatible unless you are intentionally changing a version pin or an
  enforcement invariant. If you are, say so in the pull request.
- User-facing strings are in English. The policy and reviewer prompts are English, and runtime
  and UI messages should match.
- User-visible changes get a `CHANGELOG.md` entry under `[Unreleased]`.

## Areas that need care

- `src/decision.ts`, `src/policy.ts`, `src/emergency-brake.ts`, `src/policy/policy-engine.ts`,
  the trust boundary in `src/config/loader.ts`, and the runtime enforcement path encode the safety
  invariants. A change to them needs tests that demonstrate the invariant (for example, that
  critical risk can never be approved) and the reasoning stated in the pull request.
- The V1 adapter and isolated reply transport (`src/opencode/v1-adapter.ts`,
  `src/opencode/reply-transport.ts`) reach into OpenCode's authenticated SDK transport. Changes
  there must keep the "refusing unsafe partial startup" behavior.
- The reviewer has no operational tools. On V2 it sees only its schema-validated result tool in
  its isolated location. Never give it operational tools or MCP access.
- Both real-host pytest harnesses under `tests/compatibility` must keep working. Their profiles
  and synthetic model providers must not inherit user configuration or credentials. Pin host
  versions and integrity, and verify server and TUI loading after a fresh build. See
  [`tests/compatibility`](tests/compatibility/README.md).
- The TUI entry ships as raw TSX. Don't reintroduce a prebundled `dist/tui.js`; the
  [development guide](docs/DEVELOPMENT.md) explains why.

The [development guide](docs/DEVELOPMENT.md) covers the build output, live end-to-end testing,
the compatibility matrix, and the model benchmark.

## Conventions

- Commit messages follow the conventional-commit style in the history (`fix(v2):`, `feat:`,
  `docs:`, `ci(release):`, `chore(deps):`, ...).
- Documentation beyond the standard root files (README, CONTRIBUTING, SECURITY, LICENSE,
  MIGRATION, CHANGELOG) lives in `docs/`.
- Report security issues as described in [SECURITY.md](SECURITY.md), not in public issues.
- Participation is covered by the [code of conduct](CODE_OF_CONDUCT.md).
