// Host-authored text in user-role messages: one synthetic-part check for the prompt sections, one for intent resolution.

function isSyntheticControlMessage(text: string): boolean {
  const normalized = text.trim();
  return (
    /^Magic Compact:\s*Compaction in progress/i.test(normalized) ||
    /^You have \d+ weighted tokens left/i.test(normalized)
  );
}

/** Host-authored text injected into a user-role message. Provenance comes from
 *  the part's own `synthetic`/`ignored` flags first; the text-pattern check is
 *  only a fallback for hosts that do not set the flags. */
export function isSyntheticPromptPart(part: Record<string, unknown>): boolean {
  if (part.type !== "text" || typeof part.text !== "string") return false;
  if (part.synthetic === true || part.ignored === true) return true;
  return isSyntheticControlMessage(part.text);
}

/** Host-authored text injected into a user-role message is never human
 *  authorization. Provenance comes from the part's own `synthetic`/`ignored`
 *  flags first; the text-pattern check is only a fallback for hosts that do
 *  not set them. This is the intent-resolution check; `isSyntheticPromptPart`
 *  is the prompt-section one. */
export function isSyntheticIntentPart(part: Record<string, unknown>): boolean {
  if (part.type !== "text" || typeof part.text !== "string") return false;
  if (part.synthetic === true || part.ignored === true) return true;
  return /^\s*(Magic Compact:|You have \d+ weighted tokens left)/.test(
    part.text,
  );
}
