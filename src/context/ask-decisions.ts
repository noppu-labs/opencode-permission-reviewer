import type { AskDecision } from "../actor-context-types.ts";
import { isRecord } from "../is-record.ts";
import {
  parseAsked,
  parseReply,
  parseReplyTarget,
  UNANSWERED,
} from "./ask-events.ts";
import { PendingAsks } from "./pending-asks.ts";

/**
 * Captures user answers to agent ask dialogs (the `question` tool) from the
 * OpenCode event stream and exposes them as compact, session-scoped
 * authorization evidence for the reviewer prompt.
 *
 * The host runs questions through a dedicated service (`question.asked` /
 * `question.replied` / `question.rejected` events) that never touches the
 * permission pipeline, so these decisions are invisible to a permission-only
 * observer. This registry is the counterpart capture layer: it is
 * enrichment-only — question events never trigger, supersede, or enforce
 * anything — and it is total (malformed events are dropped, never thrown).
 *
 * Robustness rules:
 * - One logical ask = one record, keyed by the per-ask request ID. The v1 and
 *   v2 event spellings of the same ask upsert into the same entry, and a
 *   replayed reply or rejection is ignored.
 * - A reply or rejection without a matching pending ask is dropped (the
 *   question text is unknowable after the fact).
 * - Pending asks expire (TTL) so a very late reply cannot pair with a stale
 *   question from another context.
 * - Resolved decisions are FIFO-bounded globally; the per-review limit is
 *   applied at query time, not storage time.
 * - Question and answer text is redacted before storage; a credential pasted
 *   as a custom answer must never land in the registry, prompt, or audit.
 */

/** Marker recorded when the user dismisses an ask without answering. */
export const DISMISSED_ANSWER = "Dismissed by user";

const MAX_RESOLVED = 500;

type Logger = (message: string, details?: unknown) => void;

interface ResolvedDecision extends AskDecision {
  requestID: string;
  sessionID: string;
}

/** What the evidence assembler consumes: a bounded, lineage-scoped query. */
export interface AskDecisionSource {
  recentFor(sessionIDs: string[], limit?: number): AskDecision[];
}

export class AskDecisionRegistry implements AskDecisionSource {
  private readonly pending = new PendingAsks(() => this.now());
  private readonly resolved = new Map<string, ResolvedDecision>();
  private readonly log: Logger;
  private readonly now: () => number;

  constructor(logger?: Logger, now: () => number = () => Date.now()) {
    this.log = logger ?? ((): void => {});
    this.now = now;
  }

  /**
   * Observe one raw event. Total: never throws; anything malformed or
   * unrelated is dropped silently. Must be called synchronously from the event
   * hook so registry mutations are visible to reviews started later.
   */
  observe(event: unknown): void {
    if (!isRecord(event)) return;
    switch (event.type) {
      case "question.asked":
      case "question.v2.asked":
        this.onAsked(event.properties);
        return;
      case "question.replied":
      case "question.v2.replied":
        this.onReplied(event.properties);
        return;
      case "question.rejected":
      case "question.v2.rejected":
        this.onRejected(event.properties);
        return;
      default:
        return;
    }
  }

  /**
   * Decisions visible to a review running in `sessionIDs` (the requesting
   * session plus its resolved ancestors), oldest first, bounded to the most
   * recent `limit`. Sibling and unrelated sessions are never visible.
   */
  recentFor(sessionIDs: string[], limit = 6): AskDecision[] {
    if (sessionIDs.length === 0 || limit <= 0) return [];
    const scope = new Set(sessionIDs);
    const visible = [...this.resolved.values()]
      .filter((decision) => scope.has(decision.sessionID))
      .sort((a, b) => a.at - b.at);
    // `slice(-limit)` would return everything for limit 0; guarded above.
    return visible.slice(-limit).map((decision) => ({
      at: decision.at,
      question: decision.question,
      answer: decision.answer,
    }));
  }

  /** Observed-but-unresolved asks (diagnostics only). */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Resolved decisions retained (diagnostics only). */
  resolvedCount(): number {
    return this.resolved.size;
  }

  private onAsked(properties: unknown): void {
    const asked = parseAsked(properties);
    if (asked === undefined) return;
    // A late duplicate ask for an already-resolved request is a replay.
    if (this.resolved.has(asked.id)) return;
    this.pending.add(asked.id, asked.sessionID, asked.questions);
  }

  private onReplied(properties: unknown): void {
    const reply = parseReply(properties);
    if (reply === undefined) return;
    const pending = this.pending.take(reply.requestID);
    if (pending === undefined) return;
    this.store(reply.requestID, pending.sessionID, {
      at: this.now(),
      question: pending.questions.join(" | "),
      // Clamp to the asked questions: missing slots are unanswered, and
      // extra slots in a malformed event are orphan noise.
      answer: pending.questions
        .map((_, index) => reply.answers[index] ?? UNANSWERED)
        .join(" | "),
    });
    this.log("ask decision captured", {
      requestID: reply.requestID,
      sessionID: pending.sessionID,
    });
  }

  private onRejected(properties: unknown): void {
    const target = parseReplyTarget(properties);
    if (target === undefined) return;
    const pending = this.pending.take(target.requestID);
    if (pending === undefined) return;
    this.store(target.requestID, pending.sessionID, {
      at: this.now(),
      question: pending.questions.join(" | "),
      answer: DISMISSED_ANSWER,
    });
    this.log("ask dismissed by user", {
      requestID: target.requestID,
      sessionID: pending.sessionID,
    });
  }

  private store(
    requestID: string,
    sessionID: string,
    decision: AskDecision,
  ): void {
    this.resolved.set(requestID, { ...decision, requestID, sessionID });
    while (this.resolved.size > MAX_RESOLVED) {
      const oldest = this.resolved.keys().next().value;
      if (oldest === undefined) break;
      this.resolved.delete(oldest);
    }
  }
}
