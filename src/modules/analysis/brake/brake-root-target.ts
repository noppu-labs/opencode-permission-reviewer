import { elementAt } from "../../../utils/element-at.ts";
import { type ShellToken, tokenCharIsQuoted } from "../shell/shell-token.ts";

/** Whether a command operand names the filesystem root, literally or as a
 *  live glob over its entries. */
export function targetsRoot(token: ShellToken): boolean {
  return resolvesToRoot(token.value) || isLiveRootGlob(token);
}

/**
 * A literal target resolves to the filesystem root `/` after dropping trailing
 * `.`, `..`, and empty components. We do NOT touch variables, globs, command
 * substitutions, or backslash escapes (the lexer already produced the shell
 * value): those stay non-literal and out of the brake's remit, so `rm -rf '\/'`
 * is left untouched (it is a file literally named `\`-slash, not root).
 */
export function resolvesToRoot(rawTarget: string): boolean {
  if (!rawTarget.startsWith("/")) return false;
  return componentsReachRoot(rawTarget.split("/"));
}

/**
 * A live glob that expands to every entry of the filesystem root (`/*`,
 * `//**`): the shell expands it before rm runs, so `rm -rf /*` destroys
 * the system exactly like `rm -rf /`. The star is only an operator while its
 * characters sit in an UNQUOTED span: `"/"*` still globs (only the slash is
 * quoted), while `'/*'` or `/\*` name a literal file and stay with the
 * reviewer. Trailing `*` and `**` both count: without globstar, `**`
 * behaves like `*` at the root level. Trailing slashes after the star only
 * limit the matches to directories, so they do not change the target.
 */
export function isLiveRootGlob(token: ShellToken): boolean {
  if (!token.value.startsWith("/")) return false;
  const components = token.value.split("/");
  let end = components.length;
  while (end > 1 && elementAt(components, end - 1, "components") === "")
    end -= 1;
  const star = elementAt(components, end - 1, "components");
  if (!/^\*+$/.test(star)) return false;
  const trailingSlashes = components.length - end;
  if (
    tokenCharIsQuoted(token, token.value.length - trailingSlashes - star.length)
  )
    return false;
  return componentsReachRoot(components.slice(0, end - 1));
}

/** Whether absolute-path components lead back to `/` once empty and `.`
 *  components are dropped and each `..` removes the one before it. */
function componentsReachRoot(components: readonly string[]): boolean {
  const stack: string[] = [];
  for (const part of components) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length === 0;
}
