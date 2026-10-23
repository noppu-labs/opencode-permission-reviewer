// Types `init` shares across its planning and writing steps, and the plugin key each host generation uses.

export interface PackageInfo {
  name: string;
  version: string;
  engines: { bun?: string; opencode?: string };
  root: string;
}

export type HostGeneration = "v1" | "v2";

export type PluginEntry =
  | string
  | [string, Record<string, unknown>]
  | { package: string; options?: Record<string, unknown> };

export interface FilePlan {
  path: string;
  action: "create" | "append" | "noop" | "error";
  backup?: string;
  fingerprint?: string;
}

export function pluginKey(host: HostGeneration): "plugins" | "plugin" {
  return host === "v2" ? "plugins" : "plugin";
}
