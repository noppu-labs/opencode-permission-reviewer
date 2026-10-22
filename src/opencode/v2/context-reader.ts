import type { SessionInfo } from "@opencode/client";
import { selectIntentMessages } from "../../context.ts";
import type { ContextReader } from "../../core/ports.ts";
import type { MessageWithParts } from "../../types.ts";
import { contextMessages, userMessage } from "./context-messages.ts";
import type { V2HostApi } from "./host-api.ts";

type Context = V2HostApi;

function locatedSession(session: SessionInfo, directory: string): SessionInfo {
  if (session.location.directory !== directory)
    throw new Error("Session location mismatch");
  return session;
}

/** Preserve provenance: synthetic messages and compactions are not user orders. */
export function createV2ContextReader(
  ctx: Context,
  signal: AbortSignal,
): ContextReader {
  return {
    async session(sessionID: string, directory: string): Promise<SessionInfo> {
      return locatedSession(
        await ctx.session.get({ sessionID }, { signal }),
        directory,
      );
    },
    async messages(
      sessionID: string,
      directory: string,
      limit: number,
    ): Promise<MessageWithParts[]> {
      const session = locatedSession(
        await ctx.session.get({ sessionID }, { signal }),
        directory,
      );
      const messages = await ctx.session.context({ sessionID }, { signal });
      return contextMessages(session, messages, limit);
    },
    async intentMessages(
      sessionID: string,
      directory: string,
      limit: number,
    ): Promise<MessageWithParts[]> {
      const session = locatedSession(
        await ctx.session.get({ sessionID }, { signal }),
        directory,
      );
      const messages = ctx.message
        ? (
            await ctx.message.list(
              {
                sessionID,
                type: "user",
                order: "desc",
                limit: Math.min(50, limit * 4),
              },
              { signal },
            )
          ).data
            .slice()
            .reverse()
        : (await ctx.session.context({ sessionID }, { signal }))
            .filter((message) => message.type === "user")
            .slice(-limit);
      const normalized = messages.flatMap((message) =>
        message.type === "user" ? [userMessage(session, message)] : [],
      );
      return selectIntentMessages(normalized, limit);
    },
  };
}
