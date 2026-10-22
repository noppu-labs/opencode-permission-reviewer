import { afterEach, expect, type Mock, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import {
  connectV2Host,
  hostCompatibleFetch,
  validateHostEndpoint,
} from "../src/opencode/v2/connection.ts";
import { isCompatibleHostVersion } from "../src/opencode/v2/service-registration.ts";
import { HTTP_URL_WITH_USERINFO } from "./fixtures/synthetic-secrets.ts";
import { defined } from "./helpers.ts";

const hostUrl = "OPENCODE_PERMISSION_REVIEWER_HOST_URL";
const password = "OPENCODE_PASSWORD";
const legacyPassword = "OPENCODE_SERVER_PASSWORD";
const stateHome = "XDG_STATE_HOME";
const originalEnv: Record<
  typeof hostUrl | typeof password | typeof legacyPassword | typeof stateHome,
  string | undefined
> = {
  [hostUrl]: process.env[hostUrl],
  [password]: process.env[password],
  [legacyPassword]: process.env[legacyPassword],
  [stateHome]: process.env[stateHome],
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function fakeClient(actualIdentity: string): OpenCodeClient {
  return {
    rpc: () => ({ identity: async () => actualIdentity }),
  } as unknown as OpenCodeClient;
}

/** The bundled client exposes `make` as an accessor, which bun's spyOn
 *  cannot mock and whose setter ignores assignments; redefining the
 *  property works and the original descriptor restores cleanly. */
function stubMake(impl: () => OpenCodeClient): {
  make: Mock<() => OpenCodeClient>;
  restore: () => void;
} {
  const descriptor = defined(
    Object.getOwnPropertyDescriptor(OpenCode, "make"),
    "OpenCode.make descriptor",
  );
  const make = mock(impl);
  Object.defineProperty(OpenCode, "make", {
    value: make,
    enumerable: descriptor.enumerable ?? false,
    configurable: true,
    writable: true,
  });
  return {
    make,
    restore: (): void => {
      Object.defineProperty(OpenCode, "make", descriptor);
    },
  };
}

test("explicit V2 host URLs reject embedded credentials and non-loopback HTTP", () => {
  expect(() => validateHostEndpoint(HTTP_URL_WITH_USERINFO)).toThrow(
    "without embedded credentials",
  );
  expect(() => validateHostEndpoint("http://example.invalid:4096/")).toThrow(
    "outside loopback require HTTPS",
  );
  expect(validateHostEndpoint("http://127.0.0.1:4096/").href).toBe(
    "http://127.0.0.1:4096/",
  );
  expect(validateHostEndpoint("https://example.invalid/").href).toBe(
    "https://example.invalid/",
  );
});

test("explicit V2 host connection rejects missing authentication", async () => {
  process.env[hostUrl] = "http://127.0.0.1:4096/";
  delete process.env[password];
  delete process.env[legacyPassword];
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("requires OPENCODE_PASSWORD");
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

test("registered V2 host connection rejects missing authentication", async () => {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  await writeFile(
    join(root, "opencode", "service.json"),
    JSON.stringify({
      version: "2.0.3",
      url: "http://127.0.0.1:4096/",
      pid: process.pid,
    }),
  );
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("does not contain authentication");
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("V2 host connection rejects an instance identity mismatch", async () => {
  process.env[hostUrl] = "http://127.0.0.1:4096/";
  process.env[password] = "synthetic-host-password";
  const { make, restore } = stubMake(() => fakeClient("another-instance"));
  try {
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("does not belong to this host generation");
    expect(make).toHaveBeenCalledTimes(1);
  } finally {
    restore();
  }
});

test("V2 host transport retries only missing session wait endpoints with the legacy route", async () => {
  const paths: string[] = [];
  const delegate = mock(async (input: RequestInfo | URL) => {
    const path = new URL(
      input instanceof Request ? input.url : input.toString(),
    ).pathname;
    paths.push(path);
    return new Response(null, {
      status: path.startsWith("/api/experimental/session/ses_legacy/")
        ? 404
        : 204,
    });
  }) as unknown as typeof globalThis.fetch;
  const fetch = hostCompatibleFetch(delegate);
  await fetch(
    new URL("http://127.0.0.1:4096/api/experimental/session/ses_current/wait"),
  );
  await fetch(
    new URL("http://127.0.0.1:4096/api/experimental/session/ses_legacy/wait"),
  );
  expect(paths).toEqual([
    "/api/experimental/session/ses_current/wait",
    "/api/experimental/session/ses_legacy/wait",
    "/api/session/ses_legacy/wait",
  ]);
});

test("V2 host connection falls back to a compatible registered service", async () => {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  await writeFile(
    join(root, "opencode", "service.json"),
    JSON.stringify({
      version: "2.0.3",
      url: "http://127.0.0.1:4096/",
      pid: process.pid,
      password: "synthetic-service-password",
    }),
  );
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await connectV2Host(
      "/workspace",
      "expected",
      "2.0.3",
      AbortSignal.timeout(1000),
    );
    expect(make).toHaveBeenCalledTimes(1);
    const options = (
      make.mock.calls as unknown as Array<[Parameters<typeof OpenCode.make>[0]]>
    )[0]?.[0];
    expect(options).toMatchObject({
      baseUrl: "http://127.0.0.1:4096/",
      headers: {
        authorization: `Basic ${Buffer.from("opencode:synthetic-service-password").toString("base64")}`,
      },
    });
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("registered V2 services must be local and belong to a live process", async () => {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  const registration = join(root, "opencode", "service.json");
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await writeFile(
      registration,
      JSON.stringify({
        version: "2.0.3",
        url: "https://example.invalid/",
        pid: process.pid,
        password: "synthetic-service-password",
      }),
    );
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("must use a loopback address");

    await writeFile(
      registration,
      JSON.stringify({
        version: "2.0.3",
        url: "http://127.0.0.1:4096/api?redirect=external",
        pid: process.pid,
        password: "synthetic-service-password",
      }),
    );
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("must be a loopback origin");

    await writeFile(
      registration,
      JSON.stringify({
        version: "2.0.3",
        url: "http://127.0.0.1:4096/",
        pid: 0,
        password: "synthetic-service-password",
      }),
    );
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("invalid process ID");

    await writeFile(
      registration,
      JSON.stringify({
        version: "2.0.3",
        url: "http://127.0.0.1:4096/",
        pid: 2_147_483_647,
        password: "synthetic-service-password",
      }),
    );
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("process that is not running");
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("registered V2 services from another patch release of the host are accepted", async () => {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  await writeFile(
    join(root, "opencode", "service.json"),
    JSON.stringify({
      version: "2.0.4",
      url: "http://127.0.0.1:4096/",
      pid: process.pid,
      password: "synthetic-service-password",
    }),
  );
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await connectV2Host(
      "/workspace",
      "expected",
      "2.0.3",
      AbortSignal.timeout(1000),
    );
    expect(make).toHaveBeenCalledTimes(1);
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("registered V2 services from another minor release are rejected with both versions", async () => {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  await writeFile(
    join(root, "opencode", "service.json"),
    JSON.stringify({
      version: "2.1.0",
      url: "http://127.0.0.1:4096/",
      pid: process.pid,
      password: "synthetic-service-password",
    }),
  );
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow(
      /does not match this host version: the registered service is OpenCode 2\.1\.0, this host is 2\.0\.3/,
    );
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("registered V2 services with an unparseable version are rejected", async () => {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  await writeFile(
    join(root, "opencode", "service.json"),
    JSON.stringify({
      version: "latest",
      url: "http://127.0.0.1:4096/",
      pid: process.pid,
      password: "synthetic-service-password",
    }),
  );
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("does not match this host version");
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("isCompatibleHostVersion accepts the same major.minor across patches", () => {
  expect(isCompatibleHostVersion("2.1.1", "2.1.2")).toBe(true);
  expect(isCompatibleHostVersion("2.1.2", "2.1.1")).toBe(true);
});

test("isCompatibleHostVersion rejects a different major or minor", () => {
  expect(isCompatibleHostVersion("2.0.3", "2.1.0")).toBe(false);
  expect(isCompatibleHostVersion("3.1.1", "2.1.1")).toBe(false);
});

test("isCompatibleHostVersion rejects non-string and unparseable versions", () => {
  expect(isCompatibleHostVersion(undefined, "2.1.1")).toBe(false);
  expect(isCompatibleHostVersion(211, "2.1.1")).toBe(false);
  expect(isCompatibleHostVersion("x", "2.1.1")).toBe(false);
});

test("V2 host transport passes other routes through and retries a 405 wait with the original request", async () => {
  const seen: Array<{ input: RequestInfo | URL; method?: string }> = [];
  const delegate = mock(async (input: RequestInfo | URL) => {
    seen.push({
      input,
      ...(input instanceof Request ? { method: input.method } : {}),
    });
    const path = new URL(
      input instanceof Request ? input.url : input.toString(),
    ).pathname;
    if (path === "/api/experimental/session/ses_old/wait")
      return new Response("missing", { status: 405 });
    if (path === "/api/experimental/session/ses_broken/wait")
      return new Response(null, { status: 500 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  const fetch = hostCompatibleFetch(delegate);
  const other = new URL("http://127.0.0.1:4096/api/session/ses_main");
  await fetch(other);
  expect(seen[0]?.input).toBe(other);
  const broken = await fetch(
    "http://127.0.0.1:4096/api/experimental/session/ses_broken/wait",
  );
  expect(broken.status).toBe(500);
  expect(seen).toHaveLength(2);
  const request = new Request(
    "http://127.0.0.1:4096/api/experimental/session/ses_old/wait",
    { method: "POST" },
  );
  const retried = await fetch(request);
  expect(retried.status).toBe(204);
  expect(seen).toHaveLength(4);
  expect(seen[2]?.input).not.toBe(request);
  expect(seen[2]?.method).toBe("POST");
  const legacy = seen[3]?.input;
  expect(legacy).toBeInstanceOf(Request);
  expect((legacy as Request).url).toBe(
    "http://127.0.0.1:4096/api/session/ses_old/wait",
  );
  expect(seen[3]?.method).toBe("POST");
});

async function registeredServiceError(
  contents: string | undefined,
): Promise<string | undefined> {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  if (contents !== undefined)
    await writeFile(join(root, "opencode", "service.json"), contents);
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    const error = await connectV2Host(
      "/workspace",
      "expected",
      "2.0.3",
      AbortSignal.timeout(1000),
    ).then(
      () => undefined,
      (reason: unknown) => reason as Error,
    );
    expect(make).not.toHaveBeenCalled();
    return error?.message;
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
}

test("registered V2 service registrations fail closed on a missing, unreadable or malformed file", async () => {
  const valid = {
    version: "2.0.3",
    url: "http://127.0.0.1:4096/",
    pid: process.pid,
    password: "synthetic-service-password",
  };
  const cases: Array<[string | undefined, string]> = [
    [
      undefined,
      "Reviewer host connection unavailable: use the registered service or configure OPENCODE_PERMISSION_REVIEWER_HOST_URL and OPENCODE_PASSWORD",
    ],
    ["{", "Reviewer service registration is not valid JSON"],
    ["null", "Reviewer service registration is invalid"],
    ['"service"', "Reviewer service registration is invalid"],
    [
      JSON.stringify({ ...valid, url: 4096 }),
      "Reviewer service registration does not contain a URL",
    ],
    [
      JSON.stringify({ ...valid, password: "" }),
      "Reviewer service registration does not contain authentication",
    ],
  ];
  for (const [contents, message] of cases) {
    // Sequential: each case points the process-wide XDG_STATE_HOME at its own root and stubs the shared client factory.
    expect(await registeredServiceError(contents)).toBe(message);
  }
});

test("registered V2 service read errors other than a missing file propagate", async () => {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode", "service.json"), { recursive: true });
  try {
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.3",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ code: "EISDIR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
