const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export const cliArgs = (model) => [
  "--no-auto-update",
  "--no-session",
  "--no-skills",
  "--skip-onboarding",
  "--trust",
  "--permission-mode",
  "dont-ask",
  "--max-turns",
  "1",
  "--model",
  model.model,
  "--effort",
  model.variant,
  "--output-format",
  "json",
  "-p",
];

function readFrame(state, line) {
  try {
    const frame = JSON.parse(line);
    if (frame.type === "result") state.finalResult = frame;
    if (frame.type === "event" && frame.event?.type === "model_request_start")
      state.returnedModel = frame.event.model;
    if (frame.type === "event" && /^tool_/.test(frame.event?.type ?? ""))
      state.toolEvents++;
  } catch {
    // Ignore diagnostic lines and unknown forward-compatible frames.
  }
}
/** Collect the CLI's JSONL frames from stdout; `onOverflow` runs for every chunk past the output cap. */
export function frameCollector(onOverflow) {
  const state = {
    outputBytes: 0,
    buffer: "",
    outputTooLarge: false,
    finalResult: undefined,
    returnedModel: undefined,
    toolEvents: 0,
  };
  const onData = (chunk) => {
    state.outputBytes += Buffer.byteLength(chunk);
    if (state.outputBytes > MAX_OUTPUT_BYTES) {
      state.outputTooLarge = true;
      onOverflow();
      return;
    }
    state.buffer += chunk;
    for (;;) {
      const end = state.buffer.indexOf("\n");
      if (end < 0) break;
      const line = state.buffer.slice(0, end);
      state.buffer = state.buffer.slice(end + 1);
      readFrame(state, line);
    }
  };
  return { state, onData };
}
const stopReason = (run) =>
  run.timedOut
    ? "Command Code request timed out."
    : run.aborted
      ? "Command Code request was interrupted."
      : run.outputTooLarge
        ? "Command Code emitted excessive output."
        : `Command Code exited with code ${run.exitCode}.`;

function unusableReason(run, model) {
  if (run.timedOut || run.aborted || run.outputTooLarge || run.exitCode !== 0)
    return stopReason(run);
  if (run.returnedModel !== model.model)
    return "Command Code returned a different model.";
  if (run.toolEvents > 0) return "Command Code attempted a tool action.";
  if (
    run.finalResult?.subtype !== "success" ||
    run.finalResult.stopReason !== "end_turn"
  )
    return "Command Code did not return one completed answer.";
  return undefined;
}
/** The attempt record for a finished CLI process; throws the reason it gave no usable answer. */
export function commandCodeAnswer(run, model, started) {
  const reason = unusableReason(run, model);
  if (reason) throw new Error(reason);
  const response = run.finalResult.finalText;
  const usage = run.finalResult.usage;
  const raw = {
    host: "command-code-cli",
    model: run.returnedModel,
    variant: model.variant,
    usage: usage ?? null,
    finalText: response,
  };
  return {
    ok: true,
    status: 200,
    raw,
    rawText: JSON.stringify(raw),
    extracted: {
      text: typeof response === "string" ? response : "",
      ...(typeof response === "string" && response
        ? {}
        : { protocolError: "No final text." }),
    },
    latencyMs: performance.now() - started,
    returnedModel: run.returnedModel,
    usage: usage
      ? {
          prompt_tokens: usage.inputTokens ?? null,
          completion_tokens: usage.outputTokens ?? null,
          cache_read_tokens: usage.cacheReadTokens ?? null,
        }
      : null,
  };
}
