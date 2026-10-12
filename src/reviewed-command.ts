import type { PermissionRequest } from "./types.ts";

/**
 * The shell command a permission request is about: the explicit `command`
 * metadata when it is a non-blank string, else the string patterns joined by
 * `separator`.
 */
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
