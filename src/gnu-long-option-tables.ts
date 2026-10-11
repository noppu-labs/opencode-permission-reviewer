// src/gnu-long-option-tables.ts
import type { LongOption } from "./gnu-long-options.ts";

const none = (name: string): LongOption => ({ name, argument: "none" });
// exactOptionalPropertyTypes: aliases get their own helper instead of `id: undefined`.
const alias = (name: string, id: string): LongOption => ({
  name,
  argument: "none",
  id,
});
const required = (name: string): LongOption => ({ name, argument: "required" });
const optional = (name: string): LongOption => ({ name, argument: "optional" });

/** GNU coreutils `rm` (src/rm.c `long_opts`, including the hidden
 *  `---presume-input-tty` and the help/version entries). */
export const RM_LONG_OPTIONS: readonly LongOption[] = [
  { name: "force", argument: "none" },
  { name: "interactive", argument: "optional" },
  { name: "one-file-system", argument: "none" },
  { name: "no-preserve-root", argument: "none" },
  { name: "preserve-root", argument: "optional" },
  { name: "-presume-input-tty", argument: "none" },
  { name: "recursive", argument: "none" },
  { name: "dir", argument: "none" },
  { name: "verbose", argument: "none" },
  { name: "help", argument: "none" },
  { name: "version", argument: "none" },
];

/** util-linux wipefs (misc-utils/wipefs.c `longopts`). */
export const WIPEFS_LONG_OPTIONS: readonly LongOption[] = [
  none("all"),
  optional("backup"),
  none("force"),
  none("help"),
  optional("lock"),
  none("no-act"),
  required("offset"),
  none("parsable"),
  none("quiet"),
  required("types"),
  none("version"),
  none("json"),
  none("noheadings"),
  required("output"),
];

/** util-linux sfdisk (disk-utils/sfdisk.c `longopts`). */
export const SFDISK_LONG_OPTIONS: readonly LongOption[] = [
  none("activate"),
  none("append"),
  none("backup-pt-sectors"),
  none("backup"),
  required("backup-file"),
  none("bytes"),
  optional("color"),
  optional("lock"),
  none("delete"),
  none("dump"),
  none("help"),
  none("force"),
  none("json"),
  required("label"),
  required("label-nested"),
  none("list"),
  none("list-free"),
  none("list-types"),
  none("no-act"),
  none("no-device-names"),
  none("no-reread"),
  none("no-tell-kernel"),
  optional("move-data"),
  none("move-use-fsync"),
  required("output"),
  required("partno"),
  none("reorder"),
  required("sector-size"),
  none("show-geometry"),
  none("quiet"),
  none("verify"),
  none("version"),
  required("wipe"),
  required("wipe-partitions"),
  none("relocate"),
  none("part-uuid"),
  none("part-label"),
  none("part-type"),
  none("part-attrs"),
  none("discard-free"),
  none("disk-id"),
  none("show-pt-geometry"),
  required("unit"),
  none("Linux"),
  none("show-size"),
  none("change-id"),
  none("id"),
  none("print-id"),
];

/** GNU coreutils cp (src/cp.c `long_opts`). */
export const CP_LONG_OPTIONS: readonly LongOption[] = [
  none("archive"),
  none("attributes-only"),
  optional("backup"),
  none("copy-contents"),
  none("debug"),
  none("dereference"),
  none("force"),
  none("interactive"),
  none("link"),
  none("no-clobber"),
  none("no-dereference"),
  required("no-preserve"),
  none("no-target-directory"),
  none("one-file-system"),
  none("parents"),
  alias("path", "parents"),
  optional("preserve"),
  none("recursive"),
  none("remove-destination"),
  required("sparse"),
  optional("reflink"),
  none("strip-trailing-slashes"),
  required("suffix"),
  none("symbolic-link"),
  required("target-directory"),
  optional("update"),
  none("verbose"),
  none("keep-directory-symlink"),
  optional("context"),
  none("help"),
  none("version"),
];

/** GNU coreutils install (src/install.c `long_options`). */
export const INSTALL_LONG_OPTIONS: readonly LongOption[] = [
  optional("backup"),
  none("compare"),
  optional("context"),
  none("debug"),
  none("directory"),
  required("group"),
  required("mode"),
  none("no-target-directory"),
  required("owner"),
  none("preserve-timestamps"),
  none("preserve-context"),
  none("strip"),
  required("strip-program"),
  required("suffix"),
  required("target-directory"),
  none("verbose"),
  none("help"),
  none("version"),
];

/** util-linux mkfs front end (disk-utils/mkfs.c `longopts`). */
export const MKFS_LONG_OPTIONS: readonly LongOption[] = [
  required("type"),
  none("verbose"),
  none("version"),
  none("help"),
];
