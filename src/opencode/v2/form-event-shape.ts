import type { OpenCodeEvent } from "@opencode/client";
import { isRecord } from "../../is-record.ts";

export type FormCreated = Extract<
  OpenCodeEvent,
  { type: "form.created" }
>["data"]["form"];
export type FormSettled = Extract<
  OpenCodeEvent,
  { type: "form.replied" } | { type: "form.cancelled" }
>;

const MAX_KEPT_FIELDS = 32;

function isOptional(
  value: unknown,
  check: (value: unknown) => boolean,
): boolean {
  return value === undefined || check(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOption(value: unknown): boolean {
  return isRecord(value) && isString(value.label) && isString(value.value);
}

function isField(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.key) &&
    isOptional(value.title, isString) &&
    isOptional(
      value.options,
      (options) => Array.isArray(options) && options.every(isOption),
    )
  );
}

/** A form whose id, session, title and kept fields have the shape the codec reads. */
export function formCreated(value: unknown): FormCreated | undefined {
  if (!isRecord(value)) return undefined;
  const { id, sessionID, title, fields } = value;
  if (!isString(id) || !isString(sessionID) || !isString(title))
    return undefined;
  if (!Array.isArray(fields) || fields.length === 0) return undefined;
  if (!fields.slice(0, MAX_KEPT_FIELDS).every(isField)) return undefined;
  return value as unknown as FormCreated;
}

/** A reply or cancellation whose id and session are strings, and whose answer
 *  is an object when it is a reply. */
export function formSettled(event: {
  type: string;
  data?: unknown;
}): FormSettled | undefined {
  const { data } = event;
  if (!isRecord(data) || !isString(data.id) || !isString(data.sessionID))
    return undefined;
  if (event.type === "form.replied" && !isRecord(data.answer)) return undefined;
  return event as FormSettled;
}
