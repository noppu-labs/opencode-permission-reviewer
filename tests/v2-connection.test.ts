import { afterEach, expect, type Mock, mock, test } from "bun:test";
import { Buffer } from "node:buffer";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import {
  connectV2Host,
  hostCompatibleFetch,
  resolveV2Host,
  validateHostEndpoint,
} from "../src/opencode/v2/connection.ts";
import { HTTP_URL_WITH_USERINFO } from "./fixtures/synthetic-secrets.ts";
import { defined } from "./helpers.ts";

const hostUrl = "OPENCODE_PERMISSION_REVIEWER_HOST_URL";
const password = "OPENCODE_PASSWORD";
const legacyPassword = "OPENCODE_SERVER_PASSWORD";
const originalEnv: Record<
  typeof hostUrl | typeof password | typeof legacyPassword,
  string | undefined
> = {
  [hostUrl]: process.env[hostUrl],
  [password]: process.env[password],
  [legacyPassword]: process.env[legacyPassword],
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
        "2.0.22",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("requires OPENCODE_PASSWORD");
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

test("explicit V2 host connection requires the host URL", async () => {
  delete process.env[hostUrl];
  process.env[password] = "synthetic-host-password";
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await expect(
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.22",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow(
      "Reviewer explicit host connection requires OPENCODE_PERMISSION_REVIEWER_HOST_URL",
    );
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

test("V2 host connection rejects an instance identity mismatch", async () => {
  process.env[hostUrl] = "http://127.0.0.1:4096/";
  process.env[password] = "synthetic-host-password";
  const { make, restore } = stubMake(() => fakeClient("another-instance"));
  try {
    let error: unknown;
    try {
      await connectV2Host(
        "/workspace",
        "expected",
        "2.0.22",
        AbortSignal.timeout(1000),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const message = String((error as Error).message);
    expect(message).toContain("does not belong to this host generation");
    expect(message).toContain(
      "http://127.0.0.1:4096/ from OPENCODE_PERMISSION_REVIEWER_HOST_URL",
    );
    expect(message).not.toContain("synthetic-host-password");
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

test("V2 host transport passes other routes through and retries a 405 wait with the original request", async () => {
  const paths: string[] = [];
  const delegate = mock(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === "/api/experimental/session/ses_405/wait")
      return new Response(null, { status: 405 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  const fetch = hostCompatibleFetch(delegate);
  const request = new Request(
    "http://127.0.0.1:4096/api/experimental/session/ses_405/wait",
    { method: "POST", headers: { "content-type": "application/json" } },
  );
  await fetch(request);
  expect(paths).toEqual([
    "/api/experimental/session/ses_405/wait",
    "/api/session/ses_405/wait",
  ]);
});

type FakeContext = { session: Record<string, unknown> } & Parameters<
  Plugin.Plugin["setup"]
>[0];

function fakeContext(): FakeContext & {
  calls: { sessionCreate: unknown[] };
} {
  const calls = { sessionCreate: [] as unknown[] };
  const ctx = {
    session: {
      create: (input?: unknown) => {
        calls.sessionCreate.push(input);
        return { id: "ses_in_process" };
      },
      get: async () => ({ id: "ses_in_process" }),
      context: async () => ({}),
      prompt: async () => ({}),
      wait: async () => ({}),
      interrupt: async () => {},
      remove: async () => {},
    },
    mcp: { list: async () => [] },
    model: {
      list: async () => {
        throw new Error("Reviewer host call requires the isolated location");
      },
    },
    plugin: { list: async () => [] },
  } as unknown as FakeContext;
  return { ...ctx, calls };
}

test("resolveV2Host uses the explicit host when the URL is set", async () => {
  process.env[hostUrl] = "http://127.0.0.1:4096/";
  process.env[password] = "synthetic-host-password";
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await resolveV2Host(
      fakeContext() as unknown as Parameters<Plugin.Plugin["setup"]>[0],
      "/workspace",
      "expected",
      "2.0.22",
      AbortSignal.timeout(1000),
    );
    expect(make).toHaveBeenCalledTimes(1);
    const options = (
      make.mock.calls as unknown as Array<[Parameters<typeof OpenCode.make>[0]]>
    )[0]?.[0];
    expect(options).toMatchObject({
      baseUrl: "http://127.0.0.1:4096/",
      headers: {
        authorization: `Basic ${Buffer.from("opencode:synthetic-host-password").toString("base64")}`,
      },
    });
  } finally {
    restore();
  }
});

test("resolveV2Host honors the legacy server password fallback", async () => {
  process.env[hostUrl] = "http://127.0.0.1:4096/";
  delete process.env[password];
  process.env[legacyPassword] = "legacy-server-password";
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    await resolveV2Host(
      fakeContext() as unknown as Parameters<Plugin.Plugin["setup"]>[0],
      "/workspace",
      "expected",
      "2.0.22",
      AbortSignal.timeout(1000),
    );
    const options = (
      make.mock.calls as unknown as Array<[Parameters<typeof OpenCode.make>[0]]>
    )[0]?.[0];
    expect(options).toMatchObject({
      headers: {
        authorization: `Basic ${Buffer.from("opencode:legacy-server-password").toString("base64")}`,
      },
    });
  } finally {
    restore();
  }
});

test("resolveV2Host rejects an identity mismatch via the explicit host", async () => {
  process.env[hostUrl] = "http://127.0.0.1:4096/";
  process.env[password] = "synthetic-host-password";
  const { make, restore } = stubMake(() => fakeClient("another-instance"));
  try {
    await expect(
      resolveV2Host(
        fakeContext() as unknown as Parameters<Plugin.Plugin["setup"]>[0],
        "/workspace",
        "expected",
        "2.0.22",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("does not belong to this host generation");
    expect(make).toHaveBeenCalledTimes(1);
  } finally {
    restore();
  }
});

test("resolveV2Host uses the in-process host when the URL is unset", async () => {
  delete process.env[hostUrl];
  const fake = fakeContext();
  const { make, restore } = stubMake(() => fakeClient("expected"));
  try {
    const host = await resolveV2Host(
      fake as unknown as Parameters<Plugin.Plugin["setup"]>[0],
      "/workspace",
      "expected",
      "2.0.22",
      AbortSignal.timeout(1000),
    );
    await host.session.create({ location: { directory: "/workspace" } });
    expect(fake.calls.sessionCreate).toEqual([
      { location: { directory: "/workspace" } },
    ]);
    await expect(host.model.list()).rejects.toThrow(
      "Reviewer host call requires the isolated location",
    );
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});
