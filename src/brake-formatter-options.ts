import {
  MKFS_FAT_LONG_OPTIONS,
  MKFS_LONG_OPTIONS,
  MKFS_XFS_LONG_OPTIONS,
  MKNTFS_LONG_OPTIONS,
} from "./gnu-long-option-tables.ts";
import { type LongOption, resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

/** A formatter's getopt surface, and the short letter that makes it a dry
 *  run. */
export interface FormatterOptions {
  readonly optstring: string;
  readonly longOptions: readonly LongOption[];
  readonly dryRunLetter?: string;
}

/** e2fsprogs mke2fs (misc/mke2fs.c `PRS`), which has no long options. */
const MKE2FS: FormatterOptions = {
  optstring: "b:cd:e:g:i:jl:m:no:qr:s:t:vC:DE:FG:I:J:KL:M:N:O:R:ST:U:Vz:",
  longOptions: [],
  dryRunLetter: "n",
};

/** xfsprogs mkfs.xfs (mkfs/xfs_mkfs.c `MKFS_GETOPT_STRING`). */
const MKFS_XFS: FormatterOptions = {
  optstring: "b:c:d:i:l:L:m:n:KNp:qr:s:CfV",
  longOptions: MKFS_XFS_LONG_OPTIONS,
  dryRunLetter: "N",
};

/** ntfs-3g mkntfs (ntfsprogs/mkntfs.c `sopt`). */
const MKNTFS: FormatterOptions = {
  optstring: "-c:CfFhH:IlL:np:qQs:S:TUvVz:",
  longOptions: MKNTFS_LONG_OPTIONS,
  dryRunLetter: "n",
};

/** dosfstools mkfs.fat (src/mkfs.fat.c), which has no dry-run option. */
const MKFS_FAT: FormatterOptions = {
  optstring: "aAb:cCf:D:F:g:Ii:l:m:M:n:r:R:s:S:h:v",
  longOptions: MKFS_FAT_LONG_OPTIONS,
};

const FORMATTERS = new Map<string, FormatterOptions>([
  ["mke2fs", MKE2FS],
  ["mkfs.ext2", MKE2FS],
  ["mkfs.ext3", MKE2FS],
  ["mkfs.ext4", MKE2FS],
  ["mkfs.xfs", MKFS_XFS],
  ["mkfs.ntfs", MKNTFS],
  ["mkfs.fat", MKFS_FAT],
  ["mkfs.vfat", MKFS_FAT],
  ["mkfs.msdos", MKFS_FAT],
]);

/** Plain mkfs reads its own options, then hands the rest to mke2fs. */
const MKFS_EXT: FormatterOptions = {
  ...MKE2FS,
  longOptions: MKFS_LONG_OPTIONS,
};

const EXT_FILESYSTEM_TYPES = new Set(["ext2", "ext3", "ext4"]);

/** The getopt surface of the formatter `base`, or `undefined` when it is
 *  not known. */
export function formatterOptions(
  base: string,
  args: readonly ShellToken[],
): FormatterOptions | undefined {
  if (base === "mkfs") return mkfsBuildsExt(args) ? MKFS_EXT : undefined;
  return FORMATTERS.get(base);
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

function shortTypeValue(word: string, next: string): string | undefined {
  if (!word.startsWith("-") || word.startsWith("--")) return undefined;
  const letter = word.indexOf("t");
  if (letter === -1) return undefined;
  return letter + 1 < word.length ? word.slice(letter + 1) : next;
}
