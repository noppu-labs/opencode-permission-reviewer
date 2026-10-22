import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { V2HostApi } from "./host-api.ts";

type PluginEntry = Awaited<
  ReturnType<V2HostApi["plugin"]["list"]>
>["data"][number];

/** Whether a local plugin entry is this attempt's bootstrap, by ID or by its path. */
function isBootstrap(
  plugin: PluginEntry,
  root: string,
  pluginID: string,
): boolean {
  if (plugin.source.type !== "local") return false;
  if ((plugin as unknown as { id?: unknown }).id === pluginID) return true;
  const path = plugin.source.path;
  if (typeof path !== "string") return false;
  try {
    const local = resolve(
      path.startsWith("file:") ? fileURLToPath(path) : path,
    );
    return local === root || local === join(root, "index.js");
  } catch {
    return false;
  }
}

/** Wait 100 ms, or reject with the signal's reason once it aborts. */
function pollDelay(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 100);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/** The client has no activation wait, so poll the plugin inventory until this
 *  attempt's bootstrap (`isBootstrap`) reports active; a reported failure
 *  throws. The attempt signal bounds the wait. */
export async function waitForIsolationActive(
  client: V2HostApi,
  directory: string,
  pluginID: string,
  signal: AbortSignal,
): Promise<void> {
  const root = resolve(directory);
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polls the host plugin inventory every 100 ms until the isolation bootstrap reports active or failed; each poll runs only after the previous one saw it pending
    const plugins = await client.plugin.list(
      { location: { directory } },
      { signal },
    );
    const entry = plugins.data.find((plugin) =>
      isBootstrap(plugin, root, pluginID),
    );
    if (entry !== undefined) {
      if (entry.state.status === "active") return;
      throw new Error(
        `Reviewer isolation failed to activate: ${entry.state.error}`,
      );
    }
    await pollDelay(signal);
  }
}
