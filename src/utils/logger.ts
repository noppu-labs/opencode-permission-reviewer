/** A diagnostic log sink: a message and optional structured details. */
export type Logger = (message: string, details?: unknown) => void;
