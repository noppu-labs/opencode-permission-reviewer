import { expect, test } from "bun:test";
import { publishHandoffStatus } from "../src/core/review-status.ts";
import { config, request } from "./helpers.ts";

type Scope = Parameters<typeof publishHandoffStatus>[0];

test("a hand-off status that cannot be built never rejects unhandled", async () => {
  const scope = {
    ctx: { publishUiStatus: async (): Promise<unknown> => ({ data: true }) },
    config: config(),
    attempts: {
      get: (): never => {
        throw new Error("attempt lookup failed");
      },
    },
    log: (): void => {},
    metadataCallTimeoutMs: 1_000,
  } as unknown as Scope;
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  try {
    publishHandoffStatus(scope, request(), {
      from: "opencode/jev-1.13-free",
      to: "openai/gpt-6-luna",
      trigger: "jev-escalate",
    });
    await Bun.sleep(10);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  expect(rejections).toEqual([]);
});
