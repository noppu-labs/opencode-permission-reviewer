const failed = (text, protocolError) => ({ text, protocolError });
const reasoningOf = (message) =>
  message.reasoning_content ?? message.reasoning ?? null;

function soleMessage(raw) {
  if (!Array.isArray(raw?.choices) || raw.choices.length !== 1)
    return { error: "Expected exactly one completion choice." };
  const choice = raw.choices[0];
  if (!choice || typeof choice !== "object")
    return { error: "Malformed completion choice." };
  const message = choice.message;
  if (!message || typeof message !== "object")
    return { error: "Missing completion message." };
  return { choice, message };
}
const contentText = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((p) => p && p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n")
      : "";
function toolResult(message, text) {
  const calls = message.tool_calls;
  if (
    !Array.isArray(calls) ||
    calls.length !== 1 ||
    calls[0].type !== "function" ||
    calls[0].function?.name !== "permission_reviewer_result"
  )
    return failed(
      text,
      "Expected exactly one inert result tool call; no operational calls are accepted.",
    );
  if (typeof calls[0].function.arguments !== "string")
    return failed(text, "Tool arguments must be a JSON string.");
  // V2 may finish with text around a successful call, so keep it for audit, not as a second decision.
  return {
    text: calls[0].function.arguments ?? "",
    visibleText: text,
    exposedReasoning: reasoningOf(message),
  };
}
export function extractResponse(raw, format) {
  const { choice, message, error } = soleMessage(raw);
  if (error) return failed("", error);
  if (message.refusal)
    return {
      text: typeof message.content === "string" ? message.content : "",
      protocolError: "Provider refusal.",
      refusal: message.refusal,
    };
  const text = contentText(message.content);
  if (["length", "content_filter"].includes(choice.finish_reason))
    return failed(text, `Incomplete completion: ${choice.finish_reason}`);
  if (format === "tool") return toolResult(message, text);
  if (message.tool_calls?.length || message.function_call)
    return failed(text, "Unexpected tool call in text/schema profile.");
  return { text, exposedReasoning: reasoningOf(message) };
}
