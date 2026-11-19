/** Mutating forms of executables that are otherwise treated as read-only.
 *  "This executable usually only reads" must never become "this invocation
 *  only reads": find, sort, uniq, xxd, tree and yq all have forms that
 *  delete, write, or execute. */
export interface ReadOnlyToolMutation {
  deletion?: boolean;
  executesCode?: boolean;
  /** Paths written or (for -delete) destroyed, classified like any write. */
  writeTargets: string[];
}

/** Placeholder target when a mutating form names no operand: conservatively
 *  treated as a workspace write (the current directory). */
export const directoryFallback = ".";
