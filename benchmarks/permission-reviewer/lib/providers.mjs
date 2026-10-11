import { buildBody } from "./chat-body.mjs";
import { extractResponse } from "./chat-response.mjs";
import { safeError } from "./util.mjs";

async function boundedText(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: a stream reader yields chunks one read at a time, and the size cap must cancel the stream before the next chunk is pulled
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Provider response exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
/** The attempt record for a fully read provider response. */
function completionOutcome(response, rawText, start, format) {
  if (!response.ok)
    return {
      ok: false,
      status: response.status,
      error: `HTTP ${response.status}`,
      rawText,
      latencyMs: performance.now() - start,
      requestId: response.headers.get("x-request-id"),
    };
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      status: response.status,
      error: "Non-JSON provider response.",
      rawText,
      latencyMs: performance.now() - start,
    };
  }
  return {
    ok: true,
    status: response.status,
    raw,
    rawText,
    latencyMs: performance.now() - start,
    requestId: response.headers.get("x-request-id"),
    extracted: extractResponse(raw, format),
    usage: raw.usage ?? null,
    returnedModel: raw.model ?? null,
    systemFingerprint: raw.system_fingerprint ?? null,
    finishReason: raw.choices?.[0]?.finish_reason ?? null,
  };
}
/** Only this function contacts a provider. Fixture URLs, commands and tool calls are NEVER executed. */
export async function requestCompletion(
  model,
  prepared,
  {
    timeoutMs = 120000,
    maxResponseBytes = 4 * 1024 * 1024,
    retryNote,
    signal,
    fetchImpl = fetch,
  } = {},
) {
  const body = buildBody(model, prepared, retryNote),
    start = performance.now();
  const key = model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined;
  if (model.apiKeyEnv && !key)
    throw new Error(
      `Missing credential environment variable ${model.apiKeyEnv}`,
    );
  const redact = (text) =>
    key ? text.split(key).join("[REDACTED:provider_api_key]") : text;
  const headers = {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  let response,
    rawText = "";
  try {
    response = await fetchImpl(model.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    // Defend against a provider echoing the literal Authorization secret in an error body.
    rawText = redact(await boundedText(response, maxResponseBytes));
    return completionOutcome(response, rawText, start, model.format);
  } catch (error) {
    return {
      ok: false,
      error: redact(safeError(error)),
      rawText,
      latencyMs: performance.now() - start,
      status: response?.status ?? null,
    };
  }
}
export const TEXT_RETRY_NOTE =
  "Your previous response could not be parsed as a decision. Respond again with exactly one JSON object conforming to the schema and nothing else - no prose, no Markdown code fences, no commentary, and no copy of the schema.";
