import { MKFS_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

const EXT_FORMATTERS = new Set([
  "mke2fs",
  "mkfs.ext2",
  "mkfs.ext3",
  "mkfs.ext4",
]);
const EXT_FILESYSTEM_TYPES = new Set(["ext2", "ext3", "ext4"]);

/** mkfs / mkfs.* / mke2fs / mkswap, unless the tool's own dry-run flag is
 *  given. `--dry-run` suppresses the verdict for every tool; `-n` only for the
 *  ext family and mkfs.ntfs, and `-N` only for mkfs.xfs. */
export function formatDestroysDevice(
  base: string,
  args: readonly ShellToken[],
): boolean {
  const dryRunFlag = shortDryRunFlag(base, args);
  return !args.some((t) => t.value === "--dry-run" || t.value === dryRunFlag);
}

/** The short dry-run flag of a formatter, or undefined when it has none. */
function shortDryRunFlag(
  base: string,
  args: readonly ShellToken[],
): string | undefined {
  if (base === "mkfs.xfs") return "-N";
  if (base === "mkfs.ntfs") return "-n";
  return isExtFormatter(base, args) ? "-n" : undefined;
}

/** mke2fs, mkfs.ext2/3/4, or plain mkfs that builds an ext filesystem. */
function isExtFormatter(base: string, args: readonly ShellToken[]): boolean {
  if (EXT_FORMATTERS.has(base)) return true;
  return base === "mkfs" && mkfsBuildsExt(args);
}

/** Plain mkfs reads its own options (`-V`, `-t`, `-h` and the long options of
 *  its table) up to the first option it does not know or `--`; the last type
 *  there is the filesystem, none means the ext default. A type option past
 *  that point belongs to the filesystem tool, but a non-ext one still rules
 *  the ext default out. A type whose value cannot be read is non-ext. */
function mkfsBuildsExt(allArgs: readonly ShellToken[]): boolean {
  const end = allArgs.findIndex((t) => t.value === "--");
  const args = end === -1 ? allArgs : allArgs.slice(0, end);
  const stop = args.findIndex(isUnknownMkfsOption);
  const split = stop === -1 ? args.length : stop;
  const own = mkfsTypeValues(args, 0, split);
  const rest = mkfsTypeValues(args, split, args.length);
  return isExtType(own[own.length - 1]) && rest.every(isExtType);
}

function isExtType(type: string | undefined): boolean {
  return type === undefined || EXT_FILESYSTEM_TYPES.has(type);
}

function mkfsTypeValues(
  args: readonly ShellToken[],
  from: number,
  to: number,
): string[] {
  const values: string[] = [];
  for (let index = from; index < to; index += 1) {
    const value = mkfsTypeValue(args, index);
    if (value !== undefined) values.push(value);
  }
  return values;
}

/** An option word mkfs's own getopt does not recognise: a `--` name outside its
 *  table, or a short cluster with a letter other than `V` and `h` before any
 *  `t`. */
function isUnknownMkfsOption(token: ShellToken): boolean {
  const word = token.value;
  if (!word.startsWith("-") || word === "-") return false;
  if (word.startsWith("--"))
    return resolveGnuLongOption(word, MKFS_LONG_OPTIONS) === undefined;
  const letters = word.slice(1);
  const type = letters.indexOf("t");
  const own = type === -1 ? letters : letters.slice(0, type);
  return ![...own].every((letter) => letter === "V" || letter === "h");
}

/** The value taken by the type option at `index`: `--type[=]`, any prefix of
 *  it, or a short cluster containing `t` (the rest of the cluster, else the
 *  next word). Undefined when the word is not a type option. */
function mkfsTypeValue(
  args: readonly ShellToken[],
  index: number,
): string | undefined {
  const word = args[index]?.value ?? "";
  const next = args[index + 1]?.value ?? "";
  const long = resolveGnuLongOption(word, MKFS_LONG_OPTIONS);
  if (long === undefined) return shortTypeValue(word, next);
  if (long.name !== "type") return undefined;
  return long.inlineValue ? word.slice(word.indexOf("=") + 1) : next;
}

/** The type value of a short cluster containing `t`: the rest of the cluster
 *  after the letter, else the next word. */
function shortTypeValue(word: string, next: string): string | undefined {
  if (!word.startsWith("-") || word.startsWith("--")) return undefined;
  const letter = word.indexOf("t");
  if (letter === -1) return undefined;
  return letter + 1 < word.length ? word.slice(letter + 1) : next;
}
