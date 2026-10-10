import { expect } from "bun:test";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  loadResolvedConfig,
  projectConfigPath,
  setGlobalConfigPathForTests,
} from "../../src/config/loader.ts";
import type { PermissionRequest, ReviewerConfig } from "../../src/types.ts";
import { MockClient, request, runtime } from "../helpers.ts";

export const execFileAsync = promisify(execFile);

export const DIR = "/home/user/project";
export const WT = "/home/user/project";

export function bashRequest(command: string): PermissionRequest {
  return request({
    permission: "bash",
    patterns: [command],
    metadata: { command },
  });
}

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return dir;
}

// A string is written as is, so a test can plant malformed JSONC.
export function useGlobalConfig(dir: string, content: unknown): void {
  const path = join(dir, "permission-reviewer.jsonc");
  writeFileSync(
    path,
    typeof content === "string" ? content : JSON.stringify(content),
  );
  setGlobalConfigPathForTests(path);
}

export function isolateGlobal(outsideDir: string): void {
  // Point the trusted global layer at a missing file so only the project
  // layer under test influences the loaded config.
  setGlobalConfigPathForTests(join(outsideDir, "missing-global.jsonc"));
}

export function writeProjectConfig(projectDir: string, content: unknown): void {
  mkdirSync(join(projectDir, ".opencode"), { recursive: true });
  writeFileSync(projectConfigPath(projectDir), JSON.stringify(content));
}

export function captureWarnings(): { warnings: string[]; restore: () => void } {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: string): number => warnings.push(String(message));
  return {
    warnings,
    restore: (): void => {
      console.warn = originalWarn;
    },
  };
}

export function loadTrustedRules(
  dir: string,
  layer: "global" | "inline",
  policyRules: unknown,
): ReviewerConfig {
  useGlobalConfig(dir, layer === "global" ? { policyRules } : {});
  return loadResolvedConfig(layer === "inline" ? { policyRules } : {});
}

export async function expectModelAllowBlocked(
  config: ReviewerConfig,
): Promise<void> {
  const client = new MockClient();
  expect((await runtime(client, config).runtime.process(request())).kind).toBe(
    "escalate",
  );
  expect(client.replies).toHaveLength(0);
}
