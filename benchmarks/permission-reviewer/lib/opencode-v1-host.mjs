/** A caller for the host's HTTP API, scoped to the request's private directory. */
export function hostClient(
  model,
  directory,
  password,
  fetchImpl,
  requestSignal,
) {
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  return async (method, path, body, currentSignal = requestSignal) => {
    const url = new URL(path, model.endpoint);
    url.searchParams.set("directory", directory);
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: authorization,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: currentSignal,
      redirect: "error",
    });
    if (!response.ok)
      throw Object.assign(new Error(`OpenCode HTTP ${response.status}`), {
        status: response.status,
      });
    return response.status === 204 ? null : response.json();
  };
}
export const messageBody = (model, prepared, retryNote, ids) => ({
  model: ids,
  variant: model.variant,
  tools: { "*": false },
  system: prepared.system,
  format:
    model.format === "json_schema"
      ? { type: "json_schema", schema: prepared.schema, retryCount: 0 }
      : { type: "text" },
  parts: [
    {
      type: "text",
      text: prepared.user + (retryNote ? `\n\n${retryNote}` : ""),
    },
  ],
});
function checkAnswer(info, parts, { providerID, modelID }) {
  if (info?.error)
    throw new Error(`OpenCode model error: ${info.error.name ?? "unknown"}`);
  if (info?.providerID !== providerID || info?.modelID !== modelID)
    throw new Error("OpenCode returned a different provider or model");
  if (!Array.isArray(parts)) throw new Error("OpenCode response has no parts");
  if (parts.some((part) => part?.type === "tool"))
    throw new Error("OpenCode returned a tool action despite disabled tools");
}
/** The attempt record for the host's reply; throws the reason the reply is unusable. */
export function sessionAnswer(result, model, sessionID, ids, started) {
  const info = result?.info;
  const parts = result?.parts;
  checkAnswer(info, parts, ids);
  const textParts = parts.filter(
    (part) => part?.type === "text" && typeof part.text === "string",
  );
  const text =
    model.format === "json_schema"
      ? JSON.stringify(info.structured ?? null)
      : textParts.map((part) => part.text).join("\n");
  const usage = info.tokens && {
    prompt_tokens: info.tokens.input ?? null,
    completion_tokens: info.tokens.output ?? null,
    reasoning_tokens: info.tokens.reasoning ?? null,
  };
  const raw = {
    host: "opencode-v1",
    model: `${info.providerID}/${info.modelID}`,
    variant: model.variant,
    sessionID,
    tokens: info.tokens ?? null,
    parts: textParts.map((part) => ({ type: "text", text: part.text })),
  };
  return {
    ok: true,
    status: 200,
    raw,
    rawText: JSON.stringify(raw),
    extracted: {
      text,
      ...(text ? {} : { protocolError: "OpenCode returned no decision text." }),
    },
    latencyMs: performance.now() - started,
    returnedModel: raw.model,
    usage: usage ?? null,
  };
}
