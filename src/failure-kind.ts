// Reads back the error name that formatFailureReason ("<phase> failed
// (<Name>…): …") puts in a failure-safe reason, as a short word to show.

const FAILED_NAME = /\bfailed \(([A-Za-z]+)/;
const TIMED_OUT = /\btimed out\b/i;

/** "timeout" for a timeout, else the error name without its "Error" suffix in
 *  lower case ("error" for a bare Error); undefined when `reason` names no
 *  failure. */
export function failureKind(reason: string): string | undefined {
  const name = FAILED_NAME.exec(reason)?.[1];
  if (name === undefined) return;
  if (name === "TimeoutError" || TIMED_OUT.test(reason)) return "timeout";
  if (name === "Error") return "error";
  return name.replace(/Error$/, "").toLowerCase();
}
