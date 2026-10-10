import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadResolvedConfig,
  projectConfigPath,
  setGlobalConfigPathForTests,
} from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import {
  captureWarnings,
  execFileAsync,
  isolateGlobal,
  tempDir,
  writeProjectConfig,
} from "./trust-fixtures.ts";

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

// --- project config layer: non-regular and oversized reads -------------------------------

describe("trust hardening — project config layer reads are bounded", () => {
  test("a symlinked project config is ignored with a warning instead of followed", () => {
    const projectDir = tempDir("reviewer-config-link-");
    const outsideDir = tempDir("reviewer-config-outside-");
    const { warnings, restore } = captureWarnings();
    try {
      isolateGlobal(outsideDir);
      const target = join(outsideDir, "real.jsonc");
      writeFileSync(target, JSON.stringify({ confidenceThreshold: 0.99 }));
      mkdirSync(join(projectDir, ".opencode"), { recursive: true });
      symlinkSync(target, projectConfigPath(projectDir));
      const loaded = loadResolvedConfig(undefined, projectDir);
      // A followed link would tighten the threshold to 0.99; the ignored
      // layer leaves the default in place.
      expect(loaded.confidenceThreshold).toBe(
        DEFAULT_CONFIG.confidenceThreshold,
      );
      expect(warnings.some((w) => w.includes("ignored"))).toBe(true);
    } finally {
      restore();
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }, 20_000);

  test("a FIFO at the project config path returns quickly instead of blocking startup", async () => {
    const projectDir = tempDir("reviewer-config-fifo-");
    const outsideDir = tempDir("reviewer-config-outside-");
    const { warnings, restore } = captureWarnings();
    try {
      isolateGlobal(outsideDir);
      mkdirSync(join(projectDir, ".opencode"), { recursive: true });
      await execFileAsync("mkfifo", [projectConfigPath(projectDir)]);
      const started = Date.now();
      const loaded = loadResolvedConfig(undefined, projectDir);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(loaded.confidenceThreshold).toBe(
        DEFAULT_CONFIG.confidenceThreshold,
      );
      expect(warnings.some((w) => w.includes("ignored"))).toBe(true);
    } finally {
      restore();
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }, 20_000);

  test("an oversized project config is ignored with a warning", () => {
    const projectDir = tempDir("reviewer-config-huge-");
    const outsideDir = tempDir("reviewer-config-outside-");
    const { warnings, restore } = captureWarnings();
    try {
      isolateGlobal(outsideDir);
      writeProjectConfig(projectDir, {
        confidenceThreshold: 0.99,
        pad: "x".repeat(1024 * 1024 + 1024),
      });
      const loaded = loadResolvedConfig(undefined, projectDir);
      expect(loaded.confidenceThreshold).toBe(
        DEFAULT_CONFIG.confidenceThreshold,
      );
      expect(
        warnings.some((w) => w.includes("size limit") && w.includes("ignored")),
      ).toBe(true);
    } finally {
      restore();
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }, 20_000);
});
