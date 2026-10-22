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
        "2.0.22",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("requires OPENCODE_PASSWORD");
    expect(make).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

const SERVICE_URL = "http://127.0.0.1:4096/";
const SERVICE_PASSWORD = "synthetic-service-password";

/** A registration for a live loopback service, with `overrides` applied. */
function registration(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "2.0.22",
    url: SERVICE_URL,
    pid: process.pid,
    password: SERVICE_PASSWORD,
    ...overrides,
  };
}

/** Runs `check` with `service.json` holding `entry` under a temporary XDG
 *  state home and `OpenCode.make` stubbed to a client whose identity is
 *  `identity`, then `onMake` with the stub. */
async function withRegisteredService(
  entry: Record<string, unknown>,
  identity: string,
  check: (connect: () => Promise<unknown>) => Promise<void>,
  onMake: (make: Mock<() => OpenCodeClient>) => void,
): Promise<void> {
  delete process.env[hostUrl];
  const root = await mkdtemp(join(tmpdir(), "reviewer-v2-service-"));
  process.env[stateHome] = root;
  await mkdir(join(root, "opencode"));
  await writeFile(
    join(root, "opencode", "service.json"),
    JSON.stringify(entry),
  );
  const { make, restore } = stubMake(() => fakeClient(identity));
  try {
    await check(() =>
      connectV2Host(
        "/workspace",
        "expected",
        "2.0.22",
        AbortSignal.timeout(1000),
      ),
    );
    onMake(make);
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
}

const notCalled = (make: Mock<() => OpenCodeClient>): void => {
  expect(make).not.toHaveBeenCalled();
};

test.each([
  [
    "missing authentication",
    { password: undefined },
    "does not contain authentication",
  ],
  [
    "a non-loopback URL",
    { url: "https://example.invalid/" },
    "must use a loopback address",
  ],
  [
    "a URL that is not an origin",
    { url: "http://127.0.0.1:4096/api?redirect=external" },
    "must be a loopback origin",
  ],
  ["an invalid process ID", { pid: 0 }, "invalid process ID"],
  [
    "a process that is not running",
    { pid: 2_147_483_647 },
    "process that is not running",
  ],
  [
    "an unparseable version",
    { version: "latest" },
    "does not match this host version",
  ],
  [
    "a version from another minor release",
    { version: "2.1.0" },
    /does not match this host version: the registered service is OpenCode 2\.1\.0, this host is 2\.0\.22\. Run "opencode service restart"/,
  ],
  [
    "a non-string version",
    { version: { major: 2 } },
    /the registered service is OpenCode an unrecognised version, this host is 2\.0\.22/,
  ],
] as const)(
  "registered V2 services with %s are rejected",
  async (_label, overrides, expected) => {
    await withRegisteredService(
      registration(overrides),
      "expected",
      async (connect) => {
        await expect(connect()).rejects.toThrow(expected);
      },
      notCalled,
    );
  },
);

test.each([
  ["the host's own release", "2.0.22"],
  ["another patch release of the host", "2.0.23"],
])(
  "registered V2 services from %s are accepted with their credentials",
  async (_label, version) => {
    await withRegisteredService(
      registration({ version }),
      "expected",
      async (connect) => {
        await connect();
      },
      (make) => {
        expect(make).toHaveBeenCalledTimes(1);
        const options = (
          make.mock.calls as unknown as Array<
            [Parameters<typeof OpenCode.make>[0]]
          >
        )[0]?.[0];
        expect(options).toMatchObject({
          baseUrl: SERVICE_URL,
          headers: {
            authorization: `Basic ${Buffer.from(`opencode:${SERVICE_PASSWORD}`).toString("base64")}`,
          },
        });
      },
    );
  },
);

test("registered V2 host identity mismatch names the registered service", async () => {
  await withRegisteredService(
    registration(),
    "another-instance",
    async (connect) => {
      const error = await connect().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      const message = String((error as Error).message);
      expect(message).toContain("does not belong to this host generation");
      expect(message).toContain(
        `the registered OpenCode service at ${SERVICE_URL}`,
      );
      expect(message).toContain("OPENCODE_PERMISSION_REVIEWER_HOST_URL");
      expect(message).not.toContain(SERVICE_PASSWORD);
    },
    (make) => {
      expect(make).toHaveBeenCalledTimes(1);
    },
  );
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

test("isCompatibleHostVersion accepts the same major.minor across patches", () => {
  expect(isCompatibleHostVersion("2.1.1", "2.1.2")).toBe(true);
  expect(isCompatibleHostVersion("2.1.2", "2.1.1")).toBe(true);
});

test("isCompatibleHostVersion rejects a different major or minor", () => {
  expect(isCompatibleHostVersion("2.0.22", "2.1.0")).toBe(false);
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
      "2.0.22",
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
    version: "2.0.22",
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
        "2.0.22",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ code: "EISDIR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
