import { expect, test } from "bun:test";
import {
  type Stub,
  type StubInput,
  v2ReviewFixture,
} from "./v2-review-fixture.ts";

const SHUTDOWN =
  "reviewer session call failed (Error): Reviewer backend is shutting down";

test("plugin entries that are not this bootstrap never decide its activation", async () => {
  const run = v2ReviewFixture();
  const listed = run.stubs["plugin.list"];
  const failed = { status: "failed", error: "Fixture plugin failure" };
  run.stubs["plugin.list"] = async (input: StubInput): Promise<unknown> => ({
    data: [
      { source: { type: "npm", path: "/x" }, state: failed },
      { source: { type: "local", path: 42 }, state: failed },
      { source: { type: "local", path: "file://remote/x" }, state: failed },
      { source: { type: "local", path: "/elsewhere" }, state: failed },
      ...((await (listed as Stub)(input)) as { data: unknown[] }).data,
    ],
  });
  expect((await run.review()).kind).toBe("allow");
});

test("a shutdown during the activation poll's delay fails the review", async () => {
  const run = v2ReviewFixture();
  let polled!: () => void;
  const polling = new Promise<void>((resolve) => {
    polled = resolve;
  });
  run.stubs["plugin.list"] = async (): Promise<unknown> => {
    polled();
    return { data: [] };
  };
  const review = run.review();
  await polling;
  // The poll waits 100 ms before listing again; shut down well inside that wait.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const disposal = run.backend.dispose();
  expect((await review).reason).toBe(SHUTDOWN);
  await disposal;
});

test("a shutdown before the activation poll's delay fails the review", async () => {
  const run = v2ReviewFixture();
  run.stubs["plugin.list"] = async (): Promise<unknown> => {
    void run.backend.dispose();
    return { data: [] };
  };
  expect((await run.review()).reason).toBe(SHUTDOWN);
  expect(run.calls.map(([name]) => name)).toEqual(["mcp.list", "plugin.list"]);
});
