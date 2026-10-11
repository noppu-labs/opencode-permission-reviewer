import {
  decodeUiStatus,
  encodeUiStatus,
  type ReviewUiStatus,
} from "../ui-protocol.ts";
import { ReviewUiState } from "../ui-state.ts";
import { object } from "./host-value.ts";

export interface ReviewSnapshot extends Record<string, unknown> {
  generation: string;
  revision: number;
  reviews: unknown[];
}

export function isSnapshot(
  value: Record<string, unknown> | undefined,
  directory: string,
): value is ReviewSnapshot {
  return (
    value !== undefined &&
    value.directory === directory &&
    typeof value.generation === "string" &&
    typeof value.revision === "number" &&
    Array.isArray(value.reviews)
  );
}

const emptyState = (): ReviewUiState =>
  new ReviewUiState({ model: "", variant: "", timeoutMs: 180_000 });

/** The review statuses of one reviewer generation, applied in revision order. */
export class ReviewStore {
  state: ReviewUiState = emptyState();
  private generation: string | undefined;
  private sequence = -1;

  constructor(
    private readonly notifyManual: (status: ReviewUiStatus) => void,
  ) {}

  reset(): void {
    this.state = emptyState();
  }

  load(snapshot: ReviewSnapshot): void {
    this.state = emptyState();
    this.generation = snapshot.generation;
    this.sequence = snapshot.revision;
    for (const status of snapshot.reviews) this.apply(status);
  }

  /**
   * Applies an update event for `directory` when it belongs to the loaded
   * generation and its revision is newer. "foreign" names another generation.
   */
  accept(
    value: unknown,
    directory: string | undefined,
  ): "ignored" | "foreign" | "applied" {
    const event = object(value);
    if (!event || event.directory !== directory) return "ignored";
    if (typeof event.generation !== "string") return "ignored";
    if (event.generation !== this.generation) return "foreign";
    if (typeof event.revision !== "number" || event.revision <= this.sequence)
      return "ignored";
    this.sequence = event.revision;
    this.apply(event.status);
    return "applied";
  }

  markDisconnected(): void {
    for (const status of this.state.all())
      if (status.phase === "reviewing")
        this.state.apply({
          ...status,
          phase: "unknown",
          emittedAt: Date.now(),
          reason: "Reconnecting to reviewer status",
        });
  }

  private apply(value: unknown): void {
    const status = decodeUiStatus(encodeUiStatus(value as ReviewUiStatus));
    if (!status) return;
    this.state.apply(status);
    if (status.phase === "manual") this.notifyManual(status);
  }
}
