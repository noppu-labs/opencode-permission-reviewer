// Observed-but-unanswered asks, bounded by count and age, until a reply or rejection takes them.

const MAX_PENDING = 128;
const PENDING_TTL_MS = 30 * 60 * 1000;

interface PendingAsk {
  sessionID: string;
  questions: string[];
  askedAt: number;
}

export class PendingAsks {
  private readonly entries = new Map<string, PendingAsk>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  add(id: string, sessionID: string, questions: string[]): void {
    this.prune();
    this.entries.set(id, { sessionID, questions, askedAt: this.now() });
  }

  take(requestID: string): PendingAsk | undefined {
    // Replies and rejections must not pair with an expired ask, even when no
    // new ask arrived to trigger the routine pruning.
    this.pruneExpired();
    const pending = this.entries.get(requestID);
    if (pending !== undefined) this.entries.delete(requestID);
    return pending;
  }

  /** Enforce the pending cap and TTL. Map iteration order is insertion
   *  order, so `keys().next()` is the oldest entry. */
  private prune(): void {
    this.pruneExpired();
    while (this.entries.size >= MAX_PENDING) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  private pruneExpired(): void {
    const cutoff = this.now() - PENDING_TTL_MS;
    for (const [id, entry] of this.entries) {
      if (entry.askedAt < cutoff) this.entries.delete(id);
    }
  }
}
