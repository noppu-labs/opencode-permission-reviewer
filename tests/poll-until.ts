// A bounded condition wait for tests that observe asynchronous follow-up work.

/** Polls until `check` holds, checking after a timer turn each time so
 *  pending promise callbacks have run; fails past the deadline. */
export async function until(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeout = 2000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await Bun.sleep(1);
    if (await check()) return;
  }
  throw new Error(`timed out waiting for ${what}`);
}
