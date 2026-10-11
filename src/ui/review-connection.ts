type Update = (data: unknown, owner: AbortController) => void;

/** One connection: events stay buffered until its snapshot is applied. */
export interface Connection {
  controller: AbortController;
  directory: string;
  loading: boolean;
  buffered: unknown[];
}

/** Takes one subscription event: ignored for another directory, buffered while
 *  the snapshot loads, passed to `update` afterwards. */
export function receive(
  event: { location: { directory: string }; data: unknown },
  connection: Connection,
  update: Update,
): void {
  if (event.location.directory !== connection.directory) return;
  if (!connection.loading) {
    update(event.data, connection.controller);
    return;
  }
  if (connection.buffered.length >= 512)
    throw new Error("Reviewer event buffer overflow");
  connection.buffered.push(event.data);
}

/** Ends loading and replays the buffered events in arrival order. */
export function release(connection: Connection, update: Update): void {
  connection.loading = false;
  for (const event of connection.buffered) update(event, connection.controller);
}
