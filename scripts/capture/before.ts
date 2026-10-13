import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JSX } from "@opentui/solid";
import type { ReviewUiStatus } from "../../src/ui-protocol.ts";
import {
  bashRequest,
  CAPTURE_NOW,
  JEV,
  THEME,
  WIDE_COLUMNS,
} from "./fixtures.ts";
import { legacyUi, type Strip } from "./legacy-ui.ts";
import { type Block, renderSections } from "./render.ts";
import { LONG_COMMAND } from "./samples.ts";

/** The last release whose server cut long actions at the end. */
export const BEFORE_REF = "v3.0.0";
const ROOT = join(import.meta.dir, "..", "..");

const FETCH_TAGS =
  "run `git fetch --tags` (in a fork, fetch the tags from the upstream repository)";

/** Why `ref` cannot be rendered from this checkout, or undefined when it exists. */
export function missingRefMessage(ref: string): string | undefined {
  const found = Bun.spawnSync(
    ["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { cwd: ROOT },
  );
  return found.exitCode === 0
    ? undefined
    : `${ref} is not in this checkout, and long-command-before renders it: ${FETCH_TAGS}`;
}

/** Removes an extracted tree. The node_modules link goes first, so removal
 *  never walks into the repo's own node_modules. */
export function removeSource(dir: string): void {
  unlinkSync(join(dir, "node_modules"));
  rmSync(dir, { recursive: true, force: true });
}

/** Extracts src/ at `ref` into a temp directory whose node_modules links to
 *  the repo's, so the old modules load the same solid-js as the renderer. */
export function extractSource(ref: string): string {
  const archive = Bun.spawnSync(
    ["git", "archive", "--format=tar", ref, "src"],
    { cwd: ROOT },
  );
  if (archive.exitCode !== 0)
    throw new Error(
      `git archive ${ref} failed (${FETCH_TAGS}): ${archive.stderr.toString().trim()}`,
    );
  const dir = mkdtempSync(join(tmpdir(), "capture-tui-"));
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  const tar = Bun.spawnSync(["tar", "-x", "-C", dir], {
    stdin: archive.stdout,
  });
  if (tar.exitCode !== 0) {
    removeSource(dir);
    throw new Error(
      `extracting ${ref} failed: ${tar.stderr.toString().trim()}`,
    );
  }
  return dir;
}

/** The long command in v3.0.0's progress strip, result strip and V1 overlay. */
export async function renderBefore(): Promise<string[]> {
  const dir = extractSource(BEFORE_REF);
  try {
    const old = await legacyUi(dir);
    const status = (phase: "reviewing" | "denied"): ReviewUiStatus =>
      old.createUiStatus(bashRequest(LONG_COMMAND), phase, {
        model: JEV,
        variant: "system-one",
        timeoutMs: 120_000,
        emittedAt: CAPTURE_NOW - 2_100,
        ...(phase === "denied"
          ? { reason: "Pipes a remote script into a shell." }
          : {}),
      });
    const view =
      (strip: Strip, phase: "reviewing" | "denied"): (() => JSX.Element) =>
      (): JSX.Element =>
        strip({ theme: () => THEME, status: status(phase), frame: () => 0 });
    const blocks: Block[] = [
      {
        caption: "3.0.0 · V2 progress strip",
        height: 2,
        columns: WIDE_COLUMNS,
        view: view(old.ReviewProgress, "reviewing"),
      },
      {
        caption: "3.0.0 · result strip",
        height: 2,
        columns: WIDE_COLUMNS,
        view: view(old.ReviewResult, "denied"),
      },
      {
        caption: "3.0.0 · V1 overlay",
        height: 12,
        columns: WIDE_COLUMNS,
        view: view(old.ReviewOverlay, "reviewing"),
      },
    ];
    return await renderSections(blocks);
  } finally {
    removeSource(dir);
  }
}
