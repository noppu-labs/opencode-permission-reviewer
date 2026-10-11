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
 *  ext family and `-N` only for mkfs.xfs. */
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
  return isExtFormatter(base, args) ? "-n" : undefined;
}

/** mke2fs, mkfs.ext2/3/4, or plain mkfs that builds an ext filesystem. */
function isExtFormatter(base: string, args: readonly ShellToken[]): boolean {
  if (EXT_FORMATTERS.has(base)) return true;
  if (base !== "mkfs") return false;
  const type = mkfsTypeOption(args);
  return type === undefined || EXT_FILESYSTEM_TYPES.has(type);
}

/** The filesystem type of the last type option of plain mkfs, or undefined
 *  when none is given. A type option whose value cannot be read gives "". */
function mkfsTypeOption(args: readonly ShellToken[]): string | undefined {
  let type: string | undefined;
  args.forEach((_token, index) => {
    type = mkfsTypeValue(args, index) ?? type;
  });
  return type;
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
