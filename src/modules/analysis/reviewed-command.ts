import type { PermissionRequest } from "../../kernel/permission-request.ts";

export function commandText(
  request: PermissionRequest,
  separator: string,
): string {
  const { command } = request.metadata;
  if (typeof command === "string" && command.trim() !== "") return command;
  return request.patterns
    .filter((pattern) => typeof pattern === "string")
    .join(separator);
}

export function reviewedCommand(request: PermissionRequest): string {
  return commandText(request, "\n");
}
