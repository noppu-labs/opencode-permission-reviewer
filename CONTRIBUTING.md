# Contributing

This plugin approves and denies AI-agent actions automatically, so changes need to be deliberate
and tested. The safety-critical code is the decision, policy, and emergency-brake logic in `src/`;
most of the rest supports OpenCode V1 and V2 hosts, the TUI overlay, and the CLI.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- `git`
- Python with `pytest`, needed only for the real-host compatibility matrix in
  `tests/compatibility`

```sh
git clone https://github.com/noppu-labs/opencode-permission-reviewer.git
cd opencode-permission-reviewer
git switch dev
bun install
bun run check
```

## Branches

Branch from `dev` and open your pull request against `dev`. GitHub defaults to `main`, so pick
`dev` as the base explicitly. Maintainers promote validated changes from `dev` to `main` in a
separate pull request, and releases are cut from `main`.

## Before opening a pull request

Run the same checks CI runs (`.github/workflows/ci.yml`):

```sh
bun run check           # prettier, eslint, build, tsc, and the full bun test suite
bun run test:coverage   # test suite with the coverage threshold check
```

`bun run format` fixes formatting. `bun run test:stress` and `bun run test:package` rerun only
the stress suite or the npm pack ship-set test. Don't disable or skip tests to get `check`
passing.

Your pull request should also meet these rules:

- No secrets or personal data in code or tests. Use obviously synthetic fixtures: tokens like
  `sk-syntheticcredential...`, documentation IP ranges (`192.0.2.x`, `198.51.100.x`,
  `203.0.113.x`), and `*.invalid` hostnames. Never commit real tokens, keys, personal filesystem
  paths, or internal codenames.
- A safety change comes with tests that demonstrate the invariant, for example that critical
  risk can never be approved. This applies to `decision.ts`, `policy.ts`, `emergency-brake.ts`,
  and the runtime enforcement path.
- Behavior stays backward compatible unless you are intentionally changing a version pin or an
  enforcement invariant. If you are, say so in the pull request.
- User-facing strings are in English. The policy and reviewer prompts are English, and runtime
  and UI messages should match.
- User-visible changes get a `CHANGELOG.md` entry under `[Unreleased]`.

## Areas that need care

- `src/decision.ts`, `src/policy.ts`, and `src/emergency-brake.ts` encode the safety invariants.
  Document the reasoning for any change to them.
- The V1 adapter and isolated reply transport (`src/opencode/v1-adapter.ts`,
  `src/opencode/reply-transport.ts`) reach into OpenCode's authenticated SDK transport. Changes
  there must keep the "refusing unsafe partial startup" behavior.
- The reviewer has no operational tools. On V2 it sees only its schema-validated result tool in
  its isolated location. Never give it operational tools or MCP access.
- Both real-host pytest harnesses under `tests/compatibility` must keep working. Their profiles
  and synthetic model providers must not inherit user configuration or credentials. Pin host
  versions and integrity, and verify server and TUI loading after a fresh build. See
  [MIGRATION.md](MIGRATION.md).
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
