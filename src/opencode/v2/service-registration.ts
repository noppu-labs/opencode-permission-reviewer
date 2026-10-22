// The host's registered service (`opencode/service.json` under the XDG state
// directory), read without starting a host and trusted only for this host
// version and a live process. The caller validates the URL it names.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "semver";

export interface ServiceEndpoint {
  url: string;
  password: string;
}

interface Registration {
  version?: unknown;
  url?: unknown;
  pid?: unknown;
  password?: unknown;
}

function assertLiveProcess(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error(
      "Reviewer service registration contains an invalid process ID",
    );
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM")
      throw new Error(
        "Reviewer service registration belongs to a process that is not running",
        {
          cause: error,
        },
      );
  }
}

function registrationPath(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "opencode",
    "service.json",
  );
}

/** The registration text, or undefined when no service is registered. */
function readRegistration(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

function parseRegistration(text: string): Registration {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Reviewer service registration is not valid JSON");
  }
  if (typeof value !== "object" || value === null)
    throw new Error("Reviewer service registration is invalid");
  return value as Registration;
}

/** Whether a service registered by OpenCode `registered` can serve host
 *  `host`: both valid semver versions with the same major and minor. */
export function isCompatibleHostVersion(
  registered: unknown,
  host: string,
): boolean {
  if (typeof registered !== "string") return false;
  const registeredSemver = parse(registered);
  const hostSemver = parse(host);
  return (
    registeredSemver !== null &&
    hostSemver !== null &&
    registeredSemver.major === hostSemver.major &&
    registeredSemver.minor === hostSemver.minor
  );
}

function registeredService(
  info: Registration,
  version: string,
): ServiceEndpoint {
  if (!isCompatibleHostVersion(info.version, version))
    throw new Error(
      `Reviewer service registration does not match this host version: the registered service is OpenCode ${String(info.version)}, this host is ${version}. Run "opencode service restart", or set OPENCODE_PERMISSION_REVIEWER_HOST_URL and OPENCODE_PASSWORD for the server running this plugin`,
    );
  if (typeof info.url !== "string")
    throw new Error("Reviewer service registration does not contain a URL");
  if (typeof info.password !== "string" || info.password.length === 0)
    throw new Error(
      "Reviewer service registration does not contain authentication",
    );
  assertLiveProcess(info.pid as number);
  return { url: info.url, password: info.password };
}

/** The registered service for this host version with its URL as written, or
 *  undefined when no service is registered. */
export async function readRegisteredService(
  version: string,
): Promise<ServiceEndpoint | undefined> {
  const text = await readRegistration(registrationPath());
  if (text === undefined) return undefined;
  return registeredService(parseRegistration(text), version);
}
