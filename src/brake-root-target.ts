import { elementAt } from "./element-at.ts";
import { type ShellToken, tokenCharIsQuoted } from "./shell-token.ts";

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
 * `//**`): the shell expands it before rm runs, so `rm -rf /*` destroys the
 * system exactly like `rm -rf /`. The star is only an operator while its
 * characters sit in an UNQUOTED span: `"/"*` still globs (only the slash is
 * quoted), while `'/*'` or `/\*` name a literal file and stay with the
 * reviewer. Trailing `*` and `**` both count: without globstar, `**`
 * behaves like `*` at the root level.
 */
export function isLiveRootGlob(token: ShellToken): boolean {
  if (!token.value.startsWith("/")) return false;
  const components = token.value.split("/");
  const last = elementAt(components, components.length - 1, "components");
  if (!/^\*+$/.test(last)) return false;
  const starStart = token.value.length - last.length;
  if (tokenCharIsQuoted(token, starStart)) return false;
  return componentsReachRoot(components.slice(0, -1));
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
