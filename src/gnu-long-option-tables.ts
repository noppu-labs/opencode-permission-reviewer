// src/gnu-long-option-tables.ts
import type { LongOption } from "./gnu-long-options.ts";

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
