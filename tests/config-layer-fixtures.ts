import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadResolvedConfig,
  projectConfigPath,
  setGlobalConfigPathForTests,
} from "../src/config/loader.ts";
import type { InlineOptionsTrust } from "../src/config/sources.ts";
import type { ReviewerConfig } from "../src/types.ts";
import { captureWarnings, tempDir } from "./trust-hardening/trust-fixtures.ts";

/** Config layers for one load. A string is written as is, so a test can plant
 *  malformed JSONC; an absent global layer points at a missing file. */
export interface Layers {
  global?: unknown;
  project?: unknown;
  inline?: Record<string, unknown>;
  trust?: InlineOptionsTrust;
  /** Passed through as the loader's `printConfigWarnings` option. */
  printConfigWarnings?: boolean;
}

export interface Loaded {
  config: ReviewerConfig;
  warnings: string[];
}

function write(path: string, content: unknown): void {
  writeFileSync(
    path,
    typeof content === "string" ? content : JSON.stringify(content),
  );
}

/** Load the layers from a fresh temp dir, capturing console warnings. */
export function loadLayers(layers: Layers): Loaded {
  const dir = tempDir("reviewer-layers-");
  const globalPath = join(dir, "global.jsonc");
  const { warnings, restore } = captureWarnings();
  try {
    if (layers.global !== undefined) write(globalPath, layers.global);
    setGlobalConfigPathForTests(globalPath);
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    if (layers.project !== undefined) {
      write(projectConfigPath(dir), layers.project);
    }
    const config = loadResolvedConfig(layers.inline, dir, layers.trust, {
      printConfigWarnings: layers.printConfigWarnings ?? true,
    });
    return { config, warnings };
  } finally {
    restore();
    setGlobalConfigPathForTests(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

export function loadConfig(layers: Layers): ReviewerConfig {
  return loadLayers(layers).config;
}
