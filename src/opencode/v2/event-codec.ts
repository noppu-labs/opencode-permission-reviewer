import type { OpenCodeEvent } from "@opencode/client";
import type { AskDecision } from "../../actor-context-types.ts";
import {
  AskDecisionRegistry,
  type AskDecisionSource,
} from "../../context/ask-decisions.ts";

type Created = Extract<OpenCodeEvent, { type: "form.created" }>["data"]["form"];
type Field = Created["fields"][number];
type Settled = Extract<
  OpenCodeEvent,
  { type: "form.replied" } | { type: "form.cancelled" }
>;
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
  const value = answer[field.key];
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
    if (event.type === "form.created") this.created(event.data.form, now);
    else if (event.type === "form.replied" || event.type === "form.cancelled")
      this.settled(event);
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
    if (JSON.stringify(form).length > 64_000) return;
    if (this.pending.size >= 128) {
      const oldest = this.pending.keys().next();
      if (!oldest.done) this.pending.delete(oldest.value);
    }
    const bounded: Created = {
      ...form,
      fields: [form.fields[0], ...form.fields.slice(1, 32)],
    };
    this.pending.set(form.id, { form: bounded, at: now });
    this.registry.observe({
      type: "question.asked",
      properties: {
        id: form.id,
        sessionID: form.sessionID,
        questions: bounded.fields.map((field) => ({
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
