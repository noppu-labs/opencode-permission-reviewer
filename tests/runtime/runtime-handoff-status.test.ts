import { afterEach, beforeEach, expect, test } from "bun:test";
import { MockClient, request, runtime } from "../helpers.ts";
import { phases } from "./runtime-fixtures.ts";

const JEV = "opencode/jev-1.13-free";
const LUNA = "openai/gpt-6-luna";
const INERT =
  'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not a System One model';
const DEGRADED = "global config file is malformed and was ignored";

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = savedKey;
});

test("a Jev hand-off publishes a second reviewing status for the reasoning reviewer", async () => {
  const client = new MockClient();
  const harness = runtime(client, {
    model: JEV,
    escalationReviewer: {
      model: LUNA,
      variant: "high",
      outputFormat: "json_schema",
      timeoutMs: 120_000,
    },
    systemOneEscalation: "reasoning-first",
  });
  harness.runtime.handle(request());
  await harness.runtime.waitForIdle();
  expect(phases(client).slice(0, 2)).toEqual(["reviewing", "reviewing"]);
  const [first, handoff, final] = client.uiStatuses;
  expect(first).toMatchObject({ model: JEV, variant: "system-one" });
  expect(first?.handoff).toBeUndefined();
  expect(handoff).toMatchObject({
    model: LUNA,
    variant: "high",
    handoff: {
      from: JEV,
      to: LUNA,
      trigger: "jev-failure",
      failureKind: "error",
    },
  });
  expect(final?.handoff).toEqual(handoff?.handoff);
});

test("every v1 status carries the server's config warnings and degraded reasons", async () => {
  const client = new MockClient();
  const harness = runtime(client, {
    configWarnings: [INERT],
    configDegraded: [DEGRADED],
  });
  harness.runtime.handle(request());
  await harness.runtime.waitForIdle();
  expect(client.uiStatuses.length).toBeGreaterThanOrEqual(2);
  for (const status of client.uiStatuses)
    expect(status).toMatchObject({
      configWarnings: [INERT],
      configDegraded: [DEGRADED],
    });
});

test("a healthy config adds no config lists", async () => {
  const client = new MockClient();
  const harness = runtime(client);
  harness.runtime.handle(request());
  await harness.runtime.waitForIdle();
  for (const status of client.uiStatuses) {
    expect(status.configWarnings).toBeUndefined();
    expect(status.configDegraded).toBeUndefined();
  }
});
