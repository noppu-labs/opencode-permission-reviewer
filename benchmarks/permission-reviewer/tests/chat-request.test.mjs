import assert from "node:assert/strict";
import test from "node:test";
import { buildBody, requestCompletion } from "../lib/providers.mjs";
import { decision, model } from "./helpers.mjs";
import { inSequence, withEnv } from "./run-fixtures.mjs";

const prepared = {
  system: "POLICY",
  user: "INERT DATA",
  schema: { type: "object" },
};
const keyed = { ...model, apiKeyEnv: "PRB_CHAT_KEY" };
const KEY = "synthetic-chat-credential";
const completionBody = {
  model: "returned",
  system_fingerprint: "fp",
  choices: [
    { finish_reason: "stop", message: { content: JSON.stringify(decision()) } },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 2 },
};
const withoutLatency = ({ latencyMs, ...rest }) => {
  assert.equal(typeof latencyMs, "number");
  return rest;
};
/** A fetch double that records each call and answers with `respond(init)`. */
const recorder = (respond) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return respond(init);
  };
  return { calls, fetchImpl };
};

test("a completion posts the built body with the bearer key, a live signal and no redirects", async () =>
  withEnv({ PRB_CHAT_KEY: KEY }, async () => {
    const { calls, fetchImpl } = recorder(
      () =>
        new Response(JSON.stringify(completionBody), {
          headers: { "x-request-id": "rid" },
        }),
    );
    const result = await requestCompletion(keyed, prepared, {
      retryNote: "NOTE",
      fetchImpl,
    });
    const [{ url, init }] = calls;
    assert.equal(url, model.endpoint);
    assert.deepEqual(Object.keys(init), [
      "method",
      "headers",
      "body",
      "signal",
      "redirect",
    ]);
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    });
    assert.equal(init.body, JSON.stringify(buildBody(keyed, prepared, "NOTE")));
    assert.equal(init.redirect, "error");
    assert.equal(init.signal.aborted, false);
    assert.deepEqual(Object.keys(result), [
      "ok",
      "status",
      "raw",
      "rawText",
      "latencyMs",
      "requestId",
      "extracted",
      "usage",
      "returnedModel",
      "systemFingerprint",
      "finishReason",
    ]);
    assert.deepEqual(withoutLatency(result), {
      ok: true,
      status: 200,
      raw: completionBody,
      rawText: JSON.stringify(completionBody),
      requestId: "rid",
      extracted: { text: JSON.stringify(decision()), exposedReasoning: null },
      usage: completionBody.usage,
      returnedModel: "returned",
      systemFingerprint: "fp",
      finishReason: "stop",
    });
  }));

test("a keyless completion sends only the content type and defaults missing response fields to null", async () => {
  const { calls, fetchImpl } = recorder(() => new Response("{}"));
  const result = await requestCompletion(model, prepared, { fetchImpl });
  assert.deepEqual(calls[0].init.headers, {
    "Content-Type": "application/json",
  });
  assert.deepEqual(withoutLatency(result), {
    ok: true,
    status: 200,
    raw: {},
    rawText: "{}",
    requestId: null,
    extracted: {
      text: "",
      protocolError: "Expected exactly one completion choice.",
    },
    usage: null,
    returnedModel: null,
    systemFingerprint: null,
    finishReason: null,
  });
});

const failures = [
  [
    () => new Response("busy", { status: 503 }),
    {
      ok: false,
      status: 503,
      error: "HTTP 503",
      rawText: "busy",
      requestId: null,
    },
  ],
  [
    () => new Response("nope"),
    {
      ok: false,
      status: 200,
      error: "Non-JSON provider response.",
      rawText: "nope",
    },
  ],
  [
    () => new Response(null),
    {
      ok: false,
      status: 200,
      error: "Non-JSON provider response.",
      rawText: "",
    },
  ],
  [
    () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
    {
      ok: false,
      error: "Provider response exceeds 4194304 bytes.",
      rawText: "",
      status: 200,
    },
  ],
  [
    () => Promise.reject(new Error(`refused ${KEY}`)),
    {
      ok: false,
      error: "refused [REDACTED:provider_api_key]",
      rawText: "",
      status: null,
    },
  ],
];

test("failed completions keep their exact shape and redact the key from errors", async () =>
  withEnv({ PRB_CHAT_KEY: KEY }, () =>
    inSequence(failures, async ([respond, expected]) => {
      const result = withoutLatency(
        await requestCompletion(keyed, prepared, {
          fetchImpl: recorder(respond).fetchImpl,
        }),
      );
      assert.deepEqual(result, expected);
      assert.deepEqual(Object.keys(result), Object.keys(expected));
    }),
  ));

test("a missing credential throws before any request", async () => {
  const { calls, fetchImpl } = recorder(() => new Response("{}"));
  await assert.rejects(
    requestCompletion({ ...model, apiKeyEnv: "PRB_CHAT_UNSET" }, prepared, {
      fetchImpl,
    }),
    { message: "Missing credential environment variable PRB_CHAT_UNSET" },
  );
  assert.equal(calls.length, 0);
});

const untilAborted = (init) =>
  new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => reject(init.signal.reason)),
  );

test("the caller's abort signal and the timeout both stop the request", async () => {
  const caller = new AbortController();
  caller.abort(new Error("caller stop"));
  const stopped = await requestCompletion(model, prepared, {
    signal: caller.signal,
    fetchImpl: async (_url, init) => Promise.reject(init.signal.reason),
  });
  assert.equal(stopped.error, "caller stop");
  const timedOut = await requestCompletion(model, prepared, {
    timeoutMs: 5,
    fetchImpl: async (_url, init) => untilAborted(init),
  });
  assert.equal(timedOut.error, "The operation was aborted due to timeout");
  assert.equal(timedOut.status, null);
});

test("the body puts provider parameters first and appends the retry note before the Granite effort hint", () => {
  const granite = {
    ...model,
    model: "granite-4.2-8b",
    graniteThinkingMode: "low",
    parameters: { temperature: 0 },
  };
  const body = buildBody(granite, prepared, "NOTE");
  assert.deepEqual(Object.keys(body), [
    "temperature",
    "model",
    "messages",
    "stream",
    "n",
  ]);
  assert.equal(
    body.messages[1].content,
    "INERT DATA\n\nNOTE\n\n{reasoning effort: low}",
  );
  assert.deepEqual(
    Object.keys(buildBody({ ...model, format: "json_schema" }, prepared)),
    ["model", "messages", "stream", "n", "response_format"],
  );
  assert.deepEqual(
    Object.keys(buildBody({ ...model, format: "tool" }, prepared)),
    [
      "model",
      "messages",
      "stream",
      "n",
      "tools",
      "tool_choice",
      "parallel_tool_calls",
    ],
  );
});
