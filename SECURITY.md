# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/noppu-labs/opencode-permission-reviewer/security/advisories/new);
please don't open a public issue. Include as much of this as you can:

- a minimal reproduction: the command and the permission policy that trigger it
- the plugin version (`version` in `package.json`) and the OpenCode version you run
- the safety outcome you expected and the one you got

We acknowledge reports within a few days and coordinate the fix and disclosure with you.

## Scope

The plugin approves or denies AI-agent actions on your behalf, so most security bugs are cases
where it approves something it should not. In scope:

- An automatic approval that breaks one of the deterministic invariants in
  [docs/SAFETY.md](docs/SAFETY.md), such as approving an action the reviewer classified as
  critical, or approving after a reviewer failure.
- Project or inline configuration that weakens trusted global settings (see the trust rules in
  [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).
- The reviewer session gaining tools, MCP servers, or repository instructions.
- Credentials leaking into reviewer evidence, the audit log, or the TUI.
- The release pipeline: npm publishing, provenance, checksums, and the SBOM.

A reviewer model that misjudges an action's risk is a known limit of the design, not a
vulnerability on its own. The plugin checks a decision's consistency, not its semantic
correctness. Other plugins loaded into the same OpenCode host can also override its decisions.
[docs/SAFETY.md](docs/SAFETY.md) covers the threat model.

This project is a fork of
[warc0s/opencode-permission-reviewer](https://github.com/warc0s/opencode-permission-reviewer).
If an issue also affects the upstream project, it is worth reporting there as well.

## Verifying releases

Each release is published to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements),
and its GitHub Release carries the package tarball, SHA-256 checksums, and a CycloneDX SBOM. To
check the registry signatures and provenance of an installed copy:

```sh
npm audit signatures
```

[docs/SUPPLY-CHAIN.md](docs/SUPPLY-CHAIN.md) describes what the package ships and the known
residual exposure in its dependency tree.
