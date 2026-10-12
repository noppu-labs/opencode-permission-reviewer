// Host-authored text parts in user-role messages: one check shared by the prompt sections and intent resolution.

const SYNTHETIC_TEXT =
  /^\s*(?:Magic Compact:|You have \d+ weighted tokens left)/i;

/** Host-authored text in a user-role message is never human authorization.
 *  The part's `synthetic`/`ignored` flags decide first; the text patterns are
 *  a fallback for hosts that do not set them. */
export function isSyntheticPart(part: Record<string, unknown>): boolean {
  if (part.type !== "text" || typeof part.text !== "string") return false;
  if (part.synthetic === true || part.ignored === true) return true;
  return SYNTHETIC_TEXT.test(part.text);
}
