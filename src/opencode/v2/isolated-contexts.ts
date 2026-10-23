import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "@opencode/plugin";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

const contexts = new Map<string, Context>();

/** Canonicalize a directory so the two spellings of a symlinked temp path agree. */
function canonical(directory: string): string {
  try {
    return realpathSync.native(resolve(directory));
  } catch {
    return resolve(directory);
  }
}

/** Remember the plugin ctx the isolation bootstrap activated with. */
export function rememberIsolatedContext(directory: string, ctx: Context): void {
  contexts.set(canonical(directory), ctx);
}

/** Forget it once the location is released. */
export function forgetIsolatedContext(directory: string): void {
  contexts.delete(canonical(directory));
}

/** The ctx for an isolated location, or undefined before it activates. */
export function isolatedContext(directory: string): Context | undefined {
  return contexts.get(canonical(directory));
}
