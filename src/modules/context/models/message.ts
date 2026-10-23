export interface MessageWithParts {
  info: Record<string, unknown> & {
    id?: string;
    role?: string;
    structured?: unknown;
  };
  parts: Array<Record<string, unknown>>;
}
