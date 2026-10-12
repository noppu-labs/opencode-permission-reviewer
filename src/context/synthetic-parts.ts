// Host-authored text parts in user-role messages: one check shared by the prompt sections and intent resolution.

const SYNTHETIC_TEXT =
  /^\s*(?:Magic Compact:|You have \d+ weighted tokens left)/i;

/** A text part the host injected into a user-role message, never human text.
 *  The part's own `synthetic`/`ignored` flags decide first; otherwise the text
 *  counts as host-authored when it starts, after leading whitespace, with
 *  `Magic Compact:` or `You have <n> weighted tokens left` in any letter case.
 *  Parts that are not text are never synthetic. */
export function isSyntheticPart(part: Record<string, unknown>): boolean {
  if (part.type !== "text" || typeof part.text !== "string") return false;
  if (part.synthetic === true || part.ignored === true) return true;
  return SYNTHETIC_TEXT.test(part.text);
}
