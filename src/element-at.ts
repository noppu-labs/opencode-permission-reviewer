import { invariant } from "./invariant.ts";

/** `items[index]` for an index the caller's loop bound keeps in range, in an
 *  array that holds no `undefined` elements. A miss is a broken guarantee, so
 *  it throws naming the array and the index. */
export function elementAt<T>(
  items: readonly T[],
  index: number,
  name: string,
): T {
  const item = items[index];
  invariant(
    item !== undefined,
    `${name}[${index}] is out of bounds (length ${items.length})`,
  );
  return item;
}
