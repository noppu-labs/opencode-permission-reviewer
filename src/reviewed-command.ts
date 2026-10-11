import type { PermissionRequest } from "./types.ts";

/** The command text under review: the `command` metadata when it is a string
 *  with non-whitespace content, else the string patterns joined one per line. */
export function reviewedCommand(request: PermissionRequest): string {
  const { command } = request.metadata;
  if (typeof command === "string" && command.trim() !== "") return command;
  return request.patterns
    .filter((pattern) => typeof pattern === "string")
    .join("\n");
}
