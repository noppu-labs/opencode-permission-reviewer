// An ssh destination word split into user, host and port, as OpenSSH's `ssh.c` and `misc.c` split it.

export interface SshDestinationParts {
  user?: string;
  host: string;
  port?: string;
}

/** The parts of an ssh destination word. `ssh://[user@]host[:port][/path]` is
 *  a URI (`parse_uri`): its user ends at the first `@` and at a `;`, and may
 *  be percent-encoded. A URI `ssh` rejects (a bad escape, an empty user or
 *  host) is read whole as the host, with no user. Any other word is
 *  `[user@]host` with the user ending at the last `@`. */
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
  const user = at < 0 ? undefined : urlDecode(info);
  const parsed = /^(?:\[([^\]]*)\]|([^:/]*))(?::([^/]*))?/.exec(
    rest.slice(at + 1),
  );
  const host = parsed?.[1] ?? parsed?.[2];
  if (!host || (at >= 0 && (info === "" || user === undefined))) return;
  const port = parsed?.[3];
  return {
    ...(user === undefined ? {} : { user }),
    host,
    ...(port && /^\d+$/.test(port) ? { port } : {}),
  };
}

const PERCENT_ESCAPE = /(%[0-9A-Fa-f]{2})/;

/** `urldecode` in `misc.c`: `+` is a space and `%XX` is a byte; a `%` without
 *  two hex digits, or an escaped zero byte, rejects the whole URI. */
function urlDecode(text: string): string | undefined {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (const [index, part] of text
    .replaceAll("+", " ")
    .split(PERCENT_ESCAPE)
    .entries()) {
    if (index % 2 === 1) bytes.push(Number.parseInt(part.slice(1), 16));
    else if (part.includes("%")) return;
    else for (const byte of encoder.encode(part)) bytes.push(byte);
  }
  if (bytes.includes(0)) return;
  return new TextDecoder().decode(Uint8Array.from(bytes));
}
