import type { OpenCodeEvent } from "@opencode/client";
import type { AskDecision } from "../../actor-context-types.ts";
import {
  AskDecisionRegistry,
  type AskDecisionSource,
} from "../../context/ask-decisions.ts";
import { isRecord } from "../../is-record.ts";
import {
  type KeptForm as Created,
  type KeptField as Field,
  formCreated,
  formSettled,
  type FormSettled as Settled,
} from "./form-event-shape.ts";

type Answer = Extract<
  OpenCodeEvent,
  { type: "form.replied" }
>["data"]["answer"];

const PENDING_TTL_MS = 30 * 60 * 1000;

function optionLabel(field: Field, value: unknown): string | undefined {
  return "options" in field
    ? field.options?.find((option) => option.value === String(value))?.label
    : undefined;
}

function fieldAnswers(field: Field, answer: Answer): string[] {
  const value = Object.hasOwn(answer, field.key)
    ? answer[field.key]
    : undefined;
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((value) => optionLabel(field, value) ?? String(value));
}

/** Translate the native form protocol into the existing bounded question registry. */
export class V2AskDecisions implements AskDecisionSource {
  private readonly registry = new AskDecisionRegistry();
  private readonly pending = new Map<string, { form: Created; at: number }>();

  observe(event: OpenCodeEvent, directory: string): void {
    if (!("location" in event) || event.location?.directory !== directory)
      return;
    const now = Date.now();
    this.expirePending(now);
    if (event.type === "form.created") {
      const data: unknown = event.data;
      const form = formCreated(isRecord(data) ? data.form : undefined);
      if (form) this.created(form, now);
    } else if (
      event.type === "form.replied" ||
      event.type === "form.cancelled"
    ) {
      const settled = formSettled(event);
      if (settled) this.settled(settled);
    }
  }

  recentFor(sessionIDs: string[], limit?: number): AskDecision[] {
    return this.registry.recentFor(sessionIDs, limit);
  }

  private expirePending(now: number): void {
    for (const [id, pending] of this.pending)
      if (now - pending.at > PENDING_TTL_MS) this.pending.delete(id);
  }

  private created(form: Created, now: number): void {
    if (!form.sessionID.startsWith("ses_") || this.pending.has(form.id)) return;
    if (this.pending.size >= 128) {
      const oldest = this.pending.keys().next();
      if (!oldest.done) this.pending.delete(oldest.value);
    }
    this.pending.set(form.id, { form, at: now });
    this.registry.observe({
      type: "question.asked",
      properties: {
        id: form.id,
        sessionID: form.sessionID,
        questions: form.fields.map((field) => ({
          question: `${form.title}: ${field.title ?? field.key}`,
        })),
      },
    });
  }

  private settled(event: Settled): void {
    const pending = this.pending.get(event.data.id);
    if (!pending || pending.form.sessionID !== event.data.sessionID) return;
    this.pending.delete(event.data.id);
    if (event.type === "form.cancelled") {
      this.registry.observe({
        type: "question.rejected",
        properties: { requestID: event.data.id },
      });
      return;
    }
    const answer = event.data.answer;
    this.registry.observe({
      type: "question.replied",
      properties: {
        requestID: event.data.id,
        answers: pending.form.fields.map((field) =>
          fieldAnswers(field, answer),
        ),
      },
    });
  }
}
