/** Reads an untrusted host value as a property bag, or undefined. */
export const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
