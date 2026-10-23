import { describe, expect, test } from "bun:test";
import type {
  ActionPurpose,
  IntentContext,
} from "../src/kernel/actor-context-types.ts";
import type { PermissionRequest } from "../src/kernel/permission-request.ts";
import type { MessageWithParts } from "../src/modules/context/models/message.ts";
import { resolveActionPurpose } from "../src/modules/context/services/action-purpose.ts";
import { request } from "./helpers.ts";

const FALLBACK: IntentContext = {
  directUserIntent: [],
  delegatedTask: [],
  localSessionIntent: [
    {
      sessionID: "ses_main",
      messageID: "msg_user",
      actor: "user",
      text: "Local intent",
      synthetic: false,
      provenance: {
        value: "intent",
        source: "session-api",
        confidence: "high",
      },
    },
  ],
  conflictingInstructions: [],
  completeness: "partial",
};
const FROM_INTENT: ActionPurpose = {
  text: "Local intent",
  source: "intent-derived",
  confidence: "medium",
};

function pending(tool: unknown): PermissionRequest {
  return { ...request({ metadata: {} }), tool } as PermissionRequest;
}

function message(
  role: string,
  parts: Array<Record<string, unknown>>,
  id = "msg_tool",
): MessageWithParts {
  return { info: { id, role }, parts } as MessageWithParts;
}

const SAY = { type: "text", text: "Rebuilding  the\nindex." };
const CALL = { type: "tool", tool: "bash", callID: "call_1" };
const TOOL = { messageID: "msg_tool", callID: "call_1" };

describe("resolveActionPurpose from the tool message", () => {
  test.each([
    {
      name: "the located call's prose, whitespace collapsed",
      tool: TOOL,
      messages: [message("assistant", [SAY, CALL])],
      text: "Rebuilding the index.",
    },
    {
      name: "prose joined across text parts, skipping other kinds",
      tool: TOOL,
      messages: [
        message("assistant", [
          SAY,
          { type: "reasoning", text: "hidden thought" },
          { type: "text", text: 42 },
          { type: "text", text: " ok " },
          { type: "text", text: "Then verify." },
          CALL,
        ]),
      ],
      text: "Rebuilding the index. Then verify.",
    },
    {
      name: "a message with no tool parts at all",
      tool: TOOL,
      messages: [message("assistant", [SAY])],
      text: "Rebuilding the index.",
    },
    {
      name: "an empty callID skips the call check",
      tool: { messageID: "msg_tool", callID: "" },
      messages: [message("assistant", [SAY, { ...CALL, callID: "call_9" }])],
      text: "Rebuilding the index.",
    },
    {
      name: "a non-string callID skips the call check",
      tool: { messageID: "msg_tool", callID: 3 },
      messages: [message("assistant", [SAY, CALL])],
      text: "Rebuilding the index.",
    },
    {
      name: "a long joined text is bounded",
      tool: TOOL,
      messages: [
        message("assistant", [
          { type: "text", text: "a".repeat(400) },
          { type: "text", text: "b".repeat(400) },
          CALL,
        ]),
      ],
      text: `${"a".repeat(400)} ${"b".repeat(98)}…`,
    },
  ])("$name", ({ tool, messages, text }) => {
    expect(
      resolveActionPurpose(pending(tool), FALLBACK, [...messages]),
    ).toEqual({
      text,
      source: "agent-context",
      confidence: "medium",
    });
  });

  test.each([
    {
      name: "no pending tool",
      tool: undefined,
      messages: [message("assistant", [SAY, CALL])],
    },
    {
      name: "an empty messageID",
      tool: { messageID: "", callID: "call_1" },
      messages: [message("assistant", [SAY, CALL], "")],
    },
    { name: "no messages", tool: TOOL, messages: [] },
    {
      name: "the message is not in the list",
      tool: TOOL,
      messages: [message("assistant", [SAY, CALL], "msg_other")],
    },
    {
      name: "a user message",
      tool: TOOL,
      messages: [message("user", [SAY, CALL])],
    },
    {
      name: "a role-less message",
      tool: TOOL,
      messages: [message(undefined as unknown as string, [SAY, CALL])],
    },
    {
      name: "a message holding only another call",
      tool: TOOL,
      messages: [message("assistant", [SAY, { ...CALL, callID: "call_2" }])],
    },
    {
      name: "no usable prose",
      tool: TOOL,
      messages: [message("assistant", [{ type: "text", text: " a " }, CALL])],
    },
  ])("falls back to intent with $name", ({ tool, messages }) => {
    expect(
      resolveActionPurpose(pending(tool), FALLBACK, [...messages]),
    ).toEqual(FROM_INTENT);
  });

  test("a single delegated task too short to use leaves the purpose unavailable", () => {
    const intent: IntentContext = {
      ...FALLBACK,
      localSessionIntent: [],
      delegatedTask: [
        { ...FALLBACK.localSessionIntent[0], text: " x " } as never,
      ],
    };
    expect(resolveActionPurpose(pending(undefined), intent, [])).toEqual({
      source: "unavailable",
      confidence: "unknown",
    });
  });
});
