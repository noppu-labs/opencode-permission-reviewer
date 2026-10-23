// The global and project reviewer config files `doctor` and `config print-effective` report: path, existence, short hash.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { globalConfigPath, projectConfigPath } from "../services/loader.ts";

export interface SourceInfo {
  path: string;
  exists: boolean;
  sha256: string | null;
}

export function inspectConfigSources(directory: string): {
  global: SourceInfo;
  project: SourceInfo;
} {
  return {
    global: inspectFile(globalConfigPath()),
    project: inspectFile(projectConfigPath(directory)),
  };
}

function inspectFile(path: string): SourceInfo {
  try {
    const content = readFileSync(path, "utf8");
    return { path, exists: true, sha256: sha256hex(content).slice(0, 16) };
  } catch {
    return { path, exists: false, sha256: null };
  }
}

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
