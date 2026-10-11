import type { Redirection } from "./capability/capability-types.ts";
import { type ShellToken, tokenCharIsQuoted } from "./shell-token.ts";

/**
 * Whitelist of real block-device path prefixes so that pseudo-devices
 * (`/dev/null`, `/dev/zero`, `/dev/shm/…`, `/dev/fd/…`, etc.) — which sit under
 * `/dev/` but are not disks — do not trip the brake on legitimate patterns
 * like `dd … of=/dev/null` or `shred /dev/shm/scratch`.
 */
const BLOCK_DEVICE_RE =
  /^\/dev\/(?:sd|hd|vd|xvd|nvme|mmcblk|loop|md|dm-|zram|drbd|bcache|mapper\/|disk\/by-)/;

const WRITE_OPERATORS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);

interface RedirectOperator {
  start: number;
  length: number;
}

export function isBlockDeviceTarget(value: string): boolean {
  return BLOCK_DEVICE_RE.test(value);
}

/** Shell redirection onto a real block device: `> /dev/sda` (or `>>`, `>|`,
 *  an fd-prefixed `2>/dev/sda`, a word-glued `x>/dev/sdc`, or the operator
 *  ending its own token as in `echo x> /dev/sda`) overwrites a disk regardless
 *  of which executable produced the bytes. Only the `>` operator itself must
 *  sit in an unquoted span: quoting part of the TARGET changes nothing about
 *  which file it names (`>"/dev/sda"` and `>/dev/"sda"` redirect to the disk),
 *  while a quoted operator (`echo 'x > /dev/sda'`) is data. */
export function redirectTargetsBlockDevice(
  tokens: readonly ShellToken[],
): boolean {
  return tokens.some((token, index) =>
    unquotedRedirectOperators(token).some((operator) => {
      const target = redirectTarget(token, operator, tokens[index + 1]);
      return target !== undefined && isBlockDeviceTarget(target);
    }),
  );
}

/** A normalized redirection that opens a real block device for writing. */
export function redirectionWritesBlockDevice(
  redirection: Redirection,
): boolean {
  const operator = redirection.operator.replace(/^\d+/, "");
  const writes =
    WRITE_OPERATORS.has(operator) ||
    (operator === ">&" &&
      redirection.target !== "-" &&
      !/^\d+$/.test(redirection.target));
  return writes && isBlockDeviceTarget(redirection.target);
}

/** The rest of the token after the operator, or the next token when the
 *  operator ends its own token. */
function redirectTarget(
  token: ShellToken,
  operator: RedirectOperator,
  next: ShellToken | undefined,
): string | undefined {
  const rest = token.value.slice(operator.start + operator.length);
  return rest.length > 0 ? rest : next?.value;
}

/** Positions and lengths of `>` / `>>` redirect operators whose `>` characters
 *  are all unquoted. The normalized redirection pass handles compound forms
 *  such as `>|` and `&>` separately. */
function unquotedRedirectOperators(token: ShellToken): RedirectOperator[] {
  const out: RedirectOperator[] = [];
  const value = token.value;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ">") continue;
    if (tokenCharIsQuoted(token, index)) continue;
    const doubled =
      value[index + 1] === ">" && !tokenCharIsQuoted(token, index + 1);
    out.push({ start: index, length: doubled ? 2 : 1 });
    index += doubled ? 1 : 0;
  }
  return out;
}
