// The probes `doctor` runs outside the config: audit path writability and a running host's reviewer status.
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { OpenCode } from "@opencode/client";
import { validateHostEndpoint } from "../../adapters/opencode/v2/connection.ts";
import { ReviewerRpc } from "../../modules/status/models/rpc.ts";

/** The reviewer status a running host reports over its RPC route. */
export async function connectedStatus(
  endpoint: string,
  directory: string,
): Promise<unknown> {
  const password =
    process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) throw new Error("Connected doctor requires OPENCODE_PASSWORD");
  const client = OpenCode.make({
    baseUrl: validateHostEndpoint(endpoint).href,
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    },
  });
  return await client
    .rpc(ReviewerRpc)
    .status({}, { location: { directory }, signal: AbortSignal.timeout(5000) });
}

export async function checkWritable(
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await mkdir(dirname(path), { recursive: true });
    // Match the writer's 0600 mode so a doctor probe never leaves a
    // world-readable audit trail behind.
    const fh = await open(path, "a", 0o600);
    await fh.close();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
