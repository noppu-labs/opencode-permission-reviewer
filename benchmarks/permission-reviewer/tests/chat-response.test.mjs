import assert from "node:assert/strict";
import test from "node:test";
import { extractResponse } from "../lib/providers.mjs";

const reply = (message, finish_reason = "stop") => ({
  choices: [{ finish_reason, message }],
});
const call = (name, args) => ({
  type: "function",
  function: { name, arguments: args },
});
const result = (args) => call("permission_reviewer_result", args);

const cases = [
  [
    "text",
    undefined,
    { text: "", protocolError: "Expected exactly one completion choice." },
  ],
  [
    "text",
    { choices: [] },
    { text: "", protocolError: "Expected exactly one completion choice." },
  ],
  [
    "text",
    { choices: ["x"] },
    { text: "", protocolError: "Malformed completion choice." },
  ],
  [
    "text",
    { choices: [{}] },
    { text: "", protocolError: "Missing completion message." },
  ],
  [
    "text",
    { choices: [{ message: "x" }] },
    { text: "", protocolError: "Missing completion message." },
  ],
  [
    "text",
    reply({ content: "partial", refusal: "No." }),
    { text: "partial", protocolError: "Provider refusal.", refusal: "No." },
  ],
  [
    "tool",
    reply({ content: 7, refusal: "No." }),
    { text: "", protocolError: "Provider refusal.", refusal: "No." },
  ],
  [
    "text",
    reply({
      content: [
        { type: "text", text: "a" },
        null,
        { type: "image" },
        { type: "text", text: 2 },
        { type: "text", text: "b" },
      ],
    }),
    { text: "a\nb", exposedReasoning: null },
  ],
  [
    "text",
    reply({ content: 7, reasoning: "r" }),
    { text: "", exposedReasoning: "r" },
  ],
  [
    "text",
    reply({ content: "x", reasoning_content: "rc", reasoning: "r" }),
    { text: "x", exposedReasoning: "rc" },
  ],
  [
    "text",
    reply({ content: "cut" }, "length"),
    { text: "cut", protocolError: "Incomplete completion: length" },
  ],
  [
    "tool",
    reply({ content: "cut" }, "content_filter"),
    { text: "cut", protocolError: "Incomplete completion: content_filter" },
  ],
  [
    "text",
    reply({ content: "x", tool_calls: [result("{}")] }),
    {
      text: "x",
      protocolError: "Unexpected tool call in text/schema profile.",
    },
  ],
  [
    "json_schema",
    reply({ content: "x", function_call: { name: "f" } }),
    {
      text: "x",
      protocolError: "Unexpected tool call in text/schema profile.",
    },
  ],
  [
    "text",
    reply({ content: "x", tool_calls: [] }),
    { text: "x", exposedReasoning: null },
  ],
  [
    "tool",
    reply({ content: "x" }),
    {
      text: "x",
      protocolError:
        "Expected exactly one inert result tool call; no operational calls are accepted.",
    },
  ],
  [
    "tool",
    reply({ tool_calls: [{ ...result("{}"), type: "custom" }] }),
    {
      text: "",
      protocolError:
        "Expected exactly one inert result tool call; no operational calls are accepted.",
    },
  ],
  [
    "tool",
    reply({ tool_calls: [result(null)] }),
    { text: "", protocolError: "Tool arguments must be a JSON string." },
  ],
  [
    "tool",
    reply({
      content: "visible",
      tool_calls: [result('{"a":1}')],
      reasoning: "r",
    }),
    { text: '{"a":1}', visibleText: "visible", exposedReasoning: "r" },
  ],
  [
    "tool",
    reply({ tool_calls: [result("")] }),
    { text: "", visibleText: "", exposedReasoning: null },
  ],
];

test("completion extraction returns the exact shape for every choice, message and tool-call case", () =>
  cases.forEach(([format, raw, expected], i) => {
    assert.deepEqual(extractResponse(raw, format), expected, `case ${i}`);
  }));

test("a null tool call entry is a thrown TypeError, not a protocol error", () =>
  assert.throws(
    () => extractResponse(reply({ tool_calls: [null] }), "tool"),
    TypeError,
  ));
