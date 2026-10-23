import type { MessageWithParts } from "../src/modules/context/models/message.ts";
import type { ContextReader } from "../src/modules/review/ports.ts";
import { defined } from "./helpers.ts";

/** The IDs of the messages a reader's `intentMessages` returns. */
export async function intentIDs(
  reader: ContextReader,
  limit: number,
  directory = "/workspace",
): Promise<unknown[]> {
  const read = defined(reader.intentMessages, "reader.intentMessages");
  const messages = (await read.call(
    reader,
    "session",
    directory,
    limit,
  )) as MessageWithParts[];
  return messages.map((message) => message.info.id);
}
