# Supply chain

What installing the package runs and ships, how the runtime dependency set is frozen and tested,
and the known advisories that remain in the consumer install tree.

## Install-time code

The package declares no lifecycle scripts, so installing it from npm executes nothing from this
repository. Installing from a Git URL or a local path executes nothing either, but neither is a
supported install method: `dist/` is gitignored, so those installs yield a package without
bundles. Install from the npm registry. Building from source is an explicit
`bun install && bun run build`.

## Native code

The published tarball has only JavaScript, raw TSX sources, and documentation.
`tests/package-smoke.test.ts` rejects native addons and shared libraries, `prebuilds/`
directories, platform packages, and bundled-dependency payloads in the ship set. Every release
publishes a CycloneDX SBOM of the published artifact and npm provenance for it. A run on the
release tag generates the provenance; `release.yml` creates that tag and dispatches the run after
checking the commit on `main` ([Releasing](DEVELOPMENT.md#releasing)).

Native packages can still reach your install tree through dependencies:

- `@opentui/core`, the renderer of the host TUI pipeline, declares optional platform-specific
  native packages (for example `@opentui/core-linux-x64` on Linux) that npm resolves on your
  machine. The TUI uses those renderer packages.
- The `@opencode/client` dependency reaches the optional `@msgpackr-extract/*` native
  accelerators through `effect` and `msgpackr`. The consumer install test tracks their platform
  package names too.

## Frozen runtime dependencies

The direct runtime dependency set is frozen and tested. Adding a dependency, native or not, is a
reviewed change: the package smoke test fails until its allowlist is updated in the same commit.

The same suite installs the published tarball in an isolated tree and freezes what a consumer
actually gets:

- the platform-specific packages under `@opentui` (rendering only)
- the optional `@msgpackr-extract` accelerators
- the exact `@babel/core` version `@opentui/solid` pins (7.29.7, past GHSA-4x5r-pxfx-6jf8), and the
  exact `solid-js` version (1.9.18, whose `seroval` is past every advisory that 1.9.12 carried),
  with nothing importing the SSR renderer `solid-js/web`
- an `npm audit` gate that fails on any high or critical advisory

The root `overrides` in this repository protect the development tree only. npm never applies a
dependency's overrides to the installing application, which is why the consumer-side guarantees
are tests against the installed tree itself.

## Known residual exposure

These advisories remain unfixed in the consumer install tree.

`@opentui/solid` pins `babel-plugin-module-resolver` 5.0.2 exactly, which brings `glob` 9.3.5 and
`minimatch` 8.0.7 into the consumer tree. They carry the moderate GHSA-3g3m-2fjr-6pw4 (AbortSignal
cancellation bypass, fixed in `glob` 14.0.2) and GHSA-g3hv-75wg-m249 (pattern-expansion denial of
service, fixed in `minimatch` 11.0.1). Neither fix exists for an older major. The resolver calls
`glob` only to expand a `root` option, and `@opentui/solid` passes none, so this package never
reaches the vulnerable code. The root `overrides` that keep `bun audit` clean in this repository
don't follow the tarball. Issue #128 tracks removing them once upstream moves.

The build toolchain (tsdown, Rolldown and its native bindings) is a dev dependency and is never
shipped. The consumer surveillance test also asserts that no `esbuild` reaches a consumer tree.

## The `effect` runtime

For OpenCode V1 hosts, `@opencode-ai/plugin` resolves `effect@4.0.0-beta.83` from the host's own
dependency chain. It is externalized from the bundles and is neither shipped nor vendored by this
package. It is not pinned or overridden to a different version, because forcing
another version could fork the runtime that the V1 host shares with every other plugin.
