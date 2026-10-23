import { defineConfig, type UserConfig } from "tsdown";

// dist/ is the ship set for the server and CLI. The TUI entry is copied as raw
// TSX by scripts/copy-tui.ts so OpenCode's host can compile it with its own
// Solid/OpenTUI pipeline (a prebundled TUI does not render on the host).
const base: UserConfig = {
  format: ["esm"],
  platform: "node",
  target: "es2022",
  // The three builds run in parallel, so the build script empties dist/ first.
  clean: false,
  sourcemap: false,
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: [
      "@opencode-ai/plugin",
      "@opencode-ai/plugin/tui",
      "@opencode-ai/sdk",
      /^@opentui\//,
      "solid-js",
      "solid-js/web",
      // The effect runtime belongs to the host's plugin SDK chain. Keeping it
      // external means an accidental import stays a visible module specifier
      // (caught by the package smoke tests) instead of being silently inlined
      // into our bundles.
      "effect",
      /^effect\//,
    ],
  },
};

// A split chunk breaks direct path loading under Bun, and tsdown cannot turn
// splitting off, so each entry is its own single-entry build.
export default defineConfig([
  { ...base, entry: { index: "src/index.ts" } },
  { ...base, entry: { explain: "src/cli/explain.ts" } },
  { ...base, entry: { rpc: "src/modules/status/models/rpc.ts" } },
]);
