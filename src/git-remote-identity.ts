// Git remote identity: classifies remote operands, redacts credential userinfo and derives comparable repository identities.

/** A remote operand can be a configured remote name, a literal URL, an
 *  SCP-like `user@host:path` target, or a local path. Only syntactic
 *  classification happens here; configured names are resolved to URLs later,
 *  inside the containment envelope. */
export function remoteOperandKind(value: string): "literal" | "name" {
  if (value.includes("://")) return "literal";
  if (value.startsWith("/")) return "literal";
  // SCP-like user@host:path: a colon before any slash with a user@host pair
  // before it. A plain "branch:ref" refspec has no "@", so it stays a name
  // and is later reported as unmatched by the configured-remote list.
  const colon = value.indexOf(":");
  if (colon > 0 && /^[^/@\s]+@[^/@\s]+$/.test(value.slice(0, colon)))
    return "literal";
  return "name";
}

/** Remote URLs may embed credential userinfo, including a token in the username
 *  slot with no password. None of it belongs in reviewer evidence. SCP-style
 *  `git@host:path` values have no scheme and stay untouched. */
export function sanitizeRemoteUrl(url: string): string {
  // Redact before bounding: truncating first can remove the closing @ and
  // leave a credential prefix that no longer matches the userinfo pattern.
  return url
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)(?::[^\s/@]*)?@/gi,
      "$1<redacted>@",
    )
    .slice(0, 500);
}

/** Equate only documented GitHub transports; other destinations require exact URLs. */
export function repositoryIdentity(value: string): string | undefined {
  if (value.length >= 200 || /[%\\]|(?:^|\/)\.{1,2}(?:\/|$)/.test(value))
    return;
  const scpPath = value.match(/^git@github\.com:([^\s?#]+)$/i)?.[1];
  const located =
    scpPath === undefined ? urlRepositoryPath(value) : { path: scpPath };
  if (!("path" in located)) return located.identity;
  const normalized = located.path
    .replace(/\/$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  return /^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(normalized)
    ? `github:${normalized}`
    : undefined;
}

/** The GitHub repository path of a URL on a documented GitHub transport, or
 *  the identity of any other value: exact for a non-GitHub (or unparseable)
 *  destination, none for an unsupported GitHub one. */
function urlRepositoryPath(
  value: string,
): { path: string } | { identity: string | undefined } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { identity: `exact:${value}` };
  }
  if (url.hostname.toLowerCase() !== "github.com")
    return { identity: `exact:${value}` };
  if (url.search || url.hash || !isGithubTransport(url))
    return { identity: undefined };
  return { path: url.pathname.replace(/^\//, "") };
}

function isGithubTransport(url: URL): boolean {
  return (
    (url.protocol === "https:" && (url.port === "" || url.port === "443")) ||
    (url.protocol === "ssh:" &&
      url.username === "git" &&
      (url.port === "" || url.port === "22"))
  );
}
