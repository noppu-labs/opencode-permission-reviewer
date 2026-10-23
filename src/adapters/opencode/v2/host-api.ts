import type { OpenCodeClient } from "@opencode/client";

/** The host operations a V2 review uses: the authenticated client, or the
 *  plugin context in-process. */
export interface V2HostApi {
  session: Pick<
    OpenCodeClient["session"],
    "create" | "get" | "context" | "prompt" | "wait" | "interrupt" | "remove"
  >;
  message?: Pick<OpenCodeClient["message"], "list">;
  mcp: Pick<OpenCodeClient["mcp"], "list">;
  model: Pick<OpenCodeClient["model"], "list">;
  plugin: Pick<OpenCodeClient["plugin"], "list">;
}
