/** Assert a fact the surrounding code already guarantees but the compiler
 *  cannot see, such as an element read at an index the loop bound keeps in
 *  range. Narrows `condition` for the code that follows. A broken guarantee
 *  is a bug, so it throws instead of carrying `undefined` forward.
 *  It tests truthiness: for a value that can legitimately be `""` or `0`, pass
 *  `value !== undefined`, never the bare value. */
export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
