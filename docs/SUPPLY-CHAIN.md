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
publishes a CycloneDX SBOM of the published artifact and npm provenance for it.

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
- the exact `@babel/core` and `solid-js` versions described in
  [Known residual exposure](#known-residual-exposure)
- an `npm audit` gate that fails on any high or critical advisory other than the documented
  `seroval` residuals

The root `overrides` in this repository protect the development tree only. npm never applies a
dependency's overrides to the installing application, which is why the consumer-side guarantees
are tests against the installed tree itself.

## Known residual exposure

These advisories remain unfixed in the consumer install tree.

`@opentui/solid` pins `@babel/core@7.28.0` exactly (every published 0.5.x does), and
GHSA-4x5r-pxfx-6jf8 (arbitrary file read via a crafted `sourceMappingURL` comment, low severity)
affects `@babel/core <= 7.29.0`. This package uses that Babel only to compile its own shipped TUI
sources, never repository- or attacker-influenced input, so the advisory's conditions are not met.
The copy is still reachable in the consumer tree, so the consumer surveillance test pins the
installed version. Moving off 7.28.0 needs an `@opentui/solid` release with a fixed pin or
dropping the exact-pin constraint, and this note changes with it. The development tree overrides
Babel to 7.29.7, which npm does not apply to consumers.

`@opentui/solid` also peer-pins `solid-js@1.9.12` exactly. Its `seroval` dependency carries
GHSA-p6vx-979v-rg4c and GHSA-jp82-f5mq-hwhp (unsafe `fromJSON` deserialization, fixed in
`solid-js` 1.9.16). Only the SSR renderer `solid-js/web` imports `seroval`, and neither this
package nor OpenTUI loads it, so the vulnerable code is unreachable at runtime. The consumer
surveillance test pins `solid-js`, asserts that nothing imports `solid-js/web`, and admits only
those two advisories.

`esbuild` is a build-time dependency here and is never shipped. The root overrides move it past
GHSA-g7r4-m6w7-qqqr. That override intentionally does not reach consumers, because consumers
never install `esbuild` from this package.

## The `effect` runtime

For OpenCode V1 hosts, `@opencode-ai/plugin` resolves `effect@4.0.0-beta.83` from the host's own
dependency chain. It is externalized from the bundles and is neither shipped nor vendored by this
package. It is not pinned or overridden to a different version, because forcing
another version could fork the runtime that the V1 host shares with every other plugin.
