import { Buffer } from "node:buffer";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { ReviewerRpc } from "../../ui/rpc.ts";
import {
  readRegisteredService,
  type ServiceEndpoint,
} from "./service-registration.ts";

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

/** The registered service, accepted only on a loopback origin. */
async function registeredLoopbackService(
  version: string,
): Promise<ServiceEndpoint | undefined> {
  const service = await readRegisteredService(version);
  if (!service) return undefined;
  const endpoint = validateHostEndpoint(service.url);
  if (!LOOPBACK_HOSTS.has(endpoint.hostname))
    throw new Error("Reviewer registered service must use a loopback address");
  if (endpoint.pathname !== "/" || endpoint.search || endpoint.hash)
    throw new Error(
      "Reviewer registered service URL must be a loopback origin",
    );
  return { url: endpoint.href, password: service.password };
}

function makeClient(endpoint: ServiceEndpoint): OpenCodeClient {
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`,
    },
    fetch: hostCompatibleFetch(),
  });
}

/** Discover without starting a host; prove identity before accessing sessions. */
export async function connectV2Host(
  directory: string,
  identity: string,
  version: string,
  signal: AbortSignal,
): Promise<OpenCodeClient> {
  const url = process.env.OPENCODE_PERMISSION_REVIEWER_HOST_URL;
  let client: OpenCodeClient;
  if (url !== undefined) {
    const endpoint = validateHostEndpoint(url);
    const password =
      process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD;
    if (!password)
      throw new Error(
        "Reviewer explicit host connection requires OPENCODE_PASSWORD",
      );
    client = makeClient({ url: endpoint.href, password });
  } else {
    const endpoint = await registeredLoopbackService(version);
    if (!endpoint)
      throw new Error(
        "Reviewer host connection unavailable: use the registered service or configure OPENCODE_PERMISSION_REVIEWER_HOST_URL and OPENCODE_PASSWORD",
      );
    client = makeClient(endpoint);
  }
  const actual = await client
    .rpc(ReviewerRpc)
    .identity({}, { location: { directory }, signal });
  if (actual !== identity)
    throw new Error(
      "Reviewer connection does not belong to this host generation",
    );
  return client;
}
