// The lines of a command the brake checks one at a time.

/** The logical lines of `command`: each physical line on its own, except that
 *  a line ending in a backslash continuation joins the line after it. */
export function logicalLines(command: string): string[] {
  const lines: string[] = [];
  let joined = "";
  for (const physical of command.split("\n")) {
    if (physical.endsWith("\\")) {
      joined += physical.slice(0, -1);
      continue;
    }
    lines.push(joined + physical);
    joined = "";
  }
  if (joined !== "") lines.push(joined);
  return lines;
}
