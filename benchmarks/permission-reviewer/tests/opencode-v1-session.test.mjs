import assert from "node:assert/strict";
import test from "node:test";
import { requestOpenCodeV1 } from "../lib/opencode-v1.mjs";
import { inSequence } from "./run-fixtures.mjs";

const model = {
  id: "host",
  model: "xai/grok",
  endpoint: "http://127.0.0.1:4096/",
  transport: "opencode-v1",
  hostPasswordEnv: "PRB_TEST_SESSION_PASSWORD",
  variant: "low",
  format: "text",
};
process.env.PRB_TEST_SESSION_PASSWORD = "synthetic-session-password";
const prepared = {
  system: "POLICY",
  user: "EVIDENCE",
  schema: { type: "object" },
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
const answer = (info, parts = [{ type: "text", text: "ANSWER" }]) => ({
  info: { providerID: "xai", modelID: "grok", ...info },
  parts,
});
const FAILURE_KEYS = ["ok", "status", "error", "rawText", "latencyMs", "halt"];

/** A fetch double for the OpenCode host: `routes` overrides the happy-path answers by "METHOD /path". */
function fakeHost(routes = {}) {
  const calls = [];
  const happy = {
    "POST /session": () => json({ id: "ses_1" }),
    "POST /session/ses_1/message": () =>
      json(answer({ tokens: { input: 4, output: 2, reasoning: 1 } })),
    "DELETE /session/ses_1": () => json(true),
    "DELETE /session/bad": () => json(true),
    "POST /instance/dispose": () => json(true),
  };
  const fetchImpl = async (url, init) => {
    const route = `${init.method} ${url.pathname}`;
    calls.push({ route, init, directory: url.searchParams.get("directory") });
    return { ...happy, ...routes }[route](init);
  };
  return { calls, fetchImpl };
}
const withoutLatency = ({ latencyMs, ...rest }) => {
  assert.equal(typeof latencyMs, "number");
  return rest;
};

test("a JSON schema request sends the schema format and the retry note, and answers with the structured output", async () => {
  const host = fakeHost({
    "POST /session/ses_1/message": () =>
      json(answer({ structured: { outcome: "deny" } }, [])),
  });
  const result = await requestOpenCodeV1(
    { ...model, format: "json_schema" },
    prepared,
    {
      retryNote: "NOTE",
      fetchImpl: host.fetchImpl,
    },
  );
  assert.deepEqual(
    host.calls.map((c) => c.route),
    [
      "POST /session",
      "POST /session/ses_1/message",
      "DELETE /session/ses_1",
      "POST /instance/dispose",
    ],
  );
  const [create, message, remove] = host.calls;
  assert.equal(
    create.init.body,
    JSON.stringify({ title: "Synthetic permission benchmark" }),
  );
  assert.deepEqual(Object.keys(create.init), [
    "method",
    "headers",
    "body",
    "signal",
    "redirect",
  ]);
  assert.equal(create.init.redirect, "error");
  assert.deepEqual(Object.keys(create.init.headers), [
    "Authorization",
    "Content-Type",
  ]);
  assert.deepEqual(Object.keys(remove.init.headers), ["Authorization"]);
  assert.equal(remove.init.body, undefined);
  assert(host.calls.every((c) => c.directory === create.directory));
  assert.deepEqual(JSON.parse(message.init.body), {
    model: { providerID: "xai", modelID: "grok" },
    variant: "low",
    tools: { "*": false },
    system: "POLICY",
    format: { type: "json_schema", schema: { type: "object" }, retryCount: 0 },
    parts: [{ type: "text", text: "EVIDENCE\n\nNOTE" }],
  });
  const raw = {
    host: "opencode-v1",
    model: "xai/grok",
    variant: "low",
    sessionID: "ses_1",
    tokens: null,
    parts: [],
  };
  assert.deepEqual(withoutLatency(result), {
    ok: true,
    status: 200,
    raw,
    rawText: JSON.stringify(raw),
    extracted: { text: '{"outcome":"deny"}' },
    returnedModel: "xai/grok",
    usage: null,
  });
  const empty = await requestOpenCodeV1(
    { ...model, format: "json_schema" },
    prepared,
    {
      fetchImpl: fakeHost({
        "POST /session/ses_1/message": () => json(answer({}, [])),
      }).fetchImpl,
    },
  );
  assert.deepEqual(empty.extracted, { text: "null" });
});

test("text answers join only the text parts and map partial token counts", async () => {
  const host = fakeHost({
    "POST /session/ses_1/message": () =>
      json(
        answer({ tokens: {} }, [
          { type: "text", text: "A" },
          { type: "reasoning", text: "hidden" },
          { type: "text", text: 7 },
          null,
          { type: "text", text: "B", extra: true },
        ]),
      ),
  });
  const result = await requestOpenCodeV1(model, prepared, {
    fetchImpl: host.fetchImpl,
  });
  assert.deepEqual(result.extracted, { text: "A\nB" });
  assert.deepEqual(result.raw.parts, [
    { type: "text", text: "A" },
    { type: "text", text: "B" },
  ]);
  assert.deepEqual(result.usage, {
    prompt_tokens: null,
    completion_tokens: null,
    reasoning_tokens: null,
  });
  const silent = await requestOpenCodeV1(model, prepared, {
    fetchImpl: fakeHost({
      "POST /session/ses_1/message": () => json(answer({}, [])),
    }).fetchImpl,
  });
  assert.deepEqual(silent.extracted, {
    text: "",
    protocolError: "OpenCode returned no decision text.",
  });
  assert.equal(silent.usage, null);
});

const refused = [
  [
    { "POST /session": () => json({ id: "bad" }) },
    null,
    "OpenCode returned an invalid session ID",
    "DELETE /session/bad",
  ],
  [
    { "POST /session": () => new Response(null, { status: 204 }) },
    null,
    "OpenCode returned an invalid session ID",
  ],
  [
    {
      "POST /session/ses_1/message": () =>
        json(answer({ error: { name: "ProviderAuthError" } })),
    },
    null,
    "OpenCode model error: ProviderAuthError",
    "DELETE /session/ses_1",
  ],
  [
    { "POST /session/ses_1/message": () => json(answer({ error: {} })) },
    null,
    "OpenCode model error: unknown",
    "DELETE /session/ses_1",
  ],
  [
    { "POST /session/ses_1/message": () => json(answer({ modelID: "other" })) },
    null,
    "OpenCode returned a different provider or model",
    "DELETE /session/ses_1",
  ],
  [
    { "POST /session/ses_1/message": () => json(answer({}, {})) },
    null,
    "OpenCode response has no parts",
    "DELETE /session/ses_1",
  ],
  [
    {
      "POST /session/ses_1/message": () => json(answer({}, [{ type: "tool" }])),
    },
    null,
    "OpenCode returned a tool action despite disabled tools",
    "DELETE /session/ses_1",
  ],
  [
    { "POST /session/ses_1/message": () => json({}, 500) },
    500,
    "OpenCode HTTP 500",
    "DELETE /session/ses_1",
  ],
  [
    {
      "POST /session/ses_1/message": () =>
        Promise.reject(new Error("socket closed")),
    },
    null,
    "socket closed",
    "DELETE /session/ses_1",
  ],
];

test("every unusable host answer halts with its exact reason after deleting a created session", async () =>
  inSequence(refused, async ([routes, status, error, deletion]) => {
    const host = fakeHost(routes);
    const result = await requestOpenCodeV1(model, prepared, {
      fetchImpl: host.fetchImpl,
    });
    assert.deepEqual(Object.keys(result), FAILURE_KEYS);
    assert.deepEqual(withoutLatency(result), {
      ok: false,
      status,
      error,
      rawText: "",
      halt: true,
    });
    assert.equal(
      host.calls.some((c) => c.route === deletion),
      deletion !== undefined,
      error,
    );
  }));

test("a caller abort reaches the host requests but not the cleanup calls", async () => {
  const caller = new AbortController();
  caller.abort(new Error("caller stop"));
  const host = fakeHost({
    "POST /session": (init) => Promise.reject(init.signal.reason),
    "POST /instance/dispose": (init) => json(init.signal.aborted, 200),
  });
  const result = await requestOpenCodeV1(model, prepared, {
    signal: caller.signal,
    fetchImpl: host.fetchImpl,
  });
  assert.equal(result.error, "caller stop");
  assert.deepEqual(
    host.calls.map((c) => [c.route, c.init.signal.aborted]),
    [
      ["POST /session", true],
      ["POST /instance/dispose", false],
    ],
  );
});

test("a cleanup failure replaces any outcome, with a null status for thrown errors", async () => {
  const host = fakeHost({
    "POST /session/ses_1/message": () => json({}, 429),
    "POST /instance/dispose": () =>
      Promise.reject(new Error("dispose refused")),
  });
  const result = await requestOpenCodeV1(model, prepared, {
    fetchImpl: host.fetchImpl,
  });
  assert.deepEqual(withoutLatency(result), {
    ok: false,
    status: null,
    error: "OpenCode instance cleanup failed after 3 attempts: dispose refused",
    rawText: "",
    halt: true,
  });
  assert.equal(
    host.calls.filter((c) => c.route === "POST /instance/dispose").length,
    3,
  );
});

test("a missing host password throws before any host request", async () => {
  const host = fakeHost();
  await assert.rejects(
    requestOpenCodeV1(
      { ...model, hostPasswordEnv: "PRB_TEST_SESSION_UNSET" },
      prepared,
      { fetchImpl: host.fetchImpl },
    ),
    {
      message:
        "Missing OpenCode host password environment variable PRB_TEST_SESSION_UNSET",
    },
  );
  assert.equal(host.calls.length, 0);
});
