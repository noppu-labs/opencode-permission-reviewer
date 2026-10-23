import { expect, test } from "bun:test";
import type { ReviewerConfig } from "../src/kernel/reviewer-config.ts";
import {
  returns,
  type Stub,
  type StubInput,
  TOOL,
  type V2ReviewFixture,
  v2ReviewFixture,
} from "./v2-review-fixture.ts";

const interrupt = "session.interrupt";
const remove = "session.remove";
const get = "session.get";
const CLEANUP: string[] = [interrupt, remove, get];

const notFound = (): Promise<never> =>
  Promise.reject({ _tag: "SessionNotFoundError" });
const lost = (): Promise<never> => Promise.reject(new Error("lost"));
const sequence = (...stubs: Stub[]): Stub => {
  const queue = [...stubs];
  return (input: StubInput): Promise<unknown> => (queue.shift() as Stub)(input);
};

const cleanupCalls = (run: V2ReviewFixture): string[] =>
  run.calls.map(([name]) => name).filter((name) => CLEANUP.includes(name));

const reviewSessionID = (run: V2ReviewFixture): string =>
  (
    run.calls.find(([name]) => name === "session.create") as [
      string,
      { id: string },
    ]
  )[1].id;

test.each([
  {
    name: "an interrupt that finds no session",
    stubs: { "session.interrupt": notFound },
    calls: [interrupt],
  },
  {
    name: "a failed interrupt",
    stubs: { "session.interrupt": lost },
    calls: [interrupt, remove, get],
  },
  {
    name: "a failed removal",
    stubs: { "session.remove": lost },
    calls: [interrupt, remove, get],
  },
  {
    name: "a session still found on the first check",
    stubs: { "session.get": sequence(returns({}), notFound) },
    calls: [interrupt, remove, get, interrupt, remove, get],
  },
  {
    name: "a session reported gone by the in-process adapter",
    stubs: {
      "session.get": () => Promise.reject({ _tag: "Session.NotFoundError" }),
    },
    calls: [interrupt, remove, get],
  },
])("$name still confirms cleanup", async ({ stubs, calls }) => {
  const run = v2ReviewFixture();
  Object.assign(run.stubs, stubs);
  expect((await run.review()).kind).toBe("allow");
  expect(cleanupCalls(run)).toEqual([...calls]);
  expect(run.backend.owns(reviewSessionID(run))).toBe(false);
});

test("a retained review session is only interrupted", async () => {
  const run = v2ReviewFixture({ retainReviewSessions: true });
  expect((await run.review()).kind).toBe("allow");
  expect(cleanupCalls(run)).toEqual([interrupt]);
});

test.each([
  {
    name: "a session that survives removal",
    stubs: { "session.get": returns({}) },
    config: {},
    calls: [interrupt, remove, get, interrupt, remove, get],
  },
  {
    name: "a failed session lookup",
    stubs: { "session.get": lost },
    config: {},
    calls: [interrupt, remove, get, interrupt, remove, get],
  },
  {
    name: "a busy session never reported gone",
    stubs: {
      "session.get": () => Promise.reject({ _tag: "Session.BusyError" }),
    },
    config: {},
    calls: [interrupt, remove, get, interrupt, remove, get],
  },
  {
    name: "a retained session that cannot be interrupted",
    stubs: { "session.interrupt": lost },
    config: { retainReviewSessions: true },
    calls: [interrupt, interrupt],
  },
])("$name fails the review and keeps its guards", async (row) => {
  const run = v2ReviewFixture(row.config as Partial<ReviewerConfig>);
  Object.assign(run.stubs, row.stubs);
  await expect(run.review()).rejects.toThrow(
    "Reviewer cleanup could not be confirmed; isolation guards remain active",
  );
  expect(cleanupCalls(run)).toEqual([...row.calls]);
  const sessionID = reviewSessionID(run);
  expect(run.backend.owns(sessionID)).toBe(true);
  expect(() => run.host.toolHook({ sessionID, tool: TOOL })).toThrow(
    "Operational tools are disabled in reviewer sessions",
  );
});

test("a review that fails before creating its session runs no cleanup", async () => {
  const run = v2ReviewFixture();
  run.stubs["model.list"] = returns({ data: [] });
  expect((await run.review()).kind).toBe("escalate");
  expect(cleanupCalls(run)).toEqual([]);
});

test("a failed prompt still cleans up its session", async () => {
  const run = v2ReviewFixture();
  run.stubs["session.prompt"] = lost;
  const result = await run.review();
  expect(result.reason).toBe("reviewer session call failed (Error): lost");
  expect(result.reviewSessionID).toBe(reviewSessionID(run));
  expect(cleanupCalls(run)).toEqual([interrupt, remove, get]);
});
