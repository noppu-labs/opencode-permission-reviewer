// Reads back the error name that formatFailureReason ("<phase> failed
// (<Name>…): …") puts in a failure-safe reason, as a short word to show.

const FAILED_NAME = /\bfailed \(([A-Za-z]+)/;
const TIMED_OUT = /\btimed out\b/i;
/** The TypeSafe SDK errors Jev's invoker throws, as the short words the TUI shows. */
const SDK_KINDS = new Map([
  ["APIConnectionError", "transport"],
  ["APIUserAbortError", "abort"],
  ["AuthenticationError", "auth"],
  ["PermissionDeniedError", "auth"],
  ["RateLimitError", "rate-limit"],
  ["InternalServerError", "server"],
  ["BadRequestError", "bad-request"],
  ["UnprocessableEntityError", "bad-request"],
  ["NotFoundError", "not-found"],
]);

/** "timeout" for a timeout, a short word for a known SDK error, else the
 *  error name without its "Error" suffix in lower case ("error" for a bare
 *  Error); undefined when `reason` names no failure. */
export function failureKind(reason: string): string | undefined {
  const name = FAILED_NAME.exec(reason)?.[1];
  if (name === undefined) return;
  if (name === "TimeoutError" || TIMED_OUT.test(reason)) return "timeout";
  if (name === "Error") return "error";
  return SDK_KINDS.get(name) ?? name.replace(/Error$/, "").toLowerCase();
}
