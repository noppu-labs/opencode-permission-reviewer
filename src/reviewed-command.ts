import type { PermissionRequest } from "./types.ts";

export function reviewedCommand(request: PermissionRequest): string {
  const { command } = request.metadata;
  if (typeof command === "string" && command.trim() !== "") return command;
  return request.patterns
    .filter((pattern) => typeof pattern === "string")
    .join("\n");
}
