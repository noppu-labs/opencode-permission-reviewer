import {
  normalizeMessages,
  selectIntentMessages,
} from "../../../modules/context/services/prompt/context.ts";
import type { ContextReader } from "../../../modules/review/ports.ts";
import type { MessageWithParts } from "../../../types.ts";
import { asObjectLike } from "../../../utils/is-record.ts";
import { responseData, withTimeout } from "../transport.ts";
import type { OpenCodeClientLike } from "../types.ts";

const MAX_INTENT_SCAN_MESSAGES = 2_000;

type CreatedTime = { created?: unknown } | undefined;

/** The session's numeric creation time, when its metadata reports one. */
function sessionCreatedAt(metadata: unknown): number | undefined {
  const created = asObjectLike(asObjectLike(metadata)?.time)?.created;
  return typeof created === "number" ? created : undefined;
}

/** Keep messages without a numeric time, and those created since `createdAt`. */
function createdSince(
  createdAt: number | undefined,
): (message: MessageWithParts) => boolean {
  return (message: MessageWithParts): boolean => {
    const time = message.info.time as CreatedTime;
    return (
      createdAt === undefined ||
      typeof time?.created !== "number" ||
      time.created >= createdAt
    );
  };
}

export function createV1ContextReader(
  client: OpenCodeClientLike,
  signal?: AbortSignal,
): ContextReader {
  const signalOption = signal ? { signal } : {};
  // Share concurrent reads only: permission reviews must never reuse old state.
  const reads = new Map<string, Promise<unknown>>();
  const read = (
    sessionID: string,
    directory: string,
    limit: number,
  ): Promise<unknown> => {
    const key = JSON.stringify([sessionID, directory, limit]);
    const existing = reads.get(key);
    if (existing) return existing;
    const pending = client.session
      .messages({
        path: { id: sessionID },
        query: { directory, limit },
        ...signalOption,
      })
      .then((response) => responseData(response, "session.messages"));
    reads.set(key, pending);
    void pending.finally(() => reads.delete(key)).catch(() => {});
    return pending;
  };
  const metadata = (
    sessionID: string,
    directory: string,
  ): Promise<unknown> | undefined =>
    client.session.get
      ? withTimeout(
          client.session.get({
            path: { id: sessionID },
            query: { directory },
            ...signalOption,
          }),
          10_000,
        )
          .then((response) => responseData(response, "session.get"))
          .catch(() => undefined)
      : undefined;
  return {
    async messages(
      sessionID: string,
      directory: string,
      limit: number,
    ): Promise<unknown> {
      return read(sessionID, directory, limit);
    },
    async intentMessages(
      sessionID: string,
      directory: string,
      limit: number,
    ): Promise<MessageWithParts[]> {
      const metadataPromise = metadata(sessionID, directory);
      let window = Math.min(MAX_INTENT_SCAN_MESSAGES, Math.max(200, limit * 4));
      const [session, initial] = await Promise.all([
        metadataPromise,
        read(sessionID, directory, window),
      ]);
      let pending = Promise.resolve(initial);
      const current = createdSince(sessionCreatedAt(session));
      while (true) {
        // biome-ignore lint/performance/noAwaitInLoops: widens the message window only when the previous read returned too few intent messages, so each read depends on the result of the one before
        const messages = normalizeMessages(await pending);
        const users = selectIntentMessages(messages.filter(current), limit);
        if (
          users.length >= limit ||
          messages.length < window ||
          window === MAX_INTENT_SCAN_MESSAGES
        )
          return users.slice(-limit);
        window = Math.min(MAX_INTENT_SCAN_MESSAGES, window * 2);
        pending = read(sessionID, directory, window);
      }
    },
    async session(sessionID: string, directory: string): Promise<unknown> {
      if (!client.session.get) return undefined;
      return responseData(
        await client.session.get({
          path: { id: sessionID },
          query: { directory },
          ...signalOption,
        }),
        "session.get",
      );
    },
  };
}
