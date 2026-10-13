/**
 * Renders one TUI screen for the docs as truecolor ANSI on stdout, or, with
 * --all, regenerates every docs/images/<screen>.svg through Charm's freeze.
 * See docs/DEVELOPMENT.md, "TUI screens".
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin";
import { SCREEN_TITLES, withTitle } from "./capture/titles.ts";

// The Solid transform must be registered before any TUI module loads (see
// tests/tui-loader.ts), so the capture modules are imported dynamically below.
ensureSolidTransformPlugin();

const ROOT = join(import.meta.dir, "..");
const FREEZE_VERSION = "v0.2.2";
const FREEZE_FLAGS = [
  "--window=false",
  "--background",
  "#0a0a0a",
  "--padding",
  "20",
  "--margin",
  "0",
  "--border.radius",
  "8",
  "--font.family",
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  "--font.size",
  "14",
  "--line-height",
  "1.2",
];

const {
  SCREEN_NAMES,
  isScreenName,
  renderScreen,
}: typeof import("./capture/screens.ts") = await import("./capture/screens.ts");
const { BEFORE_REF, missingRefMessage }: typeof import("./capture/before.ts") =
  await import("./capture/before.ts");
const { CAPTURE_NOW }: typeof import("./capture/fixtures.ts") = await import(
  "./capture/fixtures.ts"
);

function regenerate(): number {
  if (!Bun.which("freeze")) {
    console.error(
      'freeze is not installed: brew install charmbracelet/tap/freeze (see docs/DEVELOPMENT.md, "TUI screens")',
    );
    return 1;
  }
  const version = Bun.spawnSync(["freeze", "--version"])
    .stdout.toString()
    .trim();
  if (!version.includes(FREEZE_VERSION))
    console.warn(
      `expected freeze ${FREEZE_VERSION}, found "${version}"; the SVGs may change for that reason alone`,
    );
  // Fail before writing any image, so a missing tag never leaves a half-regenerated set.
  const missing = missingRefMessage(BEFORE_REF);
  if (missing !== undefined) {
    console.error(missing);
    return 1;
  }
  mkdirSync(join(ROOT, "docs", "images"), { recursive: true });
  for (const screen of SCREEN_NAMES) {
    const freeze = Bun.spawnSync(
      [
        "freeze",
        "--execute",
        `bun scripts/capture-tui.ts ${screen}`,
        "--output",
        join("docs", "images", `${screen}.svg`),
        ...FREEZE_FLAGS,
      ],
      { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
    );
    if (freeze.exitCode !== 0) {
      console.error(
        `freeze failed for ${screen}; run \`bun scripts/capture-tui.ts ${screen}\` to see the error`,
      );
      return 1;
    }
    // freeze writes no <title>; the committed SVGs need one (Biome a11y rule, screen readers).
    const svg = join(ROOT, "docs", "images", `${screen}.svg`);
    writeFileSync(
      svg,
      withTitle(readFileSync(svg, "utf8"), SCREEN_TITLES[screen]),
    );
  }
  return 0;
}

async function capture(screen: string | undefined): Promise<number> {
  if (screen === undefined || !isScreenName(screen)) {
    console.error(
      `usage: bun scripts/capture-tui.ts <${SCREEN_NAMES.join(" | ")}> | --all`,
    );
    return 2;
  }
  // Elapsed times come from Date.now(); a fixed clock keeps them, and the SVGs, stable.
  Date.now = (): number => CAPTURE_NOW;
  const rows = await renderScreen(screen);
  await Bun.write(Bun.stdout, `${rows.join("\n")}\n`);
  return 0;
}

const [argument] = Bun.argv.slice(2);
// A rendered TUI keeps the event loop alive, and freeze waits for the process
// to end, so exit explicitly.
process.exit(argument === "--all" ? regenerate() : await capture(argument));
