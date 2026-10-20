// An ssh destination word split into user, host and port, as OpenSSH's `ssh.c` and `misc.c` split it.

export interface SshDestinationParts {
  user?: string;
  host: string;
  port?: string;
}

/** The parts of an ssh destination word. `ssh://[user@]host[:port][/path]` is
 *  a URI (`parse_uri`): its user ends at the first `@` and at a `;`, and may
 *  be percent-encoded. Any other word is `[user@]host` with the user ending at
 *  the last `@`. */
export function sshDestinationHost(word: string): SshDestinationParts {
  if (!word.startsWith("ssh://")) return plainDestination(word);
  return uriDestination(word.slice("ssh://".length)) ?? { host: word };
}

function plainDestination(word: string): SshDestinationParts {
  const at = word.lastIndexOf("@");
  if (at <= 0) return { host: word };
  return { user: word.slice(0, at), host: word.slice(at + 1) };
}

function uriDestination(rest: string): SshDestinationParts | undefined {
  const at = rest.indexOf("@");
  const info = at < 0 ? "" : (rest.slice(0, at).split(";")[0] ?? "");
  const parsed = /^(?:\[([^\]]*)\]|([^:/]*))(?::([^/]*))?/.exec(
    rest.slice(at + 1),
  );
  const host = parsed?.[1] ?? parsed?.[2];
  if (!host || (at >= 0 && info === "")) return;
  const port = parsed?.[3];
  return {
    ...(at < 0 ? {} : { user: urlDecode(info) }),
    host,
    ...(port && /^\d+$/.test(port) ? { port } : {}),
  };
}

function urlDecode(text: string): string {
  try {
    return decodeURIComponent(text.replaceAll("+", " "));
  } catch {
    return text;
  }
}
