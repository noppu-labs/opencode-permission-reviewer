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

/** The value of the last `-t <type>` or `-t<type>` option of mkfs. */
function mkfsTypeOption(args: readonly ShellToken[]): string | undefined {
  let type: string | undefined;
  args.forEach(({ value }, index) => {
    if (value === "-t") type = args[index + 1]?.value;
    else if (value.startsWith("-t")) type = value.slice(2);
  });
  return type;
}
