# Governance

Who runs the project, what each role does, and who holds access to the resources that could
change what users install. To check it, read
`gh api repos/noppu-labs/opencode-permission-reviewer/collaborators`, `gh api orgs/noppu-labs`,
`npm owner ls @noppu-labs/opencode-permission-reviewer` and `.github/workflows/release.yml`.

## Roles

The project has one maintainer, `@cris005`. The repository belongs to the Noppu Labs
organization on GitHub (`noppu-labs`).

| Role | Who | Responsible for |
| --- | --- | --- |
| Maintainer | `@cris005` | Reviewing and merging pull requests, code owner of every path (`.github/CODEOWNERS`), promoting `develop` to `main` (which releases), answering security reports, repository and organization administration |
| Contributor | Anyone with a GitHub account | Opening issues and pull requests against `develop`, following [CONTRIBUTING](CONTRIBUTING.md) |
| Automation | Dependabot, the `openrouter-models` workflow, Copilot code review | Proposing dependency and model-list updates as pull requests; the rulesets request a Copilot review on each push. No ruleset lets them bypass, so their pull requests need the maintainer's approval like an outside contribution. |

There is no written process for adding maintainers and no decision process beyond the
maintainer's review of each pull request. With one maintainer, the maintainer's own pull requests
have no second reviewer and merge through the organization-admin bypass described in
[Rulesets](DEVELOPMENT.md#rulesets).

## Access to sensitive resources

| Resource | Who has access | How it is controlled |
| --- | --- | --- |
| Repository administration (settings, rulesets, secrets) | `@cris005`, the only collaborator (admin) and the only organization member (owner) | The organization requires two-factor authentication. Its base permission for members is read. No team and no outside collaborator has access to this repository. |
| `main` and `develop` | Merging needs a pull request; only `@cris005` can approve as code owner or bypass as organization admin | Rulesets `main` and `develop`: signed commits, required `ci` check, no force push or deletion ([Rulesets](DEVELOPMENT.md#rulesets)) |
| Security advisories and private vulnerability reports | Repository administrators: `@cris005` | Private vulnerability reporting is on ([SECURITY.md](SECURITY.md)) |
| Release publishing | Whoever can merge to `main`, push a `v*` tag or dispatch `release.yml`, which today is only `@cris005` | `release.yml` tags the commit and publishes from a run at the tag. The `release tags` ruleset stops a tag from being moved or deleted, except by an organization admin. |
| The npm package `@noppu-labs/opencode-permission-reviewer` | The npm account `noppu`, the only package owner, held by `@cris005` alone | Releases publish through npm trusted publishing: the `publish` job authenticates with its OIDC token, so the workflow holds no npm token, and the repository has no Actions secrets. 3.6.0 was published by that identity, with SLSA provenance. |
| SonarCloud project `noppu-labs_opencode-permission-reviewer` | `@cris005` alone | The project is public, so anyone can read its findings |
