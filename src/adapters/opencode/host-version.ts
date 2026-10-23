import type { PluginInput } from "@opencode-ai/plugin";
import { withTimeout } from "../../utils/with-timeout.ts";

interface RawClient {
  get?(options: {
    url: string;
    signal: AbortSignal;
  }): Promise<{ data?: { version?: string } }>;
}

/**
 * Asks a V1 host for its version over the SDK client's raw HTTP client,
 * bounded at 2 s; the promise settles to undefined on any failure. Returns
 * undefined, without a promise, when the client exposes no raw GET.
 */
export function probeHostVersion(
  client: PluginInput["client"],
): Promise<string | undefined> | undefined {
  const raw = (client as unknown as { _client?: RawClient })._client;
  return raw?.get
    ? withTimeout(
        raw.get({ url: "/global/health", signal: AbortSignal.timeout(2000) }),
        2000,
      )
        .then((response) => response.data?.version)
        .catch(() => undefined)
    : undefined;
}
