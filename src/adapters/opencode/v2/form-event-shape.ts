import type { OpenCodeEvent } from "@opencode/client";
import { isRecord } from "../../../utils/is-record.ts";

interface KeptOption {
  label: string;
  value: string;
}

export interface KeptField {
  key: string;
  title?: string | undefined;
  options?: KeptOption[] | undefined;
}

export interface KeptForm {
  id: string;
  sessionID: string;
  title: string;
  fields: [KeptField, ...KeptField[]];
}

export type FormSettled = Extract<
  OpenCodeEvent,
  { type: "form.replied" } | { type: "form.cancelled" }
>;

const MAX_KEPT_FIELDS = 32;
const MAX_FORM_JSON_CHARS = 64_000;

function isOptional(
  value: unknown,
  check: (value: unknown) => boolean,
): boolean {
  return value === undefined || check(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOption(value: unknown): value is KeptOption {
  return isRecord(value) && isString(value.label) && isString(value.value);
}

function isField(value: unknown): value is KeptField {
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

/** The form cut to its first `MAX_KEPT_FIELDS` fields, the only ones checked.
 *  An oversized form is dropped whole. */
export function formCreated(value: unknown): KeptForm | undefined {
  if (!isRecord(value)) return undefined;
  const { id, sessionID, title, fields } = value;
  if (!isString(id) || !isString(sessionID) || !isString(title))
    return undefined;
  if (!Array.isArray(fields)) return undefined;
  const [first, ...rest]: unknown[] = fields.slice(0, MAX_KEPT_FIELDS);
  if (!isField(first) || !rest.every(isField)) return undefined;
  if (JSON.stringify(value).length > MAX_FORM_JSON_CHARS) return undefined;
  return { id, sessionID, title, fields: [first, ...rest] };
}

export function formSettled(event: FormSettled): FormSettled | undefined {
  const data: unknown = event.data;
  if (!isRecord(data) || !isString(data.id) || !isString(data.sessionID))
    return undefined;
  if (event.type === "form.replied" && !isRecord(data.answer)) return undefined;
  return event;
}
