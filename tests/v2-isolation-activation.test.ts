import { expect, test } from "bun:test";
import type { V2HostApi } from "../src/adapters/opencode/v2/host-api.ts";
import { waitForIsolationActive } from "../src/adapters/opencode/v2/v2-isolation-activation.ts";

test("waitForIsolationActive bounds a plugin list that never settles by the signal", async () => {
  const client = {
    plugin: { list: () => new Promise<never>(() => {}) },
  } as unknown as V2HostApi;
  const controller = new AbortController();
  const pending = waitForIsolationActive(
    client,
    "/tmp/opencode-reviewer-hung",
    "permission-reviewer-isolation-hung",
    controller.signal,
  );
  controller.abort(new Error("backend shutting down"));
  await expect(pending).rejects.toThrow("backend shutting down");
});
