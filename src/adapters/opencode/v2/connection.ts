import { Buffer } from "node:buffer";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import { ReviewerRpc } from "../../../modules/status/models/rpc.ts";
import type { V2HostApi } from "./host-api.ts";
import { createInProcessHost } from "./in-process-host.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateHostEndpoint(url: string): URL {
  const endpoint = new URL(url);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error(
      "Reviewer host URL must be HTTP(S) without embedded credentials",
    );
  if (endpoint.protocol === "http:" && !LOOPBACK_HOSTS.has(endpoint.hostname))
    throw new Error("Reviewer host connections outside loopback require HTTPS");
  return endpoint;
}

const SESSION_WAIT = /^\/api\/experimental\/session\/([^/]+)\/wait$/;

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}

/** Wait on the current route, retrying the legacy one when the host has no
 *  experimental wait endpoint. */
async function waitWithLegacyRoute(
  delegate: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: URL,
  sessionID: string | undefined,
): Promise<Response> {
  const response = await delegate(
    input instanceof Request ? input.clone() : input,
    init,
  );
  if (response.status !== 404 && response.status !== 405) return response;
  await response.body?.cancel().catch(() => {});
  url.pathname = `/api/session/${sessionID}/wait`;
  return delegate(
    input instanceof Request ? new Request(url, input) : url,
    init,
  );
}

export function hostCompatibleFetch(
  delegate: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    const session = url.pathname.match(SESSION_WAIT);
    if (!session) return delegate(input, init);
    return waitWithLegacyRoute(delegate, input, init, url, session[1]);
  }) as typeof globalThis.fetch;
}

function makeClient(endpoint: {
  url: string;
  password: string;
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`,
    },
    fetch: hostCompatibleFetch(),
  });
}

/** The explicit server named by OPENCODE_PERMISSION_REVIEWER_HOST_URL; guards
 *  misuse when reached without the URL. */
export async function connectV2Host(
  directory: string,
  identity: string,
  _version: string,
  signal: AbortSignal,
): Promise<V2HostApi> {
  const url = process.env.OPENCODE_PERMISSION_REVIEWER_HOST_URL;
  if (url === undefined)
    throw new Error(
      "Reviewer explicit host connection requires OPENCODE_PERMISSION_REVIEWER_HOST_URL",
    );
  const endpoint = validateHostEndpoint(url);
  const source = `${endpoint.href} from OPENCODE_PERMISSION_REVIEWER_HOST_URL`;
  const password =
    process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD;
  if (!password)
    throw new Error(
      "Reviewer explicit host connection requires OPENCODE_PASSWORD",
    );
  const client = makeClient({ url: endpoint.href, password });
  const actual = await client
    .rpc(ReviewerRpc)
    .identity({}, { location: { directory }, signal });
  if (actual !== identity)
    throw new Error(
      `Reviewer connection does not belong to this host generation: ${source} is a different OpenCode server than the one running this plugin. Check that OPENCODE_PERMISSION_REVIEWER_HOST_URL names this server, or unset it to review through the server running this plugin`,
    );
  return client;
}

/** The host a review runs against: the explicit server named by
 *  OPENCODE_PERMISSION_REVIEWER_HOST_URL, else this plugin's own context. */
export async function resolveV2Host(
  ctx: Context,
  directory: string,
  identity: string,
  version: string,
  signal: AbortSignal,
): Promise<V2HostApi> {
  if (process.env.OPENCODE_PERMISSION_REVIEWER_HOST_URL !== undefined)
    return connectV2Host(directory, identity, version, signal);
  return createInProcessHost(ctx);
}
