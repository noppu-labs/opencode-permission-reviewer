/**
 * Ship the TUI entry as raw TypeScript/TSX (not a prebundled JS file).
 *
 * OpenCode's host compiles plugin `.tsx` with its own babel-preset-solid
 * pipeline and rewrites `solid-js` / `@opentui/*` imports onto the single
 * embedded runtime. A tsup/esbuild bundle of the same sources produces JSX
 * shapes the host renderer does not consume, so the overlay never paints
 * even though the module loads cleanly. Working TUI plugins ship raw TSX
 * for this reason.
 *
 * Only the TUI graph is copied, including the shared config loader but not
 * the server engine.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist", "tui");

const paths = [
  "tui.tsx",
  "ui/components.tsx",
  "ui/action-fit.ts",
  "ui/fit-parts.ts",
  "ui/action-spans.tsx",
  "ui/review-overlay.tsx",
  "ui/review-result.tsx",
  "ui/v1-host.ts",
  "ui/v2.tsx",
  "modules/status/models/rpc.ts",
  "ui/review-feed.ts",
  "ui/review-store.ts",
  "ui/review-connection.ts",
  "ui/review-theme.ts",
  "ui/attribution.ts",
  "ui/manual-toast.ts",
  "ui/config-notices.ts",
  "modules/status/models/failure-kind.ts",
  "modules/config/services/config.ts",
  "modules/config/models/config-fields.ts",
  "modules/config/models/config-knobs.ts",
  "modules/config/models/config-policy-rules.ts",
  "modules/config/models/config-risk-policy.ts",
  "modules/config/models/system-one-providers.ts",
  "modules/policy/config-rule-condition.ts",
  "modules/config/services/reviewer-model.ts",
  "modules/config/services/system-one-routing.ts",
  "modules/config/services/loader.ts",
  "modules/config/services/layer-read.ts",
  "modules/config/services/trust-boundary.ts",
  "modules/config/services/trust-boundary-keys.ts",
  "modules/config/services/risk-policy-clamp.ts",
  "modules/config/services/trusted-degradation.ts",
  "modules/config/services/jsonc.ts",
  "utils/descriptor-io.ts",
  "utils/is-record.ts",
  "modules/status/models/ui-protocol.ts",
  "modules/status/services/ui-status-extras.ts",
  "modules/status/services/ui-text-elide.ts",
  "modules/status/services/ui-status-parse.ts",
  "modules/status/services/ui-state.ts",
  "adapters/opencode/event-normalizer.ts",
];

const files = paths.map((path) => [`src/${path}`, path] as const);

rmSync(out, { recursive: true, force: true });

for (const [from, to] of files) {
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, from), dest);
}

// Fail the build when the curated graph omits a runtime dependency. The host
// compiles these sources at runtime, so a missing file would otherwise escape
// the build and surface only when OpenCode starts. Bun's scanner deliberately
// excludes type-only imports, which do not need a shipped runtime module.
const ts = new Bun.Transpiler({ loader: "ts" });
const tsx = new Bun.Transpiler({ loader: "tsx" });
for (const [, to] of files) {
  const source = readFileSync(join(out, to), "utf8");
  const imports = (to.endsWith(".tsx") ? tsx : ts).scan(source).imports;
  for (const imported of imports) {
    if (!imported.path.startsWith(".")) continue;
    const dependency = resolve(dirname(join(out, to)), imported.path);
    if (!existsSync(dependency)) {
      throw new Error(
        `Missing TUI dependency ${imported.path} imported by ${to}`,
      );
    }
  }
}
