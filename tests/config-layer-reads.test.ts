import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import {
  loadResolvedConfig,
  projectConfigPath,
  setGlobalConfigPathForTests,
} from "../src/modules/config/services/loader.ts";
import type { ReviewerConfig } from "../src/types.ts";
import { loadLayers } from "./config-layer-fixtures.ts";
import { captureWarnings, tempDir } from "./trust-hardening/trust-fixtures.ts";

const CAP = 1024 * 1024;

/** A valid JSONC object padded to exactly `size` bytes. */
function paddedConfig(size: number): string {
  const head = '{"confidenceThreshold":0.9,"pad":"';
  return `${head}${"x".repeat(size - head.length - 2)}"}`;
}

/** Load with the global layer at `<dir>/global/permission-reviewer.jsonc` and
 *  the project layer under `<dir>`, after `plant` shapes the tree. */
function loadPlanted(plant: (dir: string) => void): {
  config: ReviewerConfig;
  warnings: string[];
} {
  const dir = tempDir("reviewer-reads-");
  const { warnings, restore } = captureWarnings();
  try {
    plant(dir);
    setGlobalConfigPathForTests(
      join(dir, "global", "permission-reviewer.jsonc"),
    );
    return { config: loadResolvedConfig(undefined, dir), warnings };
  } finally {
    restore();
    setGlobalConfigPathForTests(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("config layer reads are bounded and fail visibly", () => {
  test("a file of exactly the size cap is read", () => {
    const { config, warnings } = loadLayers({ project: paddedConfig(CAP) });
    expect(config.confidenceThreshold).toBe(0.9);
    expect(warnings).toEqual([]);
  });

  test("a file one byte over the cap is ignored", () => {
    const { config, warnings } = loadLayers({ project: paddedConfig(CAP + 1) });
    expect(config.confidenceThreshold).toBe(DEFAULT_CONFIG.confidenceThreshold);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEndWith(
      `exceeds the size limit (${CAP} bytes) and was ignored`,
    );
  });

  test("a directory at the project config path is not a regular file", () => {
    const { warnings } = loadPlanted((dir) => {
      mkdirSync(projectConfigPath(dir), { recursive: true });
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEndWith("is not a regular file and was ignored");
  });

  test("an open error other than a missing file is reported with its code", () => {
    const { config, warnings } = loadPlanted((dir) => {
      // A file where a directory is expected makes both opens fail ENOTDIR.
      writeFileSync(join(dir, ".opencode"), "");
      writeFileSync(join(dir, "global"), "");
    });
    expect(config.configDegraded).toEqual([
      "global config file exists but could not be read",
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toEndWith(
      "exists but could not be read (ENOTDIR); the layer was ignored",
    );
  });

  test.each([
    ["EIO", Object.assign(new Error("io"), { code: "EIO" })],
    ["unknown error", new Error("no code")],
  ])("a failed read is reported as %s", (code, error) => {
    const read = spyOn(fs, "readSync").mockImplementation(() => {
      throw error;
    });
    try {
      const { warnings } = loadLayers({ project: { audit: true } });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toEndWith(
        `exists but could not be read (${code}); the layer was ignored`,
      );
    } finally {
      read.mockRestore();
    }
  });
});
