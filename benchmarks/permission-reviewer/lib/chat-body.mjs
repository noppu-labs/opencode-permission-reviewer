export function buildBody(model, prepared, retryNote) {
  const lowEffort =
    model.graniteThinkingMode === "low" ? "\n\n{reasoning effort: low}" : "";
  const messages = [
    { role: "system", content: prepared.system },
    {
      role: "user",
      content:
        prepared.user + (retryNote ? `\n\n${retryNote}` : "") + lowEffort,
    },
  ];
  // Granite's chat template uses this assistant prefix to skip the open
  // thinking block. LM Studio ignores per-request reasoning controls for the
  // locally loaded GGUF, so this keeps the comparison on the same endpoint.
  if (model.graniteThinkingMode === "off")
    messages.push({ role: "assistant", content: "<think></think>" });
  const body = {
    ...model.parameters,
    model: model.model,
    messages,
    stream: false,
    n: 1,
  };
  if (model.format === "json_schema")
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "permission_decision",
        strict: true,
        schema: prepared.schema,
      },
    };
  if (model.format === "tool") {
    body.tools = [
      {
        type: "function",
        function: {
          name: "permission_reviewer_result",
          description:
            "Return exactly one final permission review decision matching the required schema.",
          parameters: prepared.schema,
        },
      },
    ];
    // No forced selection: missing/extra calls are visible failures, not silently repaired approvals.
    body.tool_choice = "auto";
    body.parallel_tool_calls = false;
  }
  return body;
}
