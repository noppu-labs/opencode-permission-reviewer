// Prompt text bounding: redaction-aware truncation, middle elision, stable JSON and recency-first block budgets.

import { redactSecrets } from "../redact.ts";

export function truncate(value: string, max: number): string {
  // Redact secrets before measuring/truncating so a credential can never slip
  // through because its surrounding text was chopped at a budget boundary.
  const redacted = redactSecrets(value);
  if (redacted.length <= max) return redacted;
  const omitted = redacted.length - max;
  const marker = `\n<truncated characters="${omitted}" />`;
  return `${redacted.slice(0, Math.max(0, max - marker.length))}${marker.slice(0, max)}`;
}

/** Elide the middle of an over-long command, keeping head and tail: the head
 *  names the executable and flags, the tail carries trailing redirections and
 *  compound tails (`… ; rm -rf`), so both ends must reach the reviewer. */
export function elideMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const omitted = value.length - Math.floor(max * 0.8);
  const head = Math.floor(max * 0.5);
  const tail = Math.floor(max * 0.3);
  return `${value.slice(0, head)}<elided characters="${omitted}" />${value.slice(-tail)}`;
}

export function stableJson(value: unknown, max: number): string {
  try {
    const seen = new WeakSet<object>();
    const text = JSON.stringify(
      value,
      (_key, item) => {
        if (typeof item === "bigint") return item.toString();
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      },
      2,
    );
    return truncate(text ?? String(value), max);
  } catch {
    return truncate(String(value), max);
  }
}

export function keepMostRecentBlocks(
  blocks: string[],
  maxChars: number,
): string {
  const selected: string[] = [];
  let remaining = maxChars;
  for (const block of [...blocks].reverse()) {
    if (remaining <= 0) break;
    const separator = selected.length === 0 ? 0 : 2;
    if (remaining <= separator) break;
    const budget = remaining - separator;
    const redacted = redactSecrets(block);
    const bounded =
      redacted.length <= budget ? redacted : elideMiddle(redacted, budget);
    if (bounded.length > budget) break;
    selected.push(bounded);
    remaining -= bounded.length + separator;
  }
  return selected.reverse().join("\n\n");
}
