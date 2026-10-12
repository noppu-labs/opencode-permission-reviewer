// Question events from the host, normalized: asked payloads into question texts, replies into per-question answers, rejections into their target.

import { isRecord } from "../is-record.ts";
import { redactSecrets } from "../redact.ts";

/** Word the host uses for sub-questions the user left unanswered. */
export const UNANSWERED = "Unanswered";

const QUESTION_MAX_CHARS = 160;
const ANSWER_MAX_CHARS = 120;

interface QuestionShape {
  id: string;
  sessionID: string;
  questions: string[];
}

interface ReplyShape {
  requestID: string;
}

function sanitizeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  // Collapse internal whitespace so a crafted question or answer can never
  // inject line breaks into the one-line-per-decision evidence rendering.
  const flat = text.replace(/\s+/g, " ");
  const redacted = redactSecrets(flat);
  return redacted.length <= max ? redacted : redacted.slice(0, max);
}

/** Normalize a `question.(v2.)asked` payload into question texts. */
export function parseAsked(properties: unknown): QuestionShape | undefined {
  if (!isRecord(properties)) return;
  if (
    typeof properties.id !== "string" ||
    typeof properties.sessionID !== "string"
  )
    return;
  if (!Array.isArray(properties.questions)) return;
  const questions: string[] = [];
  for (const raw of properties.questions) {
    if (!isRecord(raw)) continue;
    const text = sanitizeText(raw.question, QUESTION_MAX_CHARS);
    if (text !== undefined) questions.push(text);
  }
  if (questions.length === 0) return;
  return { id: properties.id, sessionID: properties.sessionID, questions };
}

/** Normalize a `question.(v2.)replied` payload into per-question answers
 *  (each an array of selected labels). Pairing/padding against the asked
 *  questions happens where the pending entry is known. */
export function parseReply(
  properties: unknown,
): { requestID: string; answers: string[] } | undefined {
  if (!isRecord(properties)) return;
  if (typeof properties.requestID !== "string") return;
  if (!Array.isArray(properties.answers)) return;
  const perQuestion: string[] = [];
  for (const raw of properties.answers) {
    if (!Array.isArray(raw)) continue;
    const labels = raw.filter(
      (label): label is string => typeof label === "string",
    );
    perQuestion.push(
      labels.length === 0
        ? UNANSWERED
        : (sanitizeText(labels.join(", "), ANSWER_MAX_CHARS) ?? UNANSWERED),
    );
  }
  if (perQuestion.length === 0) return;
  return { requestID: properties.requestID, answers: perQuestion };
}

export function parseReplyTarget(properties: unknown): ReplyShape | undefined {
  if (!isRecord(properties)) return;
  return typeof properties.requestID === "string"
    ? { requestID: properties.requestID }
    : undefined;
}
