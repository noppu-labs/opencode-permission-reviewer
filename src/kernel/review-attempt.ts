/** What the reviewer needs from a review attempt: its cancellation, its
 *  remaining budget, and a wait that rejects once it is no longer active. */
export interface ReviewAttemptView {
  readonly signal: AbortSignal;
  remainingMs(): number;
  active(): boolean;
  wait<T>(operation: Promise<T>): Promise<T>;
}
